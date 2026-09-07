import type { PagesFunction } from "../../../_shared/pages";
import { json, type Env } from "../../../_shared/d1r2";
import { requireAiJudgeAuth } from "../../../_shared/aiJudgeAuth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireAiJudgeAuth(request, env);
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const runId = typeof body.run_id === "string" ? body.run_id.trim() : "";
  if (!runId) return json({ error: "run_id is required." }, { status: 400 });
  await env.DB.prepare("UPDATE ai_judge_runs SET status = 'stopped', stopped_at = ? WHERE id = ? AND user_id = ?").bind(new Date().toISOString(), runId, user.id).run();
  return json({ success: true });
};
