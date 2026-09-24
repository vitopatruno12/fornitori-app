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


def _run_sync(mode: str, lookback_days, profile_id: str = "") -> int:
  env = os.environ.copy()
  env["ADE_STATUS_PUSH"] = "1"
  env["ADE_HEADLESS"] = env.get("ADE_HEADLESS") or "1"
  env["ADE_USE_SYSTEM_CHROME"] = "1"
  env["ADE_FAST_LOGIN"] = "1"
  env["ADE_KEEP_SESSION"] = "1"
  env["ADE_DEBUG_SCREENSHOTS"] = "0"
  env["ADE_STEP_DELAY_MS"] = env.get("ADE_STEP_DELAY_MS") or "60"
  # UI: solo ricevute (emesse raddoppiano il tempo)
  env["ADE_MASS_KINDS"] = env.get("ADE_MASS_KINDS") or "ricevute"
  if lookback_days:
    env["ADE_LOOKBACK_DAYS"] = str(int(lookback_days))
  else:
    env.setdefault("ADE_LOOKBACK_DAYS", "15")
  env.pop("ADE_RICHIESTE_ONLY", None)
  env.pop("ADE_RISPOSTE_ONLY", None)
  env.pop("ADE_ONLY_PROFILE", None)
  m = (mode or "download").lower()
  if m == "request":
    env["ADE_RICHIESTE_ONLY"] = "1"
  elif m == "download":
    env["ADE_RISPOSTE_ONLY"] = "1"
  if profile_id:
    env["ADE_ONLY_PROFILE"] = str(profile_id).strip()

  from app.integrations.ade.agent_status import report

  report(
    "connecting",
    f"Avvio scarico AdE richiesto da Atlas…"
    + (f" [{profile_id}]" if profile_id else "")
    + (f" · {lookback_days} gg" if lookback_days else ""),
    mode=m,
    progress=2,
    profile_id=profile_id or "",
  )

  py = ROOT / ".venv" / "Scripts" / "python.exe"
  if not py.is_file():
    py = Path(sys.executable)
  script = ROOT / "scripts" / "ade_sync_agent.py"
  print(f"Eseguo {script} mode={m} lookback={lookback_days} profile={profile_id or 'tutti'}")
  proc = subprocess.run([str(py), str(script)], cwd=str(ROOT), env=env, check=False)
  return int(proc.returncode or 0)


def main() -> int:
  _load_dotenv()
  interval = max(8, int(os.getenv("ADE_UI_POLL_SEC", "12") or "12"))
  print(f"Listener AdE UI attivo (poll ogni {interval}s, modalità veloce). Ctrl+C per uscire.")
  while True:
    try:
      st = _api_get("/ade/agent/status")
      stuck = bool(st.get("running")) and str(st.get("phase") or "") in {
        "connecting",
        "queued",
        "idle",
        "done",
        "error",
      }
      if stuck and not st.get("run_requested"):
        if st.get("phase") in ("done", "error", "idle") or st.get("finished_at"):
          from app.integrations.ade.agent_status import write_status

          write_status(
            push_remote=True,
            running=False,
            phase=st.get("phase") or "idle",
            message=st.get("message") or "Pronto",
          )
          st = {**st, "running": False}

      if st.get("run_requested") and not st.get("running"):
        mode = st.get("run_mode") or "download"
        days = st.get("run_lookback_days")
        profile = str(st.get("run_profile_id") or "").strip()
        print(f"Richiesta UI rilevata: mode={mode} days={days} profile={profile or '*'}")
        from app.integrations.ade.agent_status import write_status

        write_status(
          push_remote=True,
          run_requested=False,
          running=True,
          phase="connecting",
          mode=mode,
          message="PC ufficio: avvio scarico AdE veloce…",
          progress=1,
          finished_at=None,
          ok=None,
          error="",
          run_profile_id="",
        )
        try:
          code = _run_sync(mode, days, profile)
          print(f"Sync terminato exit={code}")
        except Exception as exc:  # noqa: BLE001
          print(f"Sync fallito: {exc}", file=sys.stderr)
          write_status(
            push_remote=True,
            running=False,
            phase="error",
            ok=False,
            error=str(exc)[:300],
            message=f"Errore listener: {exc}"[:300],
          )
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
