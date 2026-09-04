"""One-shot: migrate EB columns + seed BPPB/UniCredit accounts."""
from sqlalchemy import text

from app.database import SessionLocal, engine
from app.services import banca_service

SQL = [
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS eb_session_id VARCHAR(64)",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS eb_account_uid VARCHAR(64)",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS eb_aspsp_name VARCHAR(120)",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS eb_aspsp_country VARCHAR(2)",
]

with engine.begin() as conn:
    for sql in SQL:
        conn.execute(text(sql))
        print("ok", sql.split()[-1])


def ensure(db, *, bank_name, account_name, iban, notes):
    iban_n = iban.replace(" ", "").upper()
    for a in banca_service.list_accounts(db):
        if (a.get("iban") or "").replace(" ", "").upper() == iban_n:
            print("already", a["id"], bank_name)
            return a
    acc = banca_service.create_account(
        db,
        {
            "bank_name": bank_name,
            "account_name": account_name,
            "iban": iban_n,
            "notes": notes,
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
        notes="Conto BPPB (ABI 05385). Collegare via Enable Banking in produzione.",
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
        account_name="Conto corrente Carmiano",
        iban="IT06B0844516000000000972450",
        notes="BCC Terra d'Otranto · Via C. Battisti 27 Carmiano · BIC ICRAITRRCD0 · ABI 08445",
    )
    print("accounts:")
    for a in banca_service.list_accounts(db):
        print("-", a["id"], a["bank_name"], a.get("iban"))
finally:
    db.close()
