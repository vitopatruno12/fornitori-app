-- Allinea password utente a backend/.env (postgresql://fornitori_user:fornitori_pass@...)
-- Esegui come superuser, es.: psql -U postgres -f backend/scripts/dev_postgres_fornitori.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fornitori_user') THEN
    CREATE ROLE fornitori_user LOGIN PASSWORD 'fornitori_pass';
  END IF;
END
$$;

ALTER ROLE fornitori_user WITH PASSWORD 'fornitori_pass';

-- Se il database non esiste ancora, decommenta ed esegui:
-- CREATE DATABASE fornitori_db OWNER fornitori_user;
