-- Stipendi per locale (ogni negozio ha il proprio archivio mensile)
ALTER TABLE staff_stipendi_months
  ADD COLUMN IF NOT EXISTS locale_name VARCHAR(255) NOT NULL DEFAULT '';

ALTER TABLE staff_stipendi_months
  DROP CONSTRAINT IF EXISTS uq_staff_stipendi_months_year_month;

DROP INDEX IF EXISTS uq_staff_stipendi_months_year_month;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_stipendi_months_locale_ym
  ON staff_stipendi_months (locale_name, year_month);

CREATE INDEX IF NOT EXISTS ix_staff_stipendi_months_locale_name
  ON staff_stipendi_months (locale_name);
