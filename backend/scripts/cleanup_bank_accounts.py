"""Pulisce conti banca duplicati / non utili (BPPB Via Lattea).

Uso sul server (API dir):
  cd /opt/fornitori-app
  ./backend/.venv/bin/python -m backend.scripts.cleanup_bank_accounts --dry-run
  ./backend/.venv/bin/python -m backend.scripts.cleanup_bank_accounts --apply

Oppure:
  cd /opt/fornitori-app/backend && ../.venv/bin/python scripts/cleanup_bank_accounts.py --apply
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))
BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
  sys.path.insert(0, str(BACKEND))

from app.database import SessionLocal  # noqa: E402
from app.services import banca_service  # noqa: E402

KEEP_BPPB_VIA_LATTEA_IBAN = "IT25D0538516000CC1410004514"
OLD_BPPB_VIA_LATTEA_IBANS = {
  "IT25D0538516000CC410004514",
}


def _iban(a: dict) -> str:
  return (a.get("iban") or "").replace(" ", "").upper()


def _is_bppb(a: dict) -> bool:
  bank = f"{a.get('bank_name') or ''} {a.get('account_name') or ''}".lower()
  iban = _iban(a)
  return (
    "bppb" in bank
    or "puglia" in bank
    or "basilicata" in bank
    or iban.startswith("IT") and "05385" in iban
  )


def _is_via_lattea(a: dict) -> bool:
  company = (a.get("company") or "").strip().lower()
  name = f"{a.get('account_name') or ''} {a.get('notes') or ''}".lower()
  return company == "via_lattea" or "via lattea" in name or "lattea" in name


def _score_keep(a: dict) -> tuple:
  """Più alto = da tenere."""
  iban = _iban(a)
  connected = 1 if a.get("enable_banking_connected") else 0
  exact = 1 if iban == KEEP_BPPB_VIA_LATTEA_IBAN else 0
  not_old = 0 if iban in OLD_BPPB_VIA_LATTEA_IBANS else 1
  has_iban = 1 if iban else 0
  return (connected, exact, not_old, has_iban, int(a.get("id") or 0))


def main() -> int:
  parser = argparse.ArgumentParser(description="Cleanup conti banca duplicati BPPB Via Lattea")
  parser.add_argument("--dry-run", action="store_true", help="Solo elenco (default)")
  parser.add_argument("--apply", action="store_true", help="Elimina davvero i conti selezionati")
  args = parser.parse_args()
  apply = bool(args.apply)
  dry = not apply

  db = SessionLocal()
  try:
    items = banca_service.list_accounts(db)
    print("Conti attivi:")
    for a in items:
      print(
        f"  id={a['id']:>4}  company={a.get('company') or '-':<12}  "
        f"eb={'yes' if a.get('enable_banking_connected') else 'no':<3}  "
        f"iban={_iban(a) or '-':<28}  {a.get('bank_name')} · {a.get('account_name')}"
      )

    bppb_vl = [a for a in items if _is_bppb(a) and _is_via_lattea(a)]
    to_delete = []
    if len(bppb_vl) > 1:
      keep = max(bppb_vl, key=_score_keep)
      to_delete = [a for a in bppb_vl if a["id"] != keep["id"]]
      print("\nBPPB Via Lattea: tengo")
      print(
        f"  id={keep['id']} iban={_iban(keep)} eb={keep.get('enable_banking_connected')} "
        f"{keep.get('bank_name')} · {keep.get('account_name')}"
      )
    elif len(bppb_vl) == 1:
      only = bppb_vl[0]
      # Se è solo il vecchio IBAN non collegato, segnala ma non elimina l'unico
      print("\nUn solo BPPB Via Lattea — nessuna eliminazione automatica.")
      print(f"  id={only['id']} iban={_iban(only)}")
    else:
      print("\nNessun BPPB Via Lattea trovato.")

    # Vecchi IBAN BPPB Via Lattea anche se company mancante
    for a in items:
      if _iban(a) in OLD_BPPB_VIA_LATTEA_IBANS and a not in to_delete:
        # Non cancellare se è l'unico collegato
        if a.get("enable_banking_connected") and not any(
          x.get("enable_banking_connected") for x in bppb_vl if x["id"] != a["id"]
        ):
          continue
        if a["id"] not in {x["id"] for x in to_delete}:
          to_delete.append(a)

    # Dedup by id
    seen = set()
    uniq = []
    for a in to_delete:
      if a["id"] in seen:
        continue
      seen.add(a["id"])
      uniq.append(a)
    to_delete = uniq

    if not to_delete:
      print("\nNiente da eliminare.")
      return 0

    print("\nDa eliminare:")
    for a in to_delete:
      print(
        f"  id={a['id']} iban={_iban(a)} eb={a.get('enable_banking_connected')} "
        f"{a.get('bank_name')} · {a.get('account_name')}"
      )

    if dry:
      print("\nDRY-RUN: nessuna eliminazione. Rilancia con --apply per confermare.")
      return 0

    for a in to_delete:
      banca_service.delete_account(db, int(a["id"]))
      print(f"eliminato id={a['id']}")
    print("\nFatto.")
    return 0
  finally:
    db.close()


if __name__ == "__main__":
  raise SystemExit(main())
