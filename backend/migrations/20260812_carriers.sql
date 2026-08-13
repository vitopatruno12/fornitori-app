-- Trasportatori: anagrafica, manutenzione mezzo, carburante, altre spese
CREATE TABLE IF NOT EXISTS carriers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(32),
  email VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  out_of_service BOOLEAN NOT NULL DEFAULT FALSE,
  in_service BOOLEAN NOT NULL DEFAULT FALSE,
  rest_day INTEGER,
  van_label VARCHAR(120),
  van_plate VARCHAR(32),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_carriers_name ON carriers (name);
CREATE INDEX IF NOT EXISTS ix_carriers_is_active ON carriers (is_active);

CREATE TABLE IF NOT EXISTS carrier_maintenance_logs (
  id SERIAL PRIMARY KEY,
  carrier_id INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  description VARCHAR(512) NOT NULL,
  odometer_km INTEGER,
  cost NUMERIC(10, 2),
  workshop VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_carrier_maintenance_carrier ON carrier_maintenance_logs (carrier_id);
CREATE INDEX IF NOT EXISTS ix_carrier_maintenance_date ON carrier_maintenance_logs (service_date);

CREATE TABLE IF NOT EXISTS carrier_fuel_expenses (
  id SERIAL PRIMARY KEY,
  carrier_id INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  liters NUMERIC(10, 2),
  amount_eur NUMERIC(10, 2) NOT NULL,
  station VARCHAR(255),
  odometer_km INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_carrier_fuel_carrier ON carrier_fuel_expenses (carrier_id);
CREATE INDEX IF NOT EXISTS ix_carrier_fuel_date ON carrier_fuel_expenses (expense_date);

CREATE TABLE IF NOT EXISTS carrier_other_expenses (
  id SERIAL PRIMARY KEY,
  carrier_id INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  category VARCHAR(120),
  amount_eur NUMERIC(10, 2) NOT NULL,
  description VARCHAR(512),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_carrier_other_carrier ON carrier_other_expenses (carrier_id);
CREATE INDEX IF NOT EXISTS ix_carrier_other_date ON carrier_other_expenses (expense_date);

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS carrier_id INTEGER REFERENCES carriers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_deliveries_carrier_id ON deliveries (carrier_id);
