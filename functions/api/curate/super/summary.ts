/**
 * GET /api/curate/super/summary
 * 
 * Aggregates multi-judge curation statistics, consensus metrics, and resolution progress.
 */

import type { PagesFunction } from "../../../_shared/pages";
import { json, type Env } from "../../../_shared/d1r2";
import { validateSession } from "../../../_shared/catAuth";
import { ensureCurationTables } from "../../../_shared/curateDb";

interface JudgeCountRow {
  user_id: string;
  user_name: string;
  total_reviewed: number;
  kept: number;
  excluded: number;
  duplicates: number;
  review_later: number;
  last_active: string;
}

interface CurationRow {
  meme_id: string;
  user_id: string;
  corpus_status: string;
  duplicate_of: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureCurationTables(env.DB);
    const sessionUser = await validateSession(request, env);
    if (!sessionUser || sessionUser.role !== "superadmin") {
      return json({ error: "Superadmin credentials required." }, { status: 401 });
    }

    // 1. Total memes in corpus (excluding force-removed)
    let totalMemes = 0;
    try {
      const totalCountRes = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM memes WHERE id NOT IN (SELECT meme_id FROM meme_force_removals)"
      ).first<{ cnt: number }>();
      totalMemes = totalCountRes?.cnt ?? 0;
    } catch {
      const totalCountRes = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM memes"
      ).first<{ cnt: number }>();
      totalMemes = totalCountRes?.cnt ?? 0;
    }

    // 2. Final resolved count (Authoritative Keep / Active vs Excluded)
    let resolvedActiveCount = 0;
    let resolvedExcludedCount = 0;
    let totalResolvedCount = 0;
    try {
      const finalRes = await env.DB.prepare(`
        SELECT 
          COUNT(*) as total_resolved,
          SUM(CASE WHEN corpus_status = 'keep' THEN 1 ELSE 0 END) as resolved_active,
          SUM(CASE WHEN corpus_status = 'excluded' THEN 1 ELSE 0 END) as resolved_excluded
        FROM meme_curation_final
      `).first<{ total_resolved: number; resolved_active: number; resolved_excluded: number }>();

      totalResolvedCount = finalRes?.total_resolved ?? 0;
      resolvedActiveCount = finalRes?.resolved_active ?? 0;
      resolvedExcludedCount = finalRes?.resolved_excluded ?? 0;
    } catch {
      totalResolvedCount = 0;
      resolvedActiveCount = 0;
      resolvedExcludedCount = 0;
    }

    // 3. Per-judge progress breakdown (Active human judges only)
    const { results: judgeResults } = await env.DB.prepare(`
      SELECT 
        user_id,
        user_name,
        COUNT(*) as total_reviewed,
        SUM(CASE WHEN corpus_status = 'keep' THEN 1 ELSE 0 END) as kept,
        SUM(CASE WHEN corpus_status = 'excluded' THEN 1 ELSE 0 END) as excluded,
        SUM(CASE WHEN corpus_status = 'duplicate' THEN 1 ELSE 0 END) as duplicates,
        SUM(CASE WHEN corpus_status = 'review_later' THEN 1 ELSE 0 END) as review_later,
        MAX(reviewed_at) as last_active
      FROM meme_curation c
      JOIN cat_users u ON u.id = c.user_id
      WHERE u.username IN ('judge1', 'judge2', 'judge3')
      GROUP BY c.user_id, c.user_name
      ORDER BY total_reviewed DESC
    `).all<JudgeCountRow>();

    const judges = judgeResults || [];

    // 4. Consensus & disagreement analysis across multi-judge reviews (Human judges only)
    const { results: allReviews } = await env.DB.prepare(`
      SELECT c.meme_id, c.user_id, c.corpus_status, c.duplicate_of
      FROM meme_curation c
      JOIN cat_users u ON u.id = c.user_id
      WHERE u.username IN ('judge1', 'judge2', 'judge3')
    `).all<CurationRow>();

    const reviews = allReviews || [];
    const memeReviewMap = new Map<string, CurationRow[]>();

    for (const r of reviews) {
      if (!memeReviewMap.has(r.meme_id)) {
        memeReviewMap.set(r.meme_id, []);
      }
      memeReviewMap.get(r.meme_id)!.push(r);
    }

    let unanimousKeep = 0;
    let unanimousExclude = 0;
    let conflicts = 0;
    let singleReview = 0;
    let reviewedMemeCount = memeReviewMap.size;

    for (const [, statuses] of memeReviewMap.entries()) {
      if (statuses.length === 1) {
        singleReview++;
      } else if (statuses.length > 1) {
      if (statuses.length === 3) {
        const distinctStatuses = new Set(statuses.map((vote) => vote.corpus_status));
        if (distinctStatuses.size === 3) {
          conflicts++;
        } else {
          const duplicateVotes = statuses.filter((vote) => vote.corpus_status === "duplicate");
          if (
            duplicateVotes.length >= 2 &&
            (duplicateVotes.some((vote) => !vote.duplicate_of?.trim()) ||
              new Set(duplicateVotes.map((vote) => vote.duplicate_of?.trim() || null)).size > 1)
          ) conflicts++;
        }
        if (distinctStatuses.size === 1) {
          const onlyStatus = statuses[0].corpus_status;
          if (onlyStatus === "keep") unanimousKeep++;
          else if (onlyStatus === "excluded") unanimousExclude++;
        }
      }
      }
    }

    const unreviewed = Math.max(0, totalMemes - reviewedMemeCount);

    return json({
      total_memes: totalMemes,
      resolved_count: resolvedActiveCount, // Canonical Authoritative Active count (111) — matches /admin Active!
      resolved_active_count: resolvedActiveCount,
      resolved_excluded_count: resolvedExcludedCount,
      total_resolved_count: totalResolvedCount,
      percent_resolved: totalMemes > 0 ? Math.round((resolvedActiveCount / totalMemes) * 100) : 0,
      consensus_metrics: {
        unreviewed,
        single_review: singleReview,
        unanimous_keep: unanimousKeep,
        unanimous_exclude: unanimousExclude,
        conflicts,
        total_with_reviews: reviewedMemeCount
      },
      judges
    });
  } catch (err: unknown) {
    if (err instanceof Response) return err;
    const msg = err instanceof Error ? err.message : "Error generating superadmin summary";
    return json({ error: msg }, { status: 500 });
  }
};
