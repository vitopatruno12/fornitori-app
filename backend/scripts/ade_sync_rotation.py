#!/usr/bin/env python3
"""Rotazione scarichi AdE (date recenti).

Regola operativa:
  - Ogni 3 giorni alle 14:00 -> Mediazione A+Z e Via Lattea
  - Ogni 4 giorni alle 14:00 -> Risacca e PG
  - Se i due giorni coincidono, partono tutte e quattro
  - Scarico il mattino dopo alle 05:00 (non dopo 15 minuti):
    l'Agenzia delle Entrate puo' impiegare molte ore a preparare i file.

Uso (PC ufficio):

  python scripts/ade_sync_rotation.py --phase request
  python scripts/ade_sync_rotation.py --phase download --date 2026-10-03
  python scripts/ade_sync_rotation.py --dry-run

Periodo: ultimi ADE_ROTATION_LOOKBACK_DAYS (default 10) fino al giorno del piano.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

_HERE = Path(__file__).resolve().parent
ROOT = _HERE.parent if (_HERE.parent / "app").is_dir() else _HERE
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))

# Ogni 3 giorni: Mediazione A+Z (un accesso AdE) e Via Lattea.
# Ogni 4 giorni: Risacca e PG.
GROUP_EVERY_3: List[Tuple[str, str]] = [
  ("mediazione", "Mediazione A+Z"),
  ("via_lattea", "Via Lattea"),
]
GROUP_EVERY_4: List[Tuple[str, str]] = [
  ("risacca", "Risacca · Bar Momento"),
  ("pg", "PG · Gazza Ladra"),
]

# Priorita' se un giorno ha troppi profili
PRIORITY = ["mediazione", "via_lattea", "risacca", "pg"]
MAX_PER_DAY = 4
EPOCH = date(2026, 10, 1)  # inizio modalita' "date recenti"


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


def _state_path() -> Path:
  raw = (os.getenv("ADE_ROTATION_STATE_PATH") or "").strip()
  if raw:
    return Path(raw)
  return ROOT / "uploads" / "ade" / "rotation_state.json"


def _lookback_days() -> int:
  try:
    return max(3, min(60, int(os.getenv("ADE_ROTATION_LOOKBACK_DAYS") or "10")))
  except ValueError:
    return 10


# Ultime fatture già in Atlas al 4 ott 2026. Vale solo per la richiesta del 5 ott
# e lo scarico del 6 ott: poi torna il lookback normale.
# PG: emesse fino al 10 set, ricevute fino al 15 set → si parte dal 10 set.
# Risacca: ricevute fino al 18 set.
_CATCHUP_UNTIL = date(2026, 10, 6)
_LAST_INVOICE_ON = {
  "pg": date(2026, 9, 10),
  "risacca": date(2026, 9, 18),
}


def _profile_date_from(pid: str, day: date) -> date:
  """Inizio periodo: lookback, avvicinato all'ultima fattura già scaricata."""
  lookback_from = day - timedelta(days=_lookback_days())
  if day > _CATCHUP_UNTIL:
    return lookback_from
  anchor = _LAST_INVOICE_ON.get((pid or "").strip().lower())
  if anchor is None or anchor > day:
    return lookback_from
  if anchor >= lookback_from:
    return anchor
  if (lookback_from - anchor).days <= 10:
    return anchor
  return lookback_from


def _parse_day(raw: Optional[str]) -> date:
  if not raw:
    return date.today()
  return date.fromisoformat(raw.strip()[:10])


