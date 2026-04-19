ALTER TABLE technician_activities
    ADD COLUMN IF NOT EXISTS time_start VARCHAR(5),
    ADD COLUMN IF NOT EXISTS time_end VARCHAR(5);

