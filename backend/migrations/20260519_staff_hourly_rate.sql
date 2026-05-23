-- Tariffa oraria dipendente (€/h) per calcolo costo periodo in Personale.
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10, 2);