def plan_for_day(day: date) -> dict:
  """Calcola quali profili girano oggi."""
  idx = (day - EPOCH).days
  g3 = idx >= 0 and (idx % 3 == 0)
  g4 = idx >= 0 and (idx % 4 == 0)
  selected: List[Tuple[str, str]] = []
  reasons: List[str] = []
  if g3:
    selected.extend(GROUP_EVERY_3)
    reasons.append("gruppo-3 (ogni 3 giorni)")
  if g4:
    selected.extend(GROUP_EVERY_4)
    reasons.append("gruppo-4 (ogni 4 giorni)")

  # Dedup preservando ordine
  seen = set()
  unique: List[Tuple[str, str]] = []
  for pid, label in selected:
    key = pid.lower()
    if key in seen:
      continue
    seen.add(key)
    unique.append((pid, label))

  # Cap a MAX_PER_DAY con priorita'
  if len(unique) > MAX_PER_DAY:
    rank = {p: i for i, p in enumerate(PRIORITY)}
    unique.sort(key=lambda item: rank.get(item[0].lower(), 99))
    unique = unique[:MAX_PER_DAY]
    reasons.append(f"taglio a max {MAX_PER_DAY}/giorno")

  d_to = day.isoformat()
  profiles = [
    {
      "id": p,
      "label": lab,
      "date_from": _profile_date_from(p, day).isoformat(),
    }
    for p, lab in unique
  ]
  d_from = min((item["date_from"] for item in profiles), default=d_to)
  return {
    "day": day.isoformat(),
    "day_index": idx,
    "run_group3": g3,
    "run_group2": g4,
    "reasons": reasons,
    "profiles": profiles,
    "date_from": d_from,
    "date_to": d_to,
    "skip": len(unique) == 0,
  }


def _available_ids() -> set[str]:
  from app.integrations.ade.profiles import load_profiles, load_profiles_raw

  ids = {pr.id.lower() for pr in load_profiles()}
  ids |= {str(x.get("id") or "").strip().lower() for x in load_profiles_raw() if x.get("id")}
  return ids


def _profile_timeout_sec() -> int:
  try:
    return max(180, min(2400, int(os.getenv("ADE_PROFILE_TIMEOUT_SEC") or "900")))
  except ValueError:
    return 900


def _kill_process_tree(pid: int) -> None:
  if pid <= 0:
    return
  if os.name == "nt":
    subprocess.run(
      ["taskkill", "/PID", str(pid), "/T", "/F"],
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
    )
    return
  try:
    os.kill(pid, 15)
  except OSError:
    pass


def _run_phase(
  profiles: Sequence[Tuple[str, str]],
  *,
  d_from: str,
  d_to: str,
  phase: str,
  available: set[str],
) -> int:
  """Ogni società gira in un processo proprio: se Chrome si blocca, viene chiuso."""
  if os.environ.get("ADE_INLINE") == "1":
    return _run_phase_inline(
      profiles, d_from=d_from, d_to=d_to, phase=phase, available=available
    )
  title = "RICHIESTE" if phase == "request" else "SCARICO"
  print(f"\n########## FASE {title} ##########", flush=True)
  timeout = _profile_timeout_sec()
  script = str(Path(__file__).resolve())
  rc = 0
  ran = 0
  for pid, label in profiles:
    if pid.lower() not in available:
      print(f"  skip {pid}: profilo assente ({label})", flush=True)
      continue
    start = _profile_date_from(pid, _parse_day(d_to)).isoformat()
    print(
      f"\n=== {title} · {label} [{pid}] {start} -> {d_to} (max {timeout}s) ===",
      flush=True,
    )
    env = os.environ.copy()
    env["ADE_INLINE"] = "1"
    env["ADE_ONLY_PROFILE"] = pid
    proc = subprocess.Popen(
      [sys.executable, "-u", script, "--phase", phase, "--force", pid, "--date", d_to],
      cwd=str(ROOT),
      env=env,
    )
    try:
      code = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
      _kill_process_tree(proc.pid)
      print(
        f"  ERR {pid}: superati {timeout}s, browser chiuso per non restare bloccato",
        flush=True,
      )
      rc = 1
      continue
    ran += 1
    if code not in (0, None):
      print(f"  ERR {pid}: uscita {code}", flush=True)
      rc = 1
  if ran == 0 and rc == 0:
    return 2
  return rc


def _run_phase_inline(
  profiles: Sequence[Tuple[str, str]],
  *,
  d_from: str,
  d_to: str,
  phase: str,
  available: set[str],
) -> int:
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
  for pid, label in profiles:
    if pid.lower() not in available:
      print(f"  skip {pid}: profilo assente ({label})")
      continue
    print(f"\n=== {title} · {label} [{pid}] {d_from} -> {d_to} ===", flush=True)
    os.environ["ADE_ONLY_PROFILE"] = pid
    os.environ["ADE_DATE_FROM"] = d_from
    os.environ["ADE_DATE_TO"] = d_to
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
    elif any(not getattr(r, "login_ok", True) for r in results):
      rc = 1
  if ran == 0:
    return 2
  return rc


