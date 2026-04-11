-- PostgreSQL: anagrafica estesa dipendenti (personale).
-- Eseguire una volta (psql -f ...). IF NOT EXISTS evita errori se già applicata.

ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS first_name VARCHAR(120);
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS last_name VARCHAR(120);
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS phone VARCHAR(64);
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS city VARCHAR(128);
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS birth_date DATE;
