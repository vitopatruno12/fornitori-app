#!/usr/bin/env python3
"""AdE per società: prima RICHIESTE massiva, poi SCARICO risposte.

Flusso obbligatorio AdE:
  1) Genera richiesta (periodo per società)
  2) Attesa (AdE prepara lo ZIP)
  3) Scarico risposte / ZIP → Atlas

Uso sul PC ufficio (Fisconline / CNS), dalla cartella backend:

  python scripts/ade_sync_company_ranges.py
  python scripts/ade_sync_company_ranges.py --only risacca
  python scripts/ade_sync_company_ranges.py --phase request
  python scripts/ade_sync_company_ranges.py --phase download --wait-min 0

Date (anno 2026):
  mediazione / via_abba     20→30 set  (Mediazione A)
  via_zanardelli            22→30 set  (Mediazione Z)
  via_lattea                25→30 set
  pg                        16→30 set  (Gazza Ladra)
  risacca                   19→30 set  (Bar Momento)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import List, Tuple

_HERE = Path(__file__).resolve().parent
ROOT = _HERE.parent if (_HERE.parent / "app").is_dir() else _HERE
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))

# (profile_id, date_from, date_to, label)
COMPANY_RANGES: List[Tuple[str, str, str, str]] = [
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


def _available_profile_ids() -> set[str]:
  from app.integrations.ade.profiles import load_profiles, load_profiles_raw

  ids = {pr.id.lower() for pr in load_profiles()}
  ids |= {str(x.get("id") or "").strip().lower() for x in load_profiles_raw() if x.get("id")}
  return ids


def _run_jobs(
  jobs: List[Tuple[str, str, str, str]],
  *,
  available: set[str],
  phase: str,
) -> int:
  """phase: request | download"""
  from app.integrations.ade.sync import sync_all_profiles

  if phase == "request":
    os.environ["ADE_RICHIESTE_ONLY"] = "1"
    os.environ.pop("ADE_RISPOSTE_ONLY", None)
    title = "RICHIESTE"
  else:
    os.environ["ADE_RISPOSTE_ONLY"] = "1"
    os.environ.pop("ADE_RICHIESTE_ONLY", None)
    title = "SCARICO"

  print(f"\n########## FASE {title} ##########", flush=True)
  rc = 0
  ran = 0
  for pid, dfrom, dto, label in jobs:
    if pid.lower() not in available:
      print(f"  skip {pid}: profilo assente ({label})")
      continue
    print(f"\n=== {title} · {label} [{pid}] {dfrom} → {dto} ===", flush=True)
    os.environ["ADE_ONLY_PROFILE"] = pid
    os.environ["ADE_DATE_FROM"] = dfrom
    os.environ["ADE_DATE_TO"] = dto
    try:
      results, pushes = sync_all_profiles()
    except Exception as exc:  # noqa: BLE001
      print(f"  ERR {pid}: {exc}", file=sys.stderr)
      rc = 1
      continue
    ran += 1
    for r in results:
      print(f"  {r.message}")
    if phase == "download":
      ok_n = sum(1 for p in pushes if p.get("ok"))
      err_n = sum(1 for p in pushes if not p.get("ok") and not p.get("skipped"))
      print(f"  push ok={ok_n} err={err_n}")
      if err_n:
        rc = 1
    else:
      # In richiesta non ci sono ZIP da pushare
      if any(not getattr(r, "login_ok", True) for r in results):
        rc = 1
  if ran == 0:
    print(f"Nessun profilo in fase {title}.", file=sys.stderr)
    return 2
  return rc


def main() -> int:
  parser = argparse.ArgumentParser(
    description="AdE: richieste per società, poi scarico risposte",
  )
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
  parser.add_argument(
    "--phase",
    choices=("both", "request", "download"),
    default="both",
    help="both=richieste poi scarico (default); request; download",
  )
  parser.add_argument(
    "--wait-min",
    type=int,
    default=15,
    help="Minuti di attesa tra richieste e scarico (default 15). Usa 0 per saltare.",
  )
  args = parser.parse_args()
  _load_dotenv()

  only = {x.strip().lower() for x in (args.only or []) if x.strip()}
  jobs = [j for j in COMPANY_RANGES if not only or j[0].lower() in only]

  if args.list:
    for pid, dfrom, dto, label in jobs:
      print(f"  {pid:16} {dfrom} → {dto}  ({label})")
    return 0

  available = _available_profile_ids()
  print("AdE: richiesta → (attesa) → scarico, per società")
  rc = 0

  if args.phase in ("both", "request"):
    r = _run_jobs(jobs, available=available, phase="request")
    if r == 2 and args.phase == "request":
      return 2
    if r == 1:
      rc = 1

  if args.phase == "both":
    wait_min = max(0, int(args.wait_min or 0))
    if wait_min > 0:
      print(
        f"\nAttesa {wait_min} min: AdE prepara le risposte massiva… "
        f"(poi parte lo scarico)",
        flush=True,
      )
      time.sleep(wait_min * 60)
    else:
      print("\nNessuna attesa (--wait-min 0): scarico subito.", flush=True)

  if args.phase in ("both", "download"):
    r = _run_jobs(jobs, available=available, phase="download")
    if r == 2 and args.phase == "download":
      return 2
    if r != 0:
      rc = r

  return rc


if __name__ == "__main__":
  raise SystemExit(main())
