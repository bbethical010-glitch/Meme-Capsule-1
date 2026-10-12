-- ============================================================
-- Migration 013: Add an explicit NSFW moderation flag
-- ============================================================

ALTER TABLE memes ADD COLUMN is_nsfw INTEGER NOT NULL DEFAULT 0
  CHECK (is_nsfw IN (0, 1));
