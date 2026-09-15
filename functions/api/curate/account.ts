/**
 * GET /api/curate/account
 * PUT /api/curate/account
 * POST /api/curate/account
 *
 * Dedicated account management endpoint for individual judges.
 * Allows judges to update their username, display name, account password,
 * and dedicated API key encryption password.
 */

import type { PagesFunction } from "../../_shared/pages";
import { json, handleD1Error, type Env } from "../../_shared/d1r2";
import { requireAuth, verifyPassword, hashPassword } from "../../_shared/catAuth";
import { ensureCurationTables } from "../../_shared/curateDb";

interface UpdateAccountPayload {
  username?: string;
  display_name?: string;
  current_password?: string;
  new_password?: string;
  current_api_password?: string;
  new_api_password?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureCurationTables(env.DB);
    const sessionUser = await requireAuth(request, env);

    const user = await env.DB.prepare(`
      SELECT id, username, display_name, role, created_at, last_login_at,
             CASE WHEN api_password_hash IS NOT NULL AND api_password_hash != '' THEN 1 ELSE 0 END as has_api_password
      FROM cat_users
      WHERE id = ?
    `).bind(sessionUser.id).first<{
      id: string;
      username: string;
      display_name: string;
      role: string;
      created_at: string;
      last_login_at: string | null;
      has_api_password: number;
    }>();

    if (!user) {
      return json({ error: "Judge account not found." }, { status: 404 });
    }

    return json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        created_at: user.created_at,
        last_login_at: user.last_login_at,
        has_api_password: Boolean(user.has_api_password)
      }
    });
  } catch (err: unknown) {
    return handleD1Error(err, "Error retrieving account");
  }
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureCurationTables(env.DB);
    const sessionUser = await requireAuth(request, env);

    const body = (await request.json().catch(() => ({}))) as UpdateAccountPayload;
    const username = (body.username || "").trim();
    const displayName = (body.display_name || "").trim();
    const currentPassword = body.current_password || "";
    const newPassword = body.new_password || "";
    const currentApiPassword = body.current_api_password || "";
    const newApiPassword = body.new_api_password || "";

    // Fetch current user record including password hashes
    const currentUser = await env.DB.prepare(`
      SELECT id, username, display_name, password_hash, api_password_hash, role
      FROM cat_users
      WHERE id = ?
    `).bind(sessionUser.id).first<{
      id: string;
      username: string;
      display_name: string;
      password_hash: string;
      api_password_hash: string | null;
      role: string;
    }>();

    if (!currentUser) {
      return json({ error: "Judge account not found." }, { status: 404 });
    }

    let finalUsername = currentUser.username;
    let finalDisplayName = currentUser.display_name;
    let finalPasswordHash = currentUser.password_hash;
    let finalApiPasswordHash = currentUser.api_password_hash;

    // 1. Update Display Name if provided
    if (displayName) {
      if (displayName.length < 2 || displayName.length > 50) {
        return json({ error: "Display name must be between 2 and 50 characters." }, { status: 400 });
      }
      finalDisplayName = displayName;
    }

    // 2. Update Username if changed
    if (username && username.toLowerCase() !== currentUser.username.toLowerCase()) {
      if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
        return json({
          error: "Username must be 3-30 characters and contain only letters, numbers, hyphens, or underscores."
        }, { status: 400 });
      }

      // Ensure uniqueness
      const existing = await env.DB.prepare(`
        SELECT id FROM cat_users WHERE LOWER(username) = LOWER(?) AND id != ?
      `).bind(username, sessionUser.id).first();

      if (existing) {
        return json({ error: `The username "${username}" is already taken.` }, { status: 400 });
      }

      finalUsername = username;
    }

    // 3. Update Login Password if requested
    if (newPassword) {
      if (!currentPassword) {
        return json({ error: "Current password is required to set a new login password." }, { status: 400 });
      }

      const isCurrentValid = await verifyPassword(currentPassword, currentUser.password_hash);
      if (!isCurrentValid) {
        return json({ error: "Current login password is incorrect." }, { status: 400 });
      }

      if (newPassword.length < 6) {
        return json({ error: "New login password must be at least 6 characters long." }, { status: 400 });
      }

      finalPasswordHash = await hashPassword(newPassword);
    }

    // 4. Update API Key Encryption Password if requested
    if (newApiPassword) {
      if (currentUser.api_password_hash) {
        if (!currentApiPassword) {
          return json({ error: "Current API encryption password is required to change it." }, { status: 400 });
        }
        const isCurrentApiValid = await verifyPassword(currentApiPassword, currentUser.api_password_hash);
        if (!isCurrentApiValid) {
          return json({ error: "Current API encryption password is incorrect." }, { status: 400 });
        }
      }

      if (newApiPassword.length < 4) {
        return json({ error: "API encryption password must be at least 4 characters long." }, { status: 400 });
      }

      finalApiPasswordHash = await hashPassword(newApiPassword);
    }

    // 5. Update the user in the database
    await env.DB.prepare(`
      UPDATE cat_users
      SET username = ?, display_name = ?, password_hash = ?, api_password_hash = ?
      WHERE id = ?
    `).bind(finalUsername, finalDisplayName, finalPasswordHash, finalApiPasswordHash, sessionUser.id).run();

    return json({
      success: true,
      user: {
        id: sessionUser.id,
        username: finalUsername,
        display_name: finalDisplayName,
        role: currentUser.role,
        has_api_password: Boolean(finalApiPasswordHash)
      },
      message: "Account updated successfully."
    });
  } catch (err: unknown) {
    return handleD1Error(err, "Error updating account");
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureCurationTables(env.DB);
    const sessionUser = await requireAuth(request, env);

    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      api_password?: string;
    };

    if (body.action === "verify-api-password") {
      const enteredPassword = (body.api_password || "").trim();
      const user = await env.DB.prepare(`
        SELECT api_password_hash FROM cat_users WHERE id = ?
      `).bind(sessionUser.id).first<{ api_password_hash: string | null }>();

      if (!user?.api_password_hash) {
        // No password configured yet -> automatically valid
        return json({ success: true, valid: true, hasPassword: false });
      }

      if (!enteredPassword) {
        return json({ error: "API encryption password is required.", valid: false }, { status: 400 });
      }

      const isValid = await verifyPassword(enteredPassword, user.api_password_hash);
      if (!isValid) {
        return json({ error: "Incorrect API encryption password.", valid: false }, { status: 401 });
      }

      return json({ success: true, valid: true, hasPassword: true });
    }

    return json({ error: "Unsupported action." }, { status: 400 });
  } catch (err: unknown) {
    return handleD1Error(err, "Error verifying API password");
  }
};
