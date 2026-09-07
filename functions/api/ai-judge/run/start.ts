import type { PagesFunction } from "../../../_shared/pages";
import { json, type Env } from "../../../_shared/d1r2";
import { requireAiJudgeAuth } from "../../../_shared/aiJudgeAuth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireAiJudgeAuth(request, env);
  const cfg = await env.DB.prepare("SELECT provider, model FROM ai_judge_config WHERE user_id = ?").bind(user.id).first<{ provider: string; model: string }>();
  const provider = cfg?.provider || "nvidia";
  const model = cfg?.model || "meta/llama-3.2-11b-vision-instruct";
  const total = await env.DB.prepare("SELECT COUNT(*) as total FROM memes WHERE is_active = 1").first<{ total: number }>();
  const runId = `run-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO ai_judge_runs (id, user_id, provider, model, status, total_queued) VALUES (?, ?, ?, ?, 'running', ?)").bind(runId, user.id, provider, model, total?.total ?? 0).run();
  return json({ run_id: runId, total_queued: total?.total ?? 0 });
};
