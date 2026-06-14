-- Backup pianificazione e ore/costi (condivisi tra PC/browser)
CREATE TABLE IF NOT EXISTS staff_backups (
  id SERIAL PRIMARY KEY,
  section VARCHAR(32) NOT NULL,
  backup_key VARCHAR(255) NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_staff_backups_section_key UNIQUE (section, backup_key)
);

CREATE INDEX IF NOT EXISTS ix_staff_backups_section ON staff_backups (section);
CREATE INDEX IF NOT EXISTS ix_staff_backups_key ON staff_backups (backup_key);
