#!/usr/bin/env python3
"""Imposta il codice personale La Via Lattea a 050408 (sostituisce 910689 se presente)."""
from __future__ import annotations

from app.constants.staff_locale_access_defaults import DEFAULT_STAFF_LOCALE_ACCESS_CODES
from app.constants.prima_nota_staff_locale import _locale_name_key
from app.database import SessionLocal
from app.models.staff_locale_pack import StaffLocalePack

NEW_CODE = "050408"
OLD_CODE = "910689"
CANONICAL_NAME = "La Via Lattea"


def is_lattea_locale(name: str) -> bool:
    key = _locale_name_key(name)
    return "lattea" in key or "mucchevolanti" in key


def main() -> None:
    db = SessionLocal()
    try:
        rows = db.query(StaffLocalePack).all()
        updated = 0
        target = None
        for row in rows:
            if is_lattea_locale(row.locale_name) or row.access_code == OLD_CODE:
                print(f"Aggiorno {row.locale_name!r}: {row.access_code!r} -> {NEW_CODE!r}")
                row.access_code = NEW_CODE
                if is_lattea_locale(row.locale_name):
                    target = row
                updated += 1
        if not target:
            row = StaffLocalePack(
                locale_name=CANONICAL_NAME,
                members_json="[]",
                sections_json="[]",
                access_code=NEW_CODE,
            )
            db.add(row)
            print(f"Creato locale {CANONICAL_NAME!r} con codice {NEW_CODE!r}")
            updated += 1
        if updated:
            db.commit()
            print("Operazione completata.")
        else:
            print("Nessuna modifica necessaria.")
        print("Codici predefiniti:", DEFAULT_STAFF_LOCALE_ACCESS_CODES)
    finally:
        db.close()


if __name__ == "__main__":
    main()
