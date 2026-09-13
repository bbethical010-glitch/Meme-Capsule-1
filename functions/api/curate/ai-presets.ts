/**
 * GET /api/curate/ai-presets
 * POST /api/curate/ai-presets
 * DELETE /api/curate/ai-presets?id=...[&model=...]
 *
 * Dedicated AI model presets endpoint isolated strictly per individual judge.
 * - Merges presets sharing common providers/credentials into unified Provider Presets.
 * - Supports model arrays, inline model addition, and model-specific deletion.
 * - Encrypts API keys with AES-GCM-256 at rest in Cloudflare D1.
 */

import type { PagesFunction } from "../../_shared/pages";
import { json, type Env } from "../../_shared/d1r2";
import { requireAuth } from "../../_shared/catAuth";
import { ensureCurationTables } from "../../_shared/curateDb";
import { encryptApiKey, decryptApiKey } from "../../_shared/crypto";

interface SavePresetPayload {
  id?: string;
  preset_name?: string;
  provider?: string;
  base_url?: string;
  api_key?: string;
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

    const results = await env.DB.prepare(`
      SELECT id, preset_name, provider, base_url, api_key, model, settings, created_at, updated_at
      FROM cat_judge_ai_presets
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `).bind(sessionUser.id).all();

    const rawRows = results.results || [];
    if (rawRows.length === 0) {
      return json({ success: true, presets: [] });
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

    return json({ success: true, presets: mergedPresets });
  } catch (err: unknown) {
    if (err instanceof Response) return err;
    const msg = err instanceof Error ? err.message : "Error retrieving presets";
    return json({ error: msg }, { status: 500 });
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureCurationTables(env.DB);
    const sessionUser = await requireAuth(request, env);
    const secretSeed = env.ADMIN_API_TOKEN || "meme-capsule-secret-token";

    const body = (await request.json().catch(() => ({}))) as SavePresetPayload;
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

    if (body.id) {
      // Update existing preset
      const existing = await env.DB.prepare(`
        SELECT id, api_key FROM cat_judge_ai_presets WHERE id = ? AND user_id = ?
      `).bind(body.id, sessionUser.id).first();

      if (!existing) {
        return json({ error: "Preset not found or unauthorized." }, { status: 404 });
      }

      // If key was not modified in edit form, keep existing encrypted key
      const storedApiKey = rawApiKey
        ? await encryptApiKey(rawApiKey, secretSeed)
        : String(existing.api_key || "");

      await env.DB.prepare(`
        UPDATE cat_judge_ai_presets
        SET preset_name = ?, provider = ?, base_url = ?, api_key = ?, model = ?, settings = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).bind(presetName, provider, baseUrl, storedApiKey, model, settingsStr, now, body.id, sessionUser.id).run();

      return json({
        success: true,
        preset: {
          id: body.id,
          user_id: sessionUser.id,
          preset_name: presetName,
          provider,
          base_url: baseUrl,
          api_key: rawApiKey || (await decryptApiKey(storedApiKey, secretSeed)),
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
    `).bind(sessionUser.id, provider, baseUrl).first();

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
      const storedApiKey = rawApiKey
        ? await encryptApiKey(rawApiKey, secretSeed)
        : String(existingGroup.api_key || "");

      await env.DB.prepare(`
        UPDATE cat_judge_ai_presets
        SET preset_name = ?, model = ?, api_key = ?, settings = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).bind(presetName, model, storedApiKey, JSON.stringify(updatedSettings), now, existingId, sessionUser.id).run();

      return json({
        success: true,
        preset: {
          id: existingId,
          user_id: sessionUser.id,
          preset_name: presetName,
          provider,
          base_url: baseUrl,
          api_key: rawApiKey || (await decryptApiKey(storedApiKey, secretSeed)),
          model,
          models: existingModels,
          settings: updatedSettings,
          updated_at: now
        }
      });
    }

    // Insert new preset
    const newId = `preset-${crypto.randomUUID().slice(0, 8)}`;
    const storedApiKey = await encryptApiKey(rawApiKey, secretSeed);

    await env.DB.prepare(`
      INSERT INTO cat_judge_ai_presets (
        id, user_id, preset_name, provider, base_url, api_key, model, settings, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(newId, sessionUser.id, presetName, provider, baseUrl, storedApiKey, model, settingsStr, now, now).run();

    return json({
      success: true,
      preset: {
        id: newId,
        user_id: sessionUser.id,
        preset_name: presetName,
        provider,
        base_url: baseUrl,
        api_key: rawApiKey,
        model,
        models,
        settings: settingsObj,
        created_at: now,
        updated_at: now
      }
    });
  } catch (err: unknown) {
    if (err instanceof Response) return err;
    const msg = err instanceof Error ? err.message : "Error saving preset";
    return json({ error: msg }, { status: 500 });
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureCurationTables(env.DB);
    const sessionUser = await requireAuth(request, env);

    const url = new URL(request.url);
    const presetId = url.searchParams.get("id");
    const modelToDelete = url.searchParams.get("model");

    if (!presetId) {
      return json({ error: "Preset id parameter is required." }, { status: 400 });
    }

    const existing = await env.DB.prepare(`
      SELECT id, model, settings FROM cat_judge_ai_presets WHERE id = ? AND user_id = ?
    `).bind(presetId, sessionUser.id).first();

    if (!existing) {
      return json({ error: "Preset not found or unauthorized." }, { status: 404 });
    }

    // If deleting a specific model from the preset's model list
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
    if (err instanceof Response) return err;
    const msg = err instanceof Error ? err.message : "Error deleting preset";
    return json({ error: msg }, { status: 500 });
  }
};
