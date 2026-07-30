-- Archivio stipendi mensili (Nominativo, Busta, Acconto TFR, Fuori)

CREATE TABLE IF NOT EXISTS staff_stipendi_months (
  id SERIAL PRIMARY KEY,
  year_month VARCHAR(7) NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  lines_json TEXT NOT NULL DEFAULT '[]',
  total_busta NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_tfr NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_fuori NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_staff_stipendi_months_year_month UNIQUE (year_month)
);

CREATE INDEX IF NOT EXISTS ix_staff_stipendi_months_year_month ON staff_stipendi_months (year_month DESC);
