-- Modulo Banca: conti correnti e movimenti.
CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  bank_name VARCHAR(160) NOT NULL,
  account_name VARCHAR(160) NOT NULL DEFAULT 'Conto corrente',
  iban VARCHAR(34),
  saldo_disponibile NUMERIC(14, 2) NOT NULL DEFAULT 0,
  saldo_contabile NUMERIC(14, 2) NOT NULL DEFAULT 0,
  connection_status VARCHAR(32) NOT NULL DEFAULT 'disconnected',
  last_sync_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_movements (
  id SERIAL PRIMARY KEY,
  bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  movement_date DATE NOT NULL,
  description VARCHAR(512),
  causale VARCHAR(256),
  movement_type VARCHAR(16) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  counterparty VARCHAR(256),
  category VARCHAR(120),
  reconciliation_status VARCHAR(32) NOT NULL DEFAULT 'unmatched',
  matched_invoice_id INTEGER REFERENCES invoices(id),
  matched_cash_entry_id INTEGER REFERENCES cash_entries(id),
  difference_amount NUMERIC(14, 2),
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_bank_movements_account ON bank_movements (bank_account_id);
CREATE INDEX IF NOT EXISTS ix_bank_movements_date ON bank_movements (movement_date DESC);
CREATE INDEX IF NOT EXISTS ix_bank_movements_status ON bank_movements (reconciliation_status);
