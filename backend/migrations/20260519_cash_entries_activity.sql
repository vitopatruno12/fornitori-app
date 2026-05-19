-- Prima nota per attività: Risacca, La Via Lattea, La Mediazione
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS activity VARCHAR(32);
CREATE INDEX IF NOT EXISTS ix_cash_entries_activity ON cash_entries (activity);
