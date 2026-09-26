-- 008_optimize_curation_indexes.sql
-- Optimizes D1 queries for curation, random selection, and AI predictions.
-- Eliminates full table scans on memes table (reducing row reads from ~11,000 to ~3 per meme).

-- 1. Index on memes(uploaded_at) for fast next/previous queue traversal
CREATE INDEX IF NOT EXISTS idx_memes_uploaded_at ON memes(uploaded_at);

-- 2. Composite index on memes for fast random meme selection and active checks
CREATE INDEX IF NOT EXISTS idx_memes_active_rand ON memes(is_active, status, random_key);

-- 3. Composite index on meme_curation for fast multi-judge queue filtering and review checks
CREATE INDEX IF NOT EXISTS idx_curation_composite ON meme_curation(user_id, corpus_status, meme_id);

-- 4. Index on ai_curation_predictions for instant joins with zero table scan overhead
CREATE INDEX IF NOT EXISTS idx_ai_predictions_meme ON ai_curation_predictions(meme_id);
