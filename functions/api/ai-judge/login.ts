import type { PagesFunction } from "../../_shared/pages";
import { json, type Env } from "../../_shared/d1r2";
import { generateToken, hashPassword } from "../../_shared/aiJudgeAuth";

interface LoginPayload {
  username?: string;
  password?: string;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  is_active: number;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json().catch(() => ({}))) as LoginPayload;
  const username = (body.username || "").trim();
  const password = body.password || "";
  if (!username || !password) return json({ error: "Invalid credentials" }, { status: 401 });
  const user = await env.DB.prepare(
    "SELECT id, username, display_name, password_hash, is_active FROM ai_judge_users WHERE username = ? AND is_active = 1"
  ).bind(username).first<UserRow>();
  if (!user) return json({ error: "Invalid credentials" }, { status: 401 });
  const valid = (await hashPassword(password)) === user.password_hash;
  if (!valid) return json({ error: "Invalid credentials" }, { status: 401 });
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ai_judge_sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, user.id, expiresAt),
    env.DB.prepare("UPDATE ai_judge_users SET last_login_at = ? WHERE id = ?").bind(now, user.id)
  ]);
  return json({ token, user: { id: user.id, username: user.username, display_name: user.display_name }, expires_at: expiresAt });
};
