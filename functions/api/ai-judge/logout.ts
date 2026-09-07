import type { PagesFunction } from "../../_shared/pages";
import { json, type Env } from "../../_shared/d1r2";
import { requireAiJudgeAuth, validateAiJudgeSession } from "../../_shared/aiJudgeAuth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireAiJudgeAuth(request, env);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token) {
    await env.DB.prepare("DELETE FROM ai_judge_sessions WHERE token = ? AND user_id = ?").bind(token, user.id).run();
  }
  return json({ success: true });
};
