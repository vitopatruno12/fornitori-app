ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phones_json TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS emails_json TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cities_json TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS merchandise_categories_json TEXT;
