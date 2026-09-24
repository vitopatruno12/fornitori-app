"""Avvio locale o poll remoto dell'agent AdE."""
from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)

_BACKEND = Path(__file__).resolve().parents[3]


def try_spawn_local() -> Dict[str, Any]:
  """Se ADE_RUN_LOCAL=1, lancia ade_sync_agent.py in background sul server."""
  flag = (os.getenv("ADE_RUN_LOCAL") or "").strip().lower()
  if flag not in {"1", "true", "yes", "on"}:
    return {"started": False, "reason": "ADE_RUN_LOCAL non attivo"}

  script = _BACKEND / "scripts" / "ade_sync_agent.py"
  if not script.is_file():
    return {"started": False, "reason": "script ade_sync_agent.py assente"}

  py = sys.executable
  env = os.environ.copy()
  env.setdefault("ADE_STATUS_PUSH", "0")  # stato già sul server
  env.setdefault("ADE_HEADLESS", "1")
  log_dir = _BACKEND / "uploads" / "ade_logs"
  log_dir.mkdir(parents=True, exist_ok=True)
  out = open(log_dir / "ade_ui_run.log", "a", encoding="utf-8")  # noqa: SIM115
  try:
    # Consuma la coda prima di partire (evita doppio run dal listener)
    from .agent_status import consume_run_request, read_status

    if read_status().get("running"):
      return {"started": False, "reason": "già in esecuzione"}
    consume_run_request()
    proc = subprocess.Popen(  # noqa: S603
      [py, str(script)],
      cwd=str(_BACKEND),
      env=env,
      stdout=out,
      stderr=subprocess.STDOUT,
      start_new_session=True,
    )
    return {"started": True, "pid": proc.pid}
  except Exception as exc:  # noqa: BLE001
    logger.warning("Spawn agent AdE locale fallito: %s", exc, exc_info=True)
    return {"started": False, "reason": str(exc)[:200]}
  finally:
    try:
      out.close()
    except Exception:
      pass
