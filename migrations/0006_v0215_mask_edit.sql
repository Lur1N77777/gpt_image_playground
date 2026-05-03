ALTER TABLE jobs ADD COLUMN mask_target_image_key TEXT;
ALTER TABLE jobs ADD COLUMN mask_image_key TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_mask_target_image_key ON jobs(mask_target_image_key);
CREATE INDEX IF NOT EXISTS idx_jobs_mask_image_key ON jobs(mask_image_key);
