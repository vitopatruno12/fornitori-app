"""Applica migrazioni SQL idempotenti usando DATABASE_URL dell'app.

Utile in locale (Windows) dove gli script bash deploy/*.sh non girano.
Non può cambiare OWNER delle tabelle create da postgres: sul server usa
deploy/ensure-warehouse-payments-tables.sh come utente postgres.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402

SAFE_MIGRATIONS = [
    "20260616_staff_locale_access_code.sql",
    "20260617_prima_nota_locale_access_code.sql",
    "20260710_warehouse_movements.sql",
    "20260710_supplier_payments_workbook.sql",
    "20260710_supplier_order_items_volume_liters.sql",
    "20260712_supplier_multi_contacts.sql",
    "20260723_staff_member_section.sql",
    "20260723_bank_module.sql",
    "20260729_staff_stipendi_months.sql",
    "20260902_staff_stipendi_locale.sql",
    "20260812_carriers.sql",
    "20260812_electronic_invoices.sql",
    "20260812_sdi_electronic_invoice_link.sql",
    "20260816_pos_receipts.sql",
    "20260828_pos_receipts_payment_split.sql",
]


def _split_sql(sql: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        buf.append(line)
        if stripped.endswith(";"):
            stmt = "\n".join(buf).strip()
            if stmt:
                parts.append(stmt)
            buf = []
    tail = "\n".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def main() -> int:
    mig_dir = ROOT / "migrations"
    ok = 0
    fail = 0
    for name in SAFE_MIGRATIONS:
        path = mig_dir / name
        if not path.is_file():
            print(f"SKIP missing {name}")
            continue
        print(f"APPLY {name}")
        sql = path.read_text(encoding="utf-8")
        for stmt in _split_sql(sql):
            try:
                with engine.begin() as conn:
                    conn.execute(text(stmt))
            except Exception as e:
                msg = str(e).split("\n")[0]
                # Index ownership / already exists noise
                if "InsufficientPrivilege" in type(e).__name__ or "bisogna essere proprietari" in msg:
                    print(f"  WARN privilege: {msg}")
                    continue
                print(f"  FAIL: {msg}")
                fail += 1
                break
        else:
            ok += 1
            print("  OK")
    print(f"Done: {ok} migrations ok, {fail} with errors")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
