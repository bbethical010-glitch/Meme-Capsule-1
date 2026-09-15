/**
 * GET /api/curate/ai-presets
 * POST /api/curate/ai-presets
 * DELETE /api/curate/ai-presets?id=...[&model=...]
 *
 * Dedicated AI model presets endpoint isolated strictly per individual judge.
 * - Merges presets sharing common providers/credentials into unified Provider Presets.
 * - Masks API keys on GET if the judge has an API encryption password set.
 * - Secure reveal action protected by judge's API encryption password.
 * - Protects preset creation, deletion, and credential modifications from unauthorized account sharers.
 * - Allows model switching, model additions, and AI evaluations seamlessly without requiring passwords.
 */

import type { PagesFunction } from "../../_shared/pages";
import { json, handleD1Error, type Env } from "../../_shared/d1r2";
import { requireAuth, verifyPassword } from "../../_shared/catAuth";
import { ensureCurationTables } from "../../_shared/curateDb";
import { encryptApiKey, decryptApiKey } from "../../_shared/crypto";

interface SavePresetPayload {
  id?: string;
  action?: string;
  preset_name?: string;
  provider?: string;
  base_url?: string;
  api_key?: string;
  api_password?: string;
  model?: string;
  models?: string[];
  settings?: Record<string, unknown>;
}

const normalizeBaseUrl = (url: string, provider?: string): string => {
  let cleaned = (url || "").trim().replace(/\/+$/, "");
  const lower = cleaned.toLowerCase();
  if (lower.includes("generativelanguage.googleapis.com") || provider === "gemini") {
    return "https://generativelanguage.googleapis.com/v1beta/openai";
  }
  if (lower.includes("groq.com") || provider === "groq") {
    return "https://api.groq.com/openai/v1";
  }
  if (lower.includes("integrate.api.nvidia.com") || provider === "nvidia") {
    return "https://integrate.api.nvidia.com/v1";
  }
  if (lower.includes("openrouter.ai") || provider === "openrouter") {
    return "https://openrouter.ai/api/v1";
  }
  return cleaned;
};

