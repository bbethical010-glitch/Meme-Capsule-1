import type { PagesFunction } from "../../_shared/pages";
import { json, type Env } from "../../_shared/d1r2";
import { requireAiJudgeAuth } from "../../_shared/aiJudgeAuth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireAiJudgeAuth(request, env);
  const { results } = await env.DB.prepare(`
    SELECT id, provider, model, status, total_queued, processed, succeeded, failed, skipped, started_at, stopped_at
    FROM ai_judge_runs
    WHERE user_id = ?
    ORDER BY started_at DESC
  `).bind(user.id).all<Record<string, unknown>>();
  return json({ runs: results || [] });
};
