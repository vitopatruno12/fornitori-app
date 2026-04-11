"""Applica migrations/20260409_supplier_orders_status_summary.sql."""
from pathlib import Path
import os
import re

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
ROOT = Path(__file__).resolve().parent.parent
sql_path = ROOT / "migrations" / "20260409_supplier_orders_status_summary.sql"


def main() -> None:
    url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/fornitori_db")
    engine = create_engine(url)
    raw = sql_path.read_text(encoding="utf-8")
    parts = [p.strip() for p in re.split(r";\s*", raw) if p.strip()]
    with engine.begin() as conn:
        for stmt in parts:
            conn.execute(text(stmt + ";"))
    print("OK:", sql_path.name)


if __name__ == "__main__":
    main()
