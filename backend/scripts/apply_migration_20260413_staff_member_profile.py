"""Applica migrations/20260413_staff_member_profile.sql."""
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_ROOT / ".env", override=True)


def main():
    url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/fornitori_db")
    engine = create_engine(url)
    sql_path = Path(__file__).resolve().parent.parent / "migrations" / "20260413_staff_member_profile.sql"
    sql = sql_path.read_text(encoding="utf-8")
    with engine.connect() as conn:
        conn.execute(text(sql))
        conn.commit()
    print("OK:", sql_path.name)


if __name__ == "__main__":
    main()
