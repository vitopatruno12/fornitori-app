"""Aggiunge la colonna product_description alla tabella deliveries."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from app.database import engine


def run():
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE deliveries ADD COLUMN product_description VARCHAR(255)"))
            conn.commit()
            print("Colonna product_description aggiunta.")
        except Exception as e:
            err = str(e).lower()
            if "already exists" in err or "duplicate" in err or "esiste già" in err:
                print("Colonna product_description già presente.")
            else:
                print(f"Errore: {e}")
    print("Migrazione completata.")


if __name__ == "__main__":
    run()
