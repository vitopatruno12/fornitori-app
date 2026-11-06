-- Sala Gazza Ladra condivisa tra postazione e palmari (un foglio per data e fascia).
CREATE TABLE IF NOT EXISTS gazza_sala_sheets (
  id SERIAL PRIMARY KEY,
  service_date VARCHAR(10) NOT NULL,
  fascia VARCHAR(16) NOT NULL,
  tables_json TEXT NOT NULL DEFAULT '[]',
  history_json TEXT NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_gazza_sala_date_fascia UNIQUE (service_date, fascia)
);

CREATE INDEX IF NOT EXISTS ix_gazza_sala_sheets_service_date ON gazza_sala_sheets (service_date);
CREATE INDEX IF NOT EXISTS ix_gazza_sala_sheets_fascia ON gazza_sala_sheets (fascia);