def _save_state(plan: dict, rc: int) -> None:
  path = _state_path()
  path.parent.mkdir(parents=True, exist_ok=True)
  payload = {
    "updated_at": datetime.now().isoformat(timespec="seconds"),
    "last_rc": rc,
    "plan": plan,
  }
  path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def main() -> int:
  parser = argparse.ArgumentParser(description="Rotazione AdE: ogni 3 giorni Mediazione e Via Lattea, ogni 4 Risacca e PG")
  parser.add_argument("--date", help="Giorno di piano YYYY-MM-DD (default oggi)")
  parser.add_argument("--dry-run", action="store_true", help="Mostra piano senza eseguire")
  parser.add_argument(
    "--force",
    default="",
    help="Forza elenco profili (csv), ignora calendario",
  )
  parser.add_argument(
    "--wait-min",
    type=int,
    default=15,
    help="Minuti tra richieste e scarico (default 15)",
  )
  parser.add_argument(
    "--phase",
    choices=("both", "request", "download"),
    default="both",
  )
  args = parser.parse_args()
  _load_dotenv()

  day = _parse_day(args.date)
  plan = plan_for_day(day)

  if args.force.strip():
    labels = {p: lab for p, lab in GROUP_EVERY_3 + GROUP_EVERY_4}
    forced = []
    for raw in args.force.split(","):
      pid = raw.strip().lower()
      if not pid:
        continue
      forced.append((pid, labels.get(pid, pid)))
    # dedup + cap
    seen = set()
    uniq = []
    for pid, lab in forced:
      if pid in seen:
        continue
      seen.add(pid)
      uniq.append((pid, lab))
    uniq = uniq[:MAX_PER_DAY]
    froms = [_profile_date_from(pid, day) for pid, _lab in uniq]
    plan = {
      "day": day.isoformat(),
      "day_index": (day - EPOCH).days,
      "run_group3": False,
      "run_group2": False,
      "reasons": ["--force"],
      "profiles": [
        {"id": p, "label": lab, "date_from": _profile_date_from(p, day).isoformat()}
        for p, lab in uniq
      ],
      "date_from": (min(froms) if froms else day).isoformat(),
      "date_to": day.isoformat(),
      "skip": len(uniq) == 0,
    }

  print(
    f"Piano AdE {plan['day']} (idx={plan['day_index']}) "
    f"period={plan['date_from']}->{plan['date_to']}",
    flush=True,
  )
  print(f"  motivi: {', '.join(plan['reasons']) or 'nessuno (giorno di riposo)'}", flush=True)
  if plan["skip"]:
    print("  nessuna societa' oggi (rispetta cadenza 3/4 giorni).", flush=True)
    _save_state(plan, 0)
    return 0
  for item in plan["profiles"]:
    span = item.get("date_from") or plan["date_from"]
    print(f"  - {item['id']:12} {item['label']}  {span} -> {plan['date_to']}", flush=True)

  if args.dry_run:
    return 0

  available = _available_ids()
  jobs = [(x["id"], x["label"]) for x in plan["profiles"]]
  rc = 0

  if args.phase in ("both", "request"):
    r = _run_phase(
      jobs,
      d_from=plan["date_from"],
      d_to=plan["date_to"],
      phase="request",
      available=available,
    )
    if r == 1:
      rc = 1
    if r == 2:
      _save_state(plan, 2)
      return 2

  if args.phase == "both":
    wait_min = max(0, int(args.wait_min or 0))
    if wait_min > 0:
      print(f"\nAttesa {wait_min} min prima dello scarico…", flush=True)
      time.sleep(wait_min * 60)

  if args.phase in ("both", "download"):
    r = _run_phase(
      jobs,
      d_from=plan["date_from"],
      d_to=plan["date_to"],
      phase="download",
      available=available,
    )
    if r != 0:
      rc = r

  _save_state(plan, rc)
  return rc


if __name__ == "__main__":
  raise SystemExit(main())
