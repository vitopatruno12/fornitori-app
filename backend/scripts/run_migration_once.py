"""Esegue migrations/20260206_extend_suppliers_invoices.sql sul DB in DATABASE_URL."""
from pathlib import Path
import os
import re

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
sql_path = ROOT / "migrations" / "20260206_extend_suppliers_invoices.sql"


def main() -> None:
    url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/fornitori_db")
    engine = create_engine(url)
    raw = sql_path.read_text(encoding="utf-8")
    # Rimuovi commenti a riga singola per non rompere gli statement
    lines = []
    for line in raw.splitlines():
        if line.strip().startswith("--"):
            continue
        lines.append(line)
    body = "\n".join(lines)
    parts = [p.strip() for p in re.split(r";\s*", body) if p.strip()]
    with engine.begin() as conn:
        for stmt in parts:
            conn.execute(text(stmt + ";"))
    print("Migration OK:", sql_path.name)


if __name__ == "__main__":
    main()
