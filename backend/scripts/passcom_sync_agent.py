#!/usr/bin/env python3
"""Agent sync Passcom Live (Playwright) → ATLAS /sdi/receive.

Esempio (Task Scheduler ogni ora):
  python passcom_sync_agent.py

Prerequisiti:
  pip install -r requirements-passcom-agent.txt
  playwright install chromium

Variabili (o file .env accanto allo script / in backend/.env):
  PASSCOM_DOMAIN=elaborosoccoop
  PASSCOM_USERNAME=LAMEDIAZIONE
  PASSCOM_PASSWORD=...
  PASSCOM_BASE_URL=https://webdesk.passgo.cloud/webdesk/wd
  PASSCOM_LOOKBACK_DAYS=30
  PASSCOM_HEADLESS=1
  PASSCOM_DEBUG_DIR=   # default: backend/uploads/passcom_debug
  PASSCOM_XML_DROP_DIR=  # opzionale: cartella con XML già esportati
  ATLAS_API_BASE=https://www.atlass.it/api
  SDI_RECEIVE_TOKEN=...  # stesso token sul server Atlas
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
    ROOT / "app" / ".." / ".env",
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

  domain = (os.getenv("PASSCOM_DOMAIN") or "").strip()
  user = (os.getenv("PASSCOM_USERNAME") or "").strip()
  password = (os.getenv("PASSCOM_PASSWORD") or "").strip()
  if not domain or not user or not password:
    print(
      "ERRORE: imposta PASSCOM_DOMAIN, PASSCOM_USERNAME, PASSCOM_PASSWORD",
      file=sys.stderr,
    )
    return 2

  api = (os.getenv("ATLAS_API_BASE") or "https://www.atlass.it/api").rstrip("/")
  token = (os.getenv("SDI_RECEIVE_TOKEN") or "").strip()
  if not token:
    print(
      "AVVISO: SDI_RECEIVE_TOKEN vuoto — push solo se Atlas accetta receive senza token",
      file=sys.stderr,
    )

  from app.integrations.passcom.playwright_client import sync_once

  print(f"Passcom sync -> {api}/sdi/receive (domain={domain} user={user})")
  result, pushes = sync_once()
  print(result.message)
  for p in pushes:
    name = p.get("filename")
    if p.get("skipped"):
      print(f"  skip {name} ({p.get('reason')})")
      continue
    if p.get("ok"):
      res = p.get("result") or {}
      dup = " duplicate" if res.get("duplicate") else ""
      print(f"  OK{dup} {name} id={res.get('id')} source={p.get('source')}")
    else:
      print(f"  ERR {name} status={p.get('status')} {p.get('result')}", file=sys.stderr)

  if result.screenshots:
    print(f"Screenshot debug: {len(result.screenshots)} file")
    for s in result.screenshots[-5:]:
      print(f"  {s}")

  if not result.login_ok:
    return 3
  if not result.ok and not result.downloaded:
    return 4
  if any(not p.get("ok") and not p.get("skipped") for p in pushes):
    return 1
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