const getCleanProviderName = (provider: string, existingName?: string): string => {
  if (existingName && !existingName.includes("(") && !existingName.includes("/")) {
    return existingName;
  }
  switch (provider) {
    case "gemini":
      return "Google AI Studio";
    case "groq":
      return "Groq Cloud";
    case "nvidia":
      return "NVIDIA NIM";
    case "openrouter":
      return "OpenRouter";
    case "custom":
      return "Custom Endpoint";
    default:
      return existingName || "AI Provider";
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureCurationTables(env.DB);
    const sessionUser = await requireAuth(request, env);
    const secretSeed = env.ADMIN_API_TOKEN || "meme-capsule-secret-token";

    // Check if this judge has set a private API Encryption Password
    const userRow = await env.DB.prepare(
      "SELECT api_password_hash FROM cat_users WHERE id = ?"
    ).bind(sessionUser.id).first<{ api_password_hash: string | null }>();
    const hasApiPassword = Boolean(userRow?.api_password_hash);

    const results = await env.DB.prepare(`
      SELECT id, preset_name, provider, base_url, api_key, model, settings, created_at, updated_at
      FROM cat_judge_ai_presets
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `).bind(sessionUser.id).all();

    const rawRows = results.results || [];
    if (rawRows.length === 0) {
      return json({ success: true, presets: [], has_api_password: hasApiPassword });
    }

    // Decrypt API keys and parse settings
    const decryptedRows = await Promise.all(
      rawRows.map(async (row: any) => {
        let parsedSettings: Record<string, unknown> = {};
        try {
          parsedSettings = JSON.parse(row.settings || "{}");
        } catch {
          // ignore
        }
        const decryptedKey = await decryptApiKey(row.api_key || "", secretSeed);
        return {
          ...row,
          api_key: decryptedKey,
          settings: parsedSettings
        };
      })
    );

    // Group rows by provider and normalized base_url
    const groupMap = new Map<string, any>();
    const redundantIdsToDelete: string[] = [];

    for (const row of decryptedRows) {
      const normUrl = normalizeBaseUrl(row.base_url, row.provider);
      const groupKey = `${row.provider}:::${normUrl}`;

      let rowModels: string[] = [];
      if (Array.isArray(row.settings?.models)) {
        rowModels = row.settings.models.map((m: unknown) => String(m).trim()).filter(Boolean);
      }
      if (row.model && !rowModels.includes(row.model.trim())) {
        rowModels.push(row.model.trim());
      }

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          id: row.id,
          user_id: row.user_id,
          preset_name: getCleanProviderName(row.provider, row.preset_name),
          provider: row.provider,
          base_url: normUrl,
          api_key: row.api_key,
          model: row.model || rowModels[0] || "",
          models: rowModels,
          settings: {
            ...row.settings,
            models: rowModels
          },
          created_at: row.created_at,
          updated_at: row.updated_at,
          mergedIds: [row.id]
        });
      } else {
        const existing = groupMap.get(groupKey);
        existing.mergedIds.push(row.id);
        redundantIdsToDelete.push(row.id);

        // Merge models
        for (const m of rowModels) {
          if (m && !existing.models.includes(m)) {
            existing.models.push(m);
          }
        }
        existing.settings.models = existing.models;

        // Retain API key if existing was empty
        if (row.api_key && !existing.api_key) {
          existing.api_key = row.api_key;
        }
      }
    }

    const mergedPresets = Array.from(groupMap.values());

    // Clean up duplicate rows in D1 asynchronously to keep database tidy
    if (redundantIdsToDelete.length > 0) {
      for (const preset of mergedPresets) {
        if (preset.mergedIds && preset.mergedIds.length > 1) {
          const settingsStr = JSON.stringify(preset.settings || {});
          await env.DB.prepare(`
            UPDATE cat_judge_ai_presets
            SET preset_name = ?, base_url = ?, model = ?, settings = ?
            WHERE id = ? AND user_id = ?
          `).bind(preset.preset_name, preset.base_url, preset.model, settingsStr, preset.id, sessionUser.id).run().catch(() => {});
        }
      }
      for (const redId of redundantIdsToDelete) {
        await env.DB.prepare(`
          DELETE FROM cat_judge_ai_presets WHERE id = ? AND user_id = ?
        `).bind(redId, sessionUser.id).run().catch(() => {});
      }
    }

    // Mask the raw API key if this judge has an API encryption password configured
    // This prevents the real secret key from appearing in the DevTools Network response or DOM Elements
    const sanitizedPresets = mergedPresets.map((p) => {
      const hasKey = Boolean(p.api_key && p.api_key.trim());
      const isMasked = hasApiPassword && hasKey;
      return {
        ...p,
        api_key: isMasked ? "••••••••••••••••••••••••••••••••" : p.api_key,
        has_api_key: hasKey,
        is_key_masked: isMasked
      };
    });

    return json({ success: true, presets: sanitizedPresets, has_api_password: hasApiPassword });
  } catch (err: unknown) {
    return handleD1Error(err, "Error retrieving presets");
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureCurationTables(env.DB);
    const sessionUser = await requireAuth(request, env);
    const secretSeed = env.ADMIN_API_TOKEN || "meme-capsule-secret-token";

    const body = (await request.json().catch(() => ({}))) as SavePresetPayload;

    // Check judge's API encryption password status
    const userRow = await env.DB.prepare(
      "SELECT api_password_hash FROM cat_users WHERE id = ?"
    ).bind(sessionUser.id).first<{ api_password_hash: string | null }>();
    const hasApiPassword = Boolean(userRow?.api_password_hash);

    // ACTION: Reveal plaintext API key (Requires verified API encryption password)
    if (body.action === "reveal-key") {
      const presetId = (body.id || "").trim();
      const enteredPassword = (body.api_password || "").trim();

      if (hasApiPassword) {
        if (!enteredPassword) {
          return json({ error: "API encryption password is required to reveal key.", valid: false }, { status: 400 });
        }
        const isValid = await verifyPassword(enteredPassword, userRow!.api_password_hash!);
        if (!isValid) {
          return json({ error: "Incorrect API encryption password.", valid: false }, { status: 401 });
        }
      }

      const targetPreset = await env.DB.prepare(
        "SELECT api_key FROM cat_judge_ai_presets WHERE id = ? AND user_id = ?"
      ).bind(presetId, sessionUser.id).first<{ api_key: string }>();

      if (!targetPreset) {
        return json({ error: "Preset not found." }, { status: 404 });
      }

      const decryptedKey = await decryptApiKey(targetPreset.api_key || "", secretSeed);
      return json({ success: true, api_key: decryptedKey });
    }

    const isOnlyAddingModel = body.action === "add-model";

    // Permission enforcement: Creating a new preset or reconfiguring requires API encryption password if configured
    if (hasApiPassword && !isOnlyAddingModel) {
      const enteredPassword = (body.api_password || "").trim() || request.headers.get("X-Api-Password") || "";
      const isValid = await verifyPassword(enteredPassword, userRow!.api_password_hash!);
      if (!isValid) {
        return json({
          error: "API encryption password required to create or modify presets.",
          requiresPassword: true
        }, { status: 401 });
      }
    }

    const provider = (body.provider || "custom").trim();
    const baseUrl = normalizeBaseUrl(body.base_url || "", provider);
    const rawApiKey = (body.api_key || "").trim();
    const model = (body.model || "").trim();
    const presetName = getCleanProviderName(provider, (body.preset_name || "").trim());

    if (!baseUrl) {
      return json({ error: "API Base URL is required." }, { status: 400 });
    }
    if (!model) {
      return json({ error: "Model identifier is required." }, { status: 400 });
    }

    // Prepare models array
    let models: string[] = [];
    if (Array.isArray(body.models)) {
      models = body.models.map((m) => String(m).trim()).filter(Boolean);
    }
    if (model && !models.includes(model)) {
      models.push(model);
    }

    const settingsObj = {
      ...(body.settings || {}),
      models
    };
    const settingsStr = JSON.stringify(settingsObj);
    const now = new Date().toISOString();

    const isMaskedKey = rawApiKey.startsWith("•••") || rawApiKey === "";

    if (body.id) {
      // Update existing preset
      const existing = await env.DB.prepare(`
        SELECT id, api_key FROM cat_judge_ai_presets WHERE id = ? AND user_id = ?
      `).bind(body.id, sessionUser.id).first<{ id: string; api_key: string }>();

      if (!existing) {
        return json({ error: "Preset not found or unauthorized." }, { status: 404 });
      }

      // If key was not modified (or masked bullets were passed), retain existing encrypted key
      const storedApiKey = (!isMaskedKey && rawApiKey)
        ? await encryptApiKey(rawApiKey, secretSeed)
        : String(existing.api_key || "");

      await env.DB.prepare(`
        UPDATE cat_judge_ai_presets
        SET preset_name = ?, provider = ?, base_url = ?, api_key = ?, model = ?, settings = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).bind(presetName, provider, baseUrl, storedApiKey, model, settingsStr, now, body.id, sessionUser.id).run();

      const returnKey = hasApiPassword ? "••••••••••••••••••••••••••••••••" : (rawApiKey || (await decryptApiKey(storedApiKey, secretSeed)));

      return json({
        success: true,
        preset: {
          id: body.id,
          user_id: sessionUser.id,
          preset_name: presetName,
          provider,
          base_url: baseUrl,
          api_key: returnKey,
          has_api_key: Boolean(storedApiKey),
          is_key_masked: hasApiPassword,
          model,
          models,
          settings: settingsObj,
          updated_at: now
        }
      });
    }

    // Check if preset with same (user_id, provider, base_url) already exists
    const existingGroup = await env.DB.prepare(`
      SELECT id, api_key, settings FROM cat_judge_ai_presets
      WHERE user_id = ? AND provider = ? AND base_url = ?
    `).bind(sessionUser.id, provider, baseUrl).first<{ id: string; api_key: string; settings: string }>();

    if (existingGroup) {
      const existingId = String(existingGroup.id);
      let existingModels: string[] = [];
      try {
        const parsed = JSON.parse(String(existingGroup.settings || "{}"));
        if (Array.isArray(parsed.models)) existingModels = parsed.models;
      } catch {
        // ignore
      }
      for (const m of models) {
        if (m && !existingModels.includes(m)) existingModels.push(m);
      }
      const updatedSettings = {
        ...(body.settings || {}),
        models: existingModels
      };

      const storedApiKey = (!isMaskedKey && rawApiKey)
        ? await encryptApiKey(rawApiKey, secretSeed)
        : String(existingGroup.api_key || "");

      await env.DB.prepare(`
        UPDATE cat_judge_ai_presets
        SET preset_name = ?, model = ?, settings = ?, api_key = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).bind(presetName, model, JSON.stringify(updatedSettings), storedApiKey, now, existingId, sessionUser.id).run();

      const returnKey = hasApiPassword ? "••••••••••••••••••••••••••••••••" : (rawApiKey || (await decryptApiKey(storedApiKey, secretSeed)));

      return json({
        success: true,
        preset: {
          id: existingId,
          user_id: sessionUser.id,
          preset_name: presetName,
          provider,
          base_url: baseUrl,
          api_key: returnKey,
          has_api_key: Boolean(storedApiKey),
          is_key_masked: hasApiPassword,
          model,
          models: existingModels,
          settings: updatedSettings,
          updated_at: now
        }
      });
    }

    // Create brand new preset
    const newId = `preset-${crypto.randomUUID().slice(0, 10)}`;
    const storedApiKey = rawApiKey ? await encryptApiKey(rawApiKey, secretSeed) : "";

    await env.DB.prepare(`
      INSERT INTO cat_judge_ai_presets (
        id, user_id, preset_name, provider, base_url, api_key, model, settings, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      newId,
      sessionUser.id,
      presetName,
      provider,
      baseUrl,
      storedApiKey,
      model,
      settingsStr,
      now,
      now
    ).run();

    const returnKey = hasApiPassword ? "••••••••••••••••••••••••••••••••" : rawApiKey;

    return json({
      success: true,
      preset: {
        id: newId,
        user_id: sessionUser.id,
        preset_name: presetName,
        provider,
        base_url: baseUrl,
        api_key: returnKey,
        has_api_key: Boolean(storedApiKey),
        is_key_masked: hasApiPassword,
        model,
        models,
        settings: settingsObj,
        created_at: now,
        updated_at: now
      }
    });
  } catch (err: unknown) {
    return handleD1Error(err, "Error saving preset");
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureCurationTables(env.DB);
    const sessionUser = await requireAuth(request, env);

    const url = new URL(request.url);
    const presetId = (url.searchParams.get("id") || "").trim();
    const modelToDelete = (url.searchParams.get("model") || "").trim();

    if (!presetId) {
      return json({ error: "Preset id parameter is required." }, { status: 400 });
    }

    // Check judge's API encryption password status
    const userRow = await env.DB.prepare(
      "SELECT api_password_hash FROM cat_users WHERE id = ?"
    ).bind(sessionUser.id).first<{ api_password_hash: string | null }>();
    const hasApiPassword = Boolean(userRow?.api_password_hash);

    // Permission enforcement: Deleting an entire preset requires API encryption password if configured
    if (hasApiPassword && !modelToDelete) {
      const enteredPassword = request.headers.get("X-Api-Password") || url.searchParams.get("api_password") || "";
      const isValid = await verifyPassword(enteredPassword, userRow!.api_password_hash!);
      if (!isValid) {
        return json({
          error: "API encryption password required to delete presets.",
          requiresPassword: true
        }, { status: 401 });
      }
    }

    const existing = await env.DB.prepare(`
      SELECT id, model, settings FROM cat_judge_ai_presets WHERE id = ? AND user_id = ?
    `).bind(presetId, sessionUser.id).first<{ id: string; model: string; settings: string }>();

    if (!existing) {
      return json({ error: "Preset not found or unauthorized." }, { status: 404 });
    }

    // If deleting a specific model from the preset's model list (Allowed without password)
    if (modelToDelete) {
      let parsedSettings: Record<string, unknown> = {};
      try {
        parsedSettings = JSON.parse(String(existing.settings || "{}"));
      } catch {
        // ignore
      }
      let models = Array.isArray(parsedSettings.models)
        ? (parsedSettings.models as string[]).filter((m) => m !== modelToDelete)
        : [];

      let currentModel = String(existing.model || "");
      if (currentModel === modelToDelete) {
        currentModel = models[0] || "";
      }

      parsedSettings.models = models;
      const now = new Date().toISOString();

      await env.DB.prepare(`
        UPDATE cat_judge_ai_presets
        SET model = ?, settings = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).bind(currentModel, JSON.stringify(parsedSettings), now, presetId, sessionUser.id).run();

      return json({
        success: true,
        message: `Model "${modelToDelete}" removed from preset.`,
        activeModel: currentModel,
        models
      });
    }

    // Otherwise, delete the entire preset row
    await env.DB.prepare(`
      DELETE FROM cat_judge_ai_presets
      WHERE id = ? AND user_id = ?
    `).bind(presetId, sessionUser.id).run();

    return json({ success: true, message: "Preset deleted successfully." });
  } catch (err: unknown) {
    return handleD1Error(err, "Error deleting preset");
  }
};
