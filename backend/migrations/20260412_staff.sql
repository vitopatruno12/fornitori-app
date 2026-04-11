-- Personale: dipendenti e pianificazione turni / permessi / assenze / malattia

CREATE TABLE IF NOT EXISTS staff_members (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_staff_members_name ON staff_members (name);

CREATE TABLE IF NOT EXISTS staff_shift_entries (
  id SERIAL PRIMARY KEY,
  staff_member_id INTEGER NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  time_start TIME,
  time_end TIME,
  entry_kind VARCHAR(32) NOT NULL DEFAULT 'shift',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_staff_shift_entries_work_date ON staff_shift_entries (work_date);
CREATE INDEX IF NOT EXISTS ix_staff_shift_entries_staff ON staff_shift_entries (staff_member_id);
