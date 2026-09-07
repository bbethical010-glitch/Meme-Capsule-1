import type { PagesFunction } from "../../_shared/pages";
import { json, type Env } from "../../_shared/d1r2";
import { requireAiJudgeAuth } from "../../_shared/aiJudgeAuth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireAiJudgeAuth(request, env);
  const config = await env.DB.prepare(
    "SELECT provider, model, api_key FROM ai_judge_config WHERE user_id = ?"
  ).bind(user.id).first<{ provider: string; model: string; api_key: string }>();
  return json({ provider: config?.provider || "nvidia", model: config?.model || "meta/llama-3.2-11b-vision-instruct", has_api_key: Boolean(config?.api_key) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireAiJudgeAuth(request, env);
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const provider = body.provider === "openai" ? "openai" : "nvidia";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : provider === "openai" ? "gpt-4o-mini" : "meta/llama-3.2-11b-vision-instruct";
  const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
  const maxRetries = Math.min(5, Math.max(1, Number(body.max_retries) || 3));
  const temperature = Number(body.temperature);
  const existing = await env.DB.prepare("SELECT api_key FROM ai_judge_config WHERE user_id = ?").bind(user.id).first<{ api_key: string }>();
  const nextKey = apiKey || existing?.api_key;
  if (!nextKey) return json({ error: "api_key is required." }, { status: 400 });
  await env.DB.prepare(`
    INSERT INTO ai_judge_config (user_id, provider, model, api_key, max_retries, temperature, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      provider = excluded.provider,
      model = excluded.model,
      api_key = excluded.api_key,
      max_retries = excluded.max_retries,
      temperature = excluded.temperature,
      updated_at = excluded.updated_at
  `).bind(user.id, provider, model, nextKey, maxRetries, Number.isFinite(temperature) ? temperature : 0, new Date().toISOString()).run();
  return json({ provider, model, has_api_key: true });
};
