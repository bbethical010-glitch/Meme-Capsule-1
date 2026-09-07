-- AI Judge operator accounts
CREATE TABLE IF NOT EXISTS ai_judge_users (
  id            TEXT PRIMARY KEY DEFAULT ('aiju-' || hex(randomblob(4))),
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_judge_sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES ai_judge_users(id)
);

CREATE INDEX idx_ai_judge_sessions_user ON ai_judge_sessions(user_id);
CREATE INDEX idx_ai_judge_sessions_exp  ON ai_judge_sessions(expires_at);

CREATE TABLE IF NOT EXISTS ai_judge_config (
  user_id       TEXT PRIMARY KEY,
  provider      TEXT NOT NULL DEFAULT 'nvidia',
  model         TEXT NOT NULL DEFAULT 'meta/llama-3.2-11b-vision-instruct',
  api_key       TEXT NOT NULL,
  max_retries   INTEGER NOT NULL DEFAULT 3,
  temperature   REAL NOT NULL DEFAULT 0.0,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES ai_judge_users(id)
);

CREATE TABLE IF NOT EXISTS ai_judge_runs (
  id           TEXT PRIMARY KEY DEFAULT ('run-' || hex(randomblob(6))),
  user_id      TEXT NOT NULL,
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running',
  total_queued INTEGER NOT NULL DEFAULT 0,
  processed    INTEGER NOT NULL DEFAULT 0,
  succeeded    INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  skipped      INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  stopped_at   TEXT,
  FOREIGN KEY (user_id) REFERENCES ai_judge_users(id)
);

CREATE TABLE IF NOT EXISTS ai_judge_processed (
  id           TEXT PRIMARY KEY DEFAULT ('aip-' || hex(randomblob(6))),
  meme_id      TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  decision     TEXT,
  topics       TEXT,
  tone         TEXT,
  mechanisms   TEXT,
  confidence   REAL,
  reasoning    TEXT,
  raw_response TEXT,
  model        TEXT NOT NULL,
  provider     TEXT NOT NULL,
  tokens_used  INTEGER DEFAULT 0,
  duration_ms  INTEGER DEFAULT 0,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(meme_id, run_id),
  FOREIGN KEY (meme_id) REFERENCES memes(id),
  FOREIGN KEY (run_id)  REFERENCES ai_judge_runs(id),
  FOREIGN KEY (user_id) REFERENCES ai_judge_users(id)
);

CREATE INDEX idx_ai_processed_meme   ON ai_judge_processed(meme_id);
CREATE INDEX idx_ai_processed_run    ON ai_judge_processed(run_id);
CREATE INDEX idx_ai_processed_user   ON ai_judge_processed(user_id);

INSERT OR IGNORE INTO ai_judge_users (username, display_name, password_hash)
VALUES ('aijudge', 'AI Judge Operator', 'REPLACE_WITH_SHA256_HASH');
