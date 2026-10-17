import type { Env } from "./d1r2";

interface MemeRow {
  id: string;
  storage_path: string | null;
  image_url: string | null;
}

/** Shared implementation used by the manual and unanimous-consensus remove paths. */
export async function hardRemoveMeme(env: Env, memeId: string, reason: string): Promise<void> {
  const memeRow = await env.DB.prepare(
    "SELECT id, storage_path, image_url FROM memes WHERE id = ?",
  ).bind(memeId).first<MemeRow>();

  const bucket = env.MEMES_BUCKET || (env as any).R2_BUCKET;
  if (bucket && memeRow) {
    const keysToDelete: string[] = [];
    if (memeRow.storage_path) keysToDelete.push(memeRow.storage_path.replace(/^\/+/, ""));
    if (!memeRow.storage_path && memeRow.image_url) {
      try {
        const pathKey = new URL(memeRow.image_url).pathname.replace(/^\/+/, "");
        if (pathKey) keysToDelete.push(pathKey);
      } catch {
        // The URL may not point to an R2 object.
      }
    }

    for (const key of keysToDelete) {
      try {
        await bucket.delete(key);
      } catch (error) {
        console.warn(`[force-remove] Could not delete R2 key ${key}:`, error);
      }
    }
  }

  const tablesToClean = [
    "meme_curation",
    "meme_curation_final",
    "ai_curation_predictions",
    "meme_events",
    "meme_analytics",
    "meme_daily_stats",
    "memes",
  ];
  const statements: D1PreparedStatement[] = [];
  for (const table of tablesToClean) {
    statements.push(
      env.DB.prepare(`DELETE FROM ${table} WHERE ${table === "memes" ? "id" : "meme_id"} = ?`).bind(memeId),
    );
  }

  try {
    await env.DB.batch(statements);
  } catch {
    await env.DB.prepare("DELETE FROM meme_curation WHERE meme_id = ?").bind(memeId).run().catch(() => {});
    await env.DB.prepare("DELETE FROM meme_curation_final WHERE meme_id = ?").bind(memeId).run().catch(() => {});
    await env.DB.prepare("DELETE FROM ai_curation_predictions WHERE meme_id = ?").bind(memeId).run().catch(() => {});
    await env.DB.prepare("DELETE FROM memes WHERE id = ?").bind(memeId).run().catch(() => {});
  }

  console.info("[force-remove] hard-purged meme", { meme_id: memeId, reason });
}
