import type { PagesFunction } from "../../_shared/pages";
import { json, type Env } from "../../_shared/d1r2";
import { requireAiJudgeAuth } from "../../_shared/aiJudgeAuth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireAiJudgeAuth(request, env);
  const url = new URL(request.url);
  const runId = (url.searchParams.get("run_id") || "").trim();
  if (!runId) return json({ error: "run_id is required." }, { status: 400 });
  const run = await env.DB.prepare("SELECT id FROM ai_judge_runs WHERE id = ? AND user_id = ?").bind(runId, user.id).first<{ id: string }>();
  if (!run) return json({ error: "Run not found." }, { status: 404 });
  const meme = await env.DB.prepare(`
    SELECT m.id, m.image_url, m.storage_path, m.title
    FROM memes m
    WHERE m.is_active = 1
      AND m.id NOT IN (SELECT meme_id FROM ai_judge_processed WHERE run_id = ?)
    ORDER BY m.random_key
    LIMIT 1
  `).bind(runId).first<{ id: string; image_url: string | null; storage_path: string | null; title: string | null }>();
  const total = await env.DB.prepare("SELECT COUNT(*) as total FROM memes WHERE is_active = 1").first<{ total: number }>();
  const done = await env.DB.prepare("SELECT COUNT(*) as done FROM ai_judge_processed WHERE run_id = ?").bind(runId).first<{ done: number }>();
  const processed = done?.done ?? 0;
  const totalCount = total?.total ?? 0;
  return json({ meme: meme ? { id: meme.id, image_url: meme.image_url || "", title: meme.title || "Untitled Meme" } : null, progress: { processed, total: totalCount, percent: totalCount ? Math.round((processed / totalCount) * 100) : 0 } });
};
