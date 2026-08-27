#!/usr/bin/env python3
"""Agent sync Agenzia delle Entrate (Fatture e Corrispettivi) → ATLAS /sdi/receive.

Esempio (Task Scheduler sul PC agenzia con chiavetta CNS):
  python ade_sync_agent.py

Prerequisiti:
  pip install -r requirements-ade-agent.txt
  playwright install chrome

Variabili (backend/.env o .env accanto allo script):
  ADE_PROFILES_PATH=C:/AtlasSync/ade/profiles.json
  ADE_HEADLESS=0
  ADE_USE_SYSTEM_CHROME=1
  ADE_CNS_PIN_WAIT_SEC=180
  ADE_LOOKBACK_DAYS=60
  ADE_XML_DROP_DIR=C:/AtlasSync/ade   # fallback / export manuale
  ATLAS_API_BASE=https://www.atlass.it/api
  SDI_RECEIVE_TOKEN=...

Profilo JSON (sede Atlas): via_abba | via_lattea | risacca | via_zanardelli
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if (_HERE / "app").is_dir():
  ROOT = _HERE
elif (_HERE.parent / "app").is_dir():
  ROOT = _HERE.parent
else:
  ROOT = _HERE.parent
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))


def _load_dotenv() -> None:
  candidates = [
    Path(__file__).with_name(".env"),
    ROOT / ".env",
  ]
  for p in candidates:
    p = p.resolve()
    if not p.is_file():
      continue
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
      s = line.strip()
      if not s or s.startswith("#") or "=" not in s:
        continue
      k, v = s.split("=", 1)
      k = k.strip()
      v = v.strip().strip('"').strip("'")
      if k and k not in os.environ:
        os.environ[k] = v


def main() -> int:
  _load_dotenv()

  api = (os.getenv("ATLAS_API_BASE") or "https://www.atlass.it/api").rstrip("/")
  token = (os.getenv("SDI_RECEIVE_TOKEN") or "").strip()
  if not token:
    print(
      "AVVISO: SDI_RECEIVE_TOKEN vuoto — push solo se Atlas accetta receive senza token",
      file=sys.stderr,
    )

  from app.integrations.ade.profiles import load_profiles
  from app.integrations.ade.sync import sync_all_profiles

  profiles = load_profiles()
  print(f"AdE sync -> {api}/sdi/receive | profili abilitati={len(profiles)}")
  for pr in profiles:
    print(f"  - {pr.id} sede={pr.sede} auth={pr.auth_mode} drop={pr.drop_dir or '-'}")

  results, pushes = sync_all_profiles()
  for r in results:
    print(r.message)
    if r.screenshots:
      print(f"  screenshot: {len(r.screenshots)} (ultimi in {r.screenshots[-1] if r.screenshots else ''})")

  for p in pushes:
    name = p.get("filename")
    sede = p.get("sede")
    if p.get("skipped"):
      print(f"  skip [{sede}] {name} ({p.get('reason')})")
      continue
    if p.get("ok"):
      res = p.get("result") or {}
      dup = " duplicate" if res.get("duplicate") else ""
      print(f"  OK{dup} [{sede}] {name} id={res.get('id')} source={p.get('source')}")
    else:
      print(f"  ERR [{sede}] {name} status={p.get('status')} {p.get('result')}", file=sys.stderr)

  if not profiles:
    return 2
  if any(not r.login_ok for r in results) and not any(r.downloaded for r in results):
    return 3
  if not any(r.downloaded for r in results) and not any(p.get("ok") for p in pushes):
    return 4
  if any(not p.get("ok") and not p.get("skipped") for p in pushes):
    return 1
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
