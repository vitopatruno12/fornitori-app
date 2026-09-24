#!/usr/bin/env python3
"""Agente ATLAS: sincronizza movimenti banca e riconcilia fatture in automatico.

- Scarica i bonifici Enable Banking
- Legge causale/descrizione (n. fattura, fornitore, importo) → Fattura collegata
- Contanti: prova dal file fornitori (Pagamenti)
- Timer tipico: martedì e venerdì 7:30 (systemd)

Uso sul server:
  cd /opt/fornitori-app/backend
  ./venv/bin/python scripts/pagamenti_bank_watch_agent.py

  # Forza anche senza variazioni:
  ./venv/bin/python scripts/pagamenti_bank_watch_agent.py --force
"""

from __future__ import annotations

import argparse
import json
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
  for p in (Path(__file__).with_name(".env"), ROOT / ".env"):
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
  parser = argparse.ArgumentParser(description="Controllo periodico Pagamenti + banca ATLAS")
  parser.add_argument("--force", action="store_true", help="Aggiorna anche se file e movimenti sono invariati")
  args = parser.parse_args()
  _load_dotenv()

  from app.database import SessionLocal
  from app.services import pagamenti_watch_agent

  db = SessionLocal()
  try:
    result = pagamenti_watch_agent.run_watch(db, force=bool(args.force))
  finally:
    db.close()

  print(result.get("message") or json.dumps(result, ensure_ascii=False))
  if result.get("accounts"):
    for acc in result["accounts"]:
      err = acc.get("error")
      if err:
        print(f"  conto {acc.get('id')} {acc.get('label')}: ERRORE {err}", file=sys.stderr)
      elif acc.get("imported"):
        print(f"  conto {acc.get('id')} {acc.get('label')}: +{acc.get('imported')} movimenti")
  return 0 if result.get("ok") else 1


if __name__ == "__main__":
  raise SystemExit(main())
