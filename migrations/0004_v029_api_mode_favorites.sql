ALTER TABLE jobs ADD COLUMN api_mode TEXT NOT NULL DEFAULT 'images';
ALTER TABLE jobs ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_jobs_api_mode ON jobs(api_mode);
CREATE INDEX IF NOT EXISTS idx_jobs_is_favorite ON jobs(is_favorite);