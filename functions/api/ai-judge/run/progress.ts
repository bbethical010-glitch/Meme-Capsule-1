import type { PagesFunction } from "../../../_shared/pages";
import { json, type Env } from "../../../_shared/d1r2";
import { requireAiJudgeAuth } from "../../../_shared/aiJudgeAuth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireAiJudgeAuth(request, env);
  const url = new URL(request.url);
  const runId = (url.searchParams.get("run_id") || "").trim();
  if (!runId) return json({ error: "run_id is required." }, { status: 400 });
  const run = await env.DB.prepare("SELECT id, status, total_queued, processed, succeeded, failed, started_at, stopped_at FROM ai_judge_runs WHERE id = ? AND user_id = ?").bind(runId, user.id).first<Record<string, unknown>>();
  if (!run) return json({ error: "Run not found." }, { status: 404 });
  const recent = await env.DB.prepare(`
    SELECT p.meme_id, m.image_url, p.decision, p.tone, p.confidence, p.created_at
    FROM ai_judge_processed p
    LEFT JOIN memes m ON m.id = p.meme_id
    WHERE p.run_id = ?
    ORDER BY p.created_at DESC
    LIMIT 10
  `).bind(runId).all<Record<string, unknown>>();
  const breakdown = await env.DB.prepare(`
    SELECT COALESCE(decision, 'failed') as decision, COUNT(*) as count
    FROM ai_judge_processed
    WHERE run_id = ?
    GROUP BY COALESCE(decision, 'failed')
  `).bind(runId).all<Record<string, unknown>>();
  return json({ run, recent_decisions: recent.results || [], decision_breakdown: breakdown.results || [] });
};
