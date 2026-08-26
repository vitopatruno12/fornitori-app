-- Enable Banking (AIS): sessioni e account remoti su bank_accounts
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS eb_session_id VARCHAR(64);
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS eb_account_uid VARCHAR(64);
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS eb_aspsp_name VARCHAR(120);
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS eb_aspsp_country VARCHAR(2);
