/**
 * POST /api/curate/nsfw
 *
 * Toggles the explicit NSFW moderation flag for a meme.
 */

import type { PagesFunction } from "../../_shared/pages";
import { json, handleD1Error, type Env } from "../../_shared/d1r2";
import { requireAuth } from "../../_shared/catAuth";
import { ensureNsfwColumn } from "../../_shared/curateDb";

interface NsfwPayload {
  meme_id?: string;
  is_nsfw?: boolean;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAuth(request, env);
    await ensureNsfwColumn(env.DB);

    const body = (await request.json().catch(() => ({}))) as NsfwPayload;
    const memeId = (body.meme_id || "").trim();
    if (!memeId) {
      return json({ error: "meme_id is required." }, { status: 400 });
    }
    if (typeof body.is_nsfw !== "boolean") {
      return json({ error: "is_nsfw must be a boolean." }, { status: 400 });
    }

    const meme = await env.DB.prepare("SELECT id FROM memes WHERE id = ?")
      .bind(memeId)
      .first<{ id: string }>();
    if (!meme) {
      return json({ error: "Meme not found." }, { status: 404 });
    }

    await env.DB.prepare("UPDATE memes SET is_nsfw = ? WHERE id = ?")
      .bind(body.is_nsfw ? 1 : 0, memeId)
      .run();

    return json({ success: true, meme_id: memeId, is_nsfw: body.is_nsfw });
  } catch (err: unknown) {
    return handleD1Error(err, "Error updating NSFW flag");
  }
};
