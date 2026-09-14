"""One-shot: migrate EB columns + seed BPPB/UniCredit accounts."""
from sqlalchemy import text

from app.database import SessionLocal, engine
from app.services import banca_service

SQL = [
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS company VARCHAR(64)",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS ledger_code VARCHAR(16) DEFAULT '1100'",
    "UPDATE bank_accounts SET ledger_code = '1100' WHERE ledger_code IS NULL OR trim(ledger_code) = ''",
    "CREATE INDEX IF NOT EXISTS ix_bank_accounts_company ON bank_accounts (company)",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS eb_session_id VARCHAR(64)",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS eb_account_uid VARCHAR(64)",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS eb_aspsp_name VARCHAR(120)",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS eb_aspsp_country VARCHAR(2)",
]

with engine.begin() as conn:
    for sql in SQL:
        conn.execute(text(sql))
        print("ok", sql.split()[-1])


def ensure(db, *, bank_name, account_name, iban, notes, company=None, ledger_code="1100"):
    iban_n = iban.replace(" ", "").upper()
    for a in banca_service.list_accounts(db):
        if (a.get("iban") or "").replace(" ", "").upper() == iban_n:
            updates = {}
            if company is not None and (a.get("company") or "") != company:
                updates["company"] = company
            if account_name and a.get("account_name") != account_name:
                updates["account_name"] = account_name
            if bank_name and a.get("bank_name") != bank_name:
                updates["bank_name"] = bank_name
            if notes and a.get("notes") != notes:
                updates["notes"] = notes
            if ledger_code and a.get("ledger_code") != ledger_code:
                updates["ledger_code"] = ledger_code
            if updates:
                acc = banca_service.update_account(db, a["id"], updates)
                print("updated", acc["id"], bank_name, list(updates.keys()))
                return acc
            print("already", a["id"], bank_name)
            return a
    acc = banca_service.create_account(
        db,
        {
            "bank_name": bank_name,
            "account_name": account_name,
            "iban": iban_n,
            "notes": notes,
            "company": company,
            "ledger_code": ledger_code,
        },
    )
    print("created", acc["id"], bank_name, acc["iban"])
    return acc


db = SessionLocal()
try:
    ensure(
        db,
        bank_name="BPPB - Banca Popolare di Puglia e Basilicata",
        account_name="CC1410004512",
        iban="IT55B0538516000CC1410004512",
        notes="Conto BPPB Mediazione (ABI 05385). Collegare via Enable Banking in produzione.",
    )
    ensure(
        db,
        bank_name="BPPB - Banca Popolare di Puglia e Basilicata",
        account_name="Via Lattea · CC410004514",
        iban="IT25D0538516000CC410004514",
        company="via_lattea",
        ledger_code="1100",
        notes="LA VIA LATTEA SOCIETA' AGRICOLA A R.L. · BPPB ABI 05385 CAB 16000 · CC410004514",
    )
    ensure(
        db,
        bank_name="UniCredit",
        account_name="Conto corrente Lecce Foscarini",
        iban="IT48Q0200816005000105294153",
        notes="UniCredit LECCE FOSCARINI · BIC UNCRITM1L32 · testabile in sandbox Enable Banking",
    )
    ensure(
        db,
        bank_name="Intesa Sanpaolo",
        account_name="RISACCA S.R.L. · Business Insieme",
        iban="IT88N0306979822100000008926",
        notes="RISACCA S.R.L. · Filiale Nardò · BIC BCITITMM · Conto Business Insieme · CC 66494/1000/00008926",
    )
    ensure(
        db,
        bank_name="BCC Terra d'Otranto",
        account_name="Via Lattea · BCC Terra d'Otranto",
        iban="IT06B0844516000000000972450",
        company="via_lattea",
        ledger_code="1100",
        notes=(
            "LA VIA LATTEA · BCC Terra d'Otranto S.C. · "
            "IBAN IT06B0844516000000000972450 · BIC ICRAITRRCD0 · "
            "ABI 08445 CAB 16000 CC 00000972450 · "
            "Sede Via C. Battisti 27, 73041 Carmiano (LE)"
        ),
    )
    print("accounts:")
    for a in banca_service.list_accounts(db):
        print("-", a["id"], a.get("company") or "-", a["bank_name"], a.get("iban"))
finally:
    db.close()
