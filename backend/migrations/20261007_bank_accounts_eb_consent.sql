-- Scadenza consenso Enable Banking (AIS) per avviso ricollegamento conti.
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS eb_consent_valid_until TIMESTAMPTZ;
