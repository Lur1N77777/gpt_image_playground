ALTER TABLE jobs ADD COLUMN codex_cli INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_jobs_codex_cli ON jobs(codex_cli);
