-- ============================================================
-- Migration 010: Enforce Superadmin Finalization as Authority for ACTIVE
-- and Remove the 3 Marked Judges from System Records
-- 
-- Run via Wrangler:
--   npx wrangler d1 execute meme-capsule-db --remote --file=d1/migrations/010_enforce_superadmin_active_and_cleanup_judges.sql
-- Or copy & execute directly inside Cloudflare Dashboard D1 Console
-- ============================================================

-- 1. Remove reviews by the 2 marked rogue judges from meme_curation
-- (Leaves Judge One, Two, Three, Four, and Five 100% untouched)
DELETE FROM meme_curation WHERE user_name = 'AI Judge';
DELETE FROM meme_curation WHERE user_name = 'Judge';

-- 2. Clean up any rogue user accounts or sessions matching those names in cat_users
DELETE FROM cat_sessions WHERE user_id IN (SELECT id FROM cat_users WHERE username IN ('aijudge', 'judge') OR display_name IN ('AI Judge', 'Judge'));
DELETE FROM cat_judge_ai_presets WHERE user_id IN (SELECT id FROM cat_users WHERE username IN ('aijudge', 'judge') OR display_name IN ('AI Judge', 'Judge'));
DELETE FROM cat_users WHERE username IN ('aijudge', 'judge') OR display_name IN ('AI Judge', 'Judge');

-- 3. Clear legacy ai_cat_decisions (the 340 decisions corresponding to the removed purple AI Judge card)
DELETE FROM ai_cat_decisions;

-- 4. Reconcile Meme Corpus Status with Superadmin Authoritative Finalization:

-- 4A: Memes authoritatively resolved as 'keep' by Superadmin -> ACTIVE (Eligible for public spawn)
UPDATE memes
SET status = 'active', is_active = 1
WHERE id IN (
  SELECT meme_id FROM meme_curation_final WHERE corpus_status = 'keep'
);

-- 4B: Memes authoritatively resolved as 'excluded', 'duplicate', or 'review_later' by Superadmin -> ARCHIVED
UPDATE memes
SET status = 'archived', is_active = 0
WHERE id IN (
  SELECT meme_id FROM meme_curation_final WHERE corpus_status IN ('excluded', 'duplicate', 'review_later')
);

-- 4C: All memes NOT YET resolved by Superadmin (excluding explicit drafts) -> ARCHIVED
-- (Ineligible for public spawn until Superadmin resolves them as 'keep')
UPDATE memes
SET status = 'archived', is_active = 0
WHERE id NOT IN (
  SELECT meme_id FROM meme_curation_final
) AND status != 'draft';
