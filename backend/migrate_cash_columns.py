"""Script per aggiungere le colonne conto e riferimento_documento alla tabella cash_entries.
Eseguire solo se la tabella esiste già senza queste colonne:
  python migrate_cash_columns.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from app.database import engine

def run():
    with engine.connect() as conn:
        for col in ["conto", "riferimento_documento"]:
            try:
                conn.execute(text(f"ALTER TABLE cash_entries ADD COLUMN {col} VARCHAR(100)"))
                conn.commit()
                print(f"Colonna {col} aggiunta.")
            except Exception as e:
                err = str(e).lower()
                if "already exists" in err or "duplicate" in err or "esiste già" in err:
                    print(f"Colonna {col} già presente.")
                else:
                    print(f"Errore per {col}: {e}")
    print("Migrazione completata.")

if __name__ == "__main__":
    run()
