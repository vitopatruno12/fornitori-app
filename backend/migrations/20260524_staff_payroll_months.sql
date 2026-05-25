-- Archivio stipendi mensili (snapshot ore, tariffe, importi)

CREATE TABLE IF NOT EXISTS staff_payroll_months (
  id SERIAL PRIMARY KEY,
  year_month VARCHAR(7) NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  lines_json TEXT NOT NULL DEFAULT '[]',
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_staff_payroll_months_year_month UNIQUE (year_month)
);

CREATE INDEX IF NOT EXISTS ix_staff_payroll_months_year_month ON staff_payroll_months (year_month DESC);
