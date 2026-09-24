#!/usr/bin/env python3
"""Listener PC ufficio: intercetta «Aggiorna da AdE» da Atlas e lancia lo scarico.

Uso (Task Scheduler ogni 1 minuto, o lasciato aperto):
  cd backend
  .\\.venv\\Scripts\\python.exe scripts\\ade_agent_ui_listener.py

Legge GET https://www.atlass.it/api/ade/agent/status
Se run_requested=true → esegue ade_sync_agent.py (Fisconline headless).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
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


def _api_get(path: str) -> dict:
  base = (os.getenv("ATLAS_API_BASE") or "https://www.atlass.it/api").rstrip("/")
  url = f"{base}{path}"
  headers = {"User-Agent": "atlas-ade-ui-listener/1.0"}
  tok = (os.getenv("SDI_RECEIVE_TOKEN") or "").strip()
  if tok:
    headers["Authorization"] = f"Bearer {tok}"
  req = urllib.request.Request(url, headers=headers, method="GET")
  with urllib.request.urlopen(req, timeout=20) as resp:
    return json.loads(resp.read().decode("utf-8"))


def _run_sync(mode: str, lookback_days) -> int:
  env = os.environ.copy()
  env["ADE_STATUS_PUSH"] = "1"
  env["ADE_HEADLESS"] = env.get("ADE_HEADLESS") or "1"
  env["ADE_USE_SYSTEM_CHROME"] = "1"
  env["ADE_FAST_LOGIN"] = "1"
  if lookback_days:
    env["ADE_LOOKBACK_DAYS"] = str(int(lookback_days))
  env.pop("ADE_RICHIESTE_ONLY", None)
  env.pop("ADE_RISPOSTE_ONLY", None)
  m = (mode or "download").lower()
  if m == "request":
    env["ADE_RICHIESTE_ONLY"] = "1"
  elif m == "download":
    env["ADE_RISPOSTE_ONLY"] = "1"
  # full = entrambe le fasi via sync_all

  # Su PC locale lo status file è locale; la coda è sul server.
  # Marca avvio remoto:
  report("connecting", "Avvio scarico AdE richiesto da Atlas…", mode=m, progress=2)

  py = ROOT / ".venv" / "Scripts" / "python.exe"
  if not py.is_file():
    py = Path(sys.executable)
  script = ROOT / "scripts" / "ade_sync_agent.py"
  print(f"Eseguo {script} mode={m} lookback={lookback_days}")
  proc = subprocess.run([str(py), str(script)], cwd=str(ROOT), env=env, check=False)
  return int(proc.returncode or 0)


def main() -> int:
  _load_dotenv()
  interval = max(15, int(os.getenv("ADE_UI_POLL_SEC", "45") or "45"))
  print(f"Listener AdE UI attivo (poll ogni {interval}s). Ctrl+C per uscire.")
  while True:
    try:
      st = _api_get("/ade/agent/status")
      if st.get("run_requested") and not st.get("running"):
        mode = st.get("run_mode") or "download"
        days = st.get("run_lookback_days")
        print(f"Richiesta UI rilevata: mode={mode} days={days}")
        # Ack remoto: cancella run_requested sul server
        from app.integrations.ade.agent_status import write_status

        write_status(
          push_remote=True,
          run_requested=False,
          running=True,
          phase="connecting",
          mode=mode,
          message="PC ufficio: avvio scarico AdE…",
          progress=1,
          finished_at=None,
          ok=None,
          error="",
        )
        code = _run_sync(mode, days)
        print(f"Sync terminato exit={code}")
      else:
        phase = st.get("phase") or "idle"
        print(f"  idle phase={phase} running={st.get('running')}", flush=True)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
      print(f"  poll errore: {exc}", file=sys.stderr)
    except KeyboardInterrupt:
      print("Stop listener.")
      return 0
    time.sleep(interval)


if __name__ == "__main__":
  raise SystemExit(main())
