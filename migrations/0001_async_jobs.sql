CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  params_json TEXT NOT NULL,
  model TEXT NOT NULL,
  input_image_keys_json TEXT NOT NULL DEFAULT '[]',
  output_image_keys_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'error')),
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  elapsed INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
