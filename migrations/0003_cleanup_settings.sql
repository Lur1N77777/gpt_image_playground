CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES
  ('cleanup_retention_hours', '24', 0),
  ('cleanup_interval_hours', '0', 0),
  ('cleanup_last_run_at', '0', 0);
