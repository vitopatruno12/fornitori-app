-- Eseguire come superuser postgres (locale o server) per correggere ownership.
-- psql -U postgres -d fornitori_db -f fix_atlas_table_owners.sql

DO $$
DECLARE
  app_user text := 'fornitori_user';
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'warehouse_movements',
    'supplier_payments_workbooks',
    'staff_stipendi_months',
    'staff_payroll_months',
    'staff_locale_packs',
    'staff_backups',
    'bank_accounts',
    'bank_movements',
    'carriers',
    'carrier_maintenance_logs',
    'carrier_fuel_expenses',
    'carrier_other_expenses',
    'electronic_invoices',
    'incoming_invoices',
    'incoming_invoice_lines',
    'pos_receipts',
    'prima_nota_locale_packs'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE %I OWNER TO %I', t, app_user);
      IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = t || '_id_seq' AND c.relkind = 'S'
      ) THEN
        EXECUTE format('ALTER SEQUENCE %I OWNER TO %I', t || '_id_seq', app_user);
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO %I', t || '_id_seq', app_user);
      END IF;
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I', t, app_user);
    END IF;
  END LOOP;
END $$;
