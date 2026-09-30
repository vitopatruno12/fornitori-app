#!/usr/bin/env python3
"""Scarico AdE a periodi distinti per società (settembre 2026).

Uso sul PC ufficio (Fisconline / CNS), dalla cartella backend:

  python scripts/ade_sync_company_ranges.py

Oppure un solo profilo:

  python scripts/ade_sync_company_ranges.py --only via_lattea

Date (anno 2026):
  mediazione / via_abba     20→30 set  (Mediazione A)
  via_zanardelli            22→30 set  (Mediazione Z)
  via_lattea                25→30 set  (refuso «al 20» interpretato come 30)
  pg                        16→30 set  (Gazza Ladra)
  risacca                   19→30 set  (Bar Momento)

Se Mediazione A e Z condividono il profilo «mediazione», viene usato
il range più ampio 20→30 (copre entrambe; la sede XML classifica A/Z).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
ROOT = _HERE.parent if (_HERE.parent / "app").is_dir() else _HERE
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))

# (profile_id, date_from, date_to, label)
COMPANY_RANGES = [
  ("mediazione", "2026-09-20", "2026-09-30", "Mediazione A+Z (profilo unico)"),
  ("via_abba", "2026-09-20", "2026-09-30", "Mediazione A"),
  ("via_zanardelli", "2026-09-22", "2026-09-30", "Mediazione Z"),
  ("via_lattea", "2026-09-25", "2026-09-30", "Via Lattea"),
  ("pg", "2026-09-16", "2026-09-30", "PG · Gazza Ladra"),
  ("risacca", "2026-09-19", "2026-09-30", "Risacca · Bar Momento"),
]


def _load_dotenv() -> None:
  for p in (Path(__file__).with_name(".env"), ROOT / ".env"):
    if not p.is_file():
      continue
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
      s = line.strip()
      if not s or s.startswith("#") or "=" not in s:
        continue
      k, v = s.split("=", 1)
      k, v = k.strip(), v.strip().strip('"').strip("'")
      if k and k not in os.environ:
        os.environ[k] = v


def main() -> int:
  parser = argparse.ArgumentParser(description="Scarico AdE per società / periodo")
  parser.add_argument(
    "--only",
    action="append",
    default=[],
    help="Limita a uno o più profile_id (ripetibile)",
  )
  parser.add_argument(
    "--list",
    action="store_true",
    help="Mostra i range e esce",
  )
  args = parser.parse_args()
  _load_dotenv()

  only = {x.strip().lower() for x in (args.only or []) if x.strip()}
  jobs = [j for j in COMPANY_RANGES if not only or j[0].lower() in only]

  if args.list:
    for pid, dfrom, dto, label in jobs:
      print(f"  {pid:16} {dfrom} → {dto}  ({label})")
    return 0

  from app.integrations.ade.profiles import load_profiles
  from app.integrations.ade.sync import sync_all_profiles

  available = {pr.id.lower() for pr in load_profiles()}
  # Anche profili disabilitati se ADE_ONLY_PROFILE li seleziona
  from app.integrations.ade.profiles import load_profiles_raw

  available |= {str(x.get("id") or "").strip().lower() for x in load_profiles_raw() if x.get("id")}

  print("AdE sync a range per società")
  rc = 0
  ran = 0
  for pid, dfrom, dto, label in jobs:
    if pid.lower() not in available:
      print(f"  skip {pid}: profilo assente in profiles.json ({label})")
      continue
    print(f"\n=== {label} [{pid}] {dfrom} → {dto} ===", flush=True)
    os.environ["ADE_ONLY_PROFILE"] = pid
    os.environ["ADE_DATE_FROM"] = dfrom
    os.environ["ADE_DATE_TO"] = dto
    # Scarico completo: richieste + risposte
    os.environ.pop("ADE_RICHIESTE_ONLY", None)
    os.environ.pop("ADE_RISPOSTE_ONLY", None)
    try:
      results, pushes = sync_all_profiles()
    except Exception as exc:  # noqa: BLE001
      print(f"  ERR {pid}: {exc}", file=sys.stderr)
      rc = 1
      continue
    ran += 1
    for r in results:
      print(f"  {r.message}")
    ok_n = sum(1 for p in pushes if p.get("ok"))
    err_n = sum(1 for p in pushes if not p.get("ok") and not p.get("skipped"))
    print(f"  push ok={ok_n} err={err_n}")
    if err_n:
      rc = 1

  if ran == 0:
    print("Nessun profilo eseguito. Controlla ADE_PROFILES_PATH / profiles.json.", file=sys.stderr)
    return 2
  return rc


if __name__ == "__main__":
  raise SystemExit(main())
