-- Documenti PDF personale (contratti, buste paga, documenti anagrafici)
CREATE TABLE IF NOT EXISTS staff_documents (
  id SERIAL PRIMARY KEY,
  category VARCHAR(40) NOT NULL,
  doc_type VARCHAR(40) NOT NULL DEFAULT 'altro',
  locale_name VARCHAR(120) NULL,
  year_month VARCHAR(7) NULL,
  staff_member_id INTEGER NULL REFERENCES staff_members(id) ON DELETE SET NULL,
  first_name VARCHAR(120) NULL,
  last_name VARCHAR(120) NULL,
  birth_date DATE NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(64) NULL,
  ruolo VARCHAR(120) NULL,
  document_number VARCHAR(80) NULL,
  storage_path VARCHAR(512) NOT NULL,
  original_name VARCHAR(255) NULL,
  mime_type VARCHAR(120) NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_staff_documents_category ON staff_documents (category);
CREATE INDEX IF NOT EXISTS ix_staff_documents_locale ON staff_documents (locale_name);
CREATE INDEX IF NOT EXISTS ix_staff_documents_year_month ON staff_documents (year_month);
CREATE INDEX IF NOT EXISTS ix_staff_documents_member ON staff_documents (staff_member_id);
