-- Tabelle assistenza tecnici (opzionale: l'app crea anche le tabelle da SQLAlchemy metadata.create_all)

CREATE TABLE IF NOT EXISTS support_technicians (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    specialty VARCHAR(255),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS technician_activities (
    id SERIAL PRIMARY KEY,
    technician_id INTEGER NOT NULL REFERENCES support_technicians(id) ON DELETE CASCADE,
    activity_date DATE NOT NULL,
    time_start VARCHAR(5),
    time_end VARCHAR(5),
    location VARCHAR(512),
    notes TEXT,
    kind VARCHAR(32) NOT NULL DEFAULT 'planned'
);

CREATE INDEX IF NOT EXISTS ix_technician_activities_technician_id ON technician_activities (technician_id);
CREATE INDEX IF NOT EXISTS ix_technician_activities_activity_date ON technician_activities (activity_date);
