"""Avvisi password Fisconline letti dal sito Agenzia delle Entrate."""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


def _uploads_root() -> Path:
  return Path(__file__).resolve().parents[3] / "uploads" / "ade"


def alerts_path() -> Path:
  raw = (os.getenv("ADE_PASSWORD_ALERTS_PATH") or "").strip()
  if raw:
    return Path(raw)
  return _uploads_root() / "password_alerts.json"


def _now_iso() -> str:
  return datetime.now(timezone.utc).isoformat()


def _read() -> Dict[str, Any]:
  path = alerts_path()
  if not path.is_file():
    return {"items": []}
  try:
    data = json.loads(path.read_text(encoding="utf-8"))
  except Exception:
    return {"items": []}
  if not isinstance(data, dict):
    return {"items": []}
  items = data.get("items")
  if not isinstance(items, list):
    items = []
  return {"items": [x for x in items if isinstance(x, dict)]}


def _write(data: Dict[str, Any]) -> None:
  path = alerts_path()
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def list_alerts() -> List[Dict[str, Any]]:
  items = list(_read().get("items") or [])
  items.sort(key=lambda x: (0 if x.get("level") == "expired" else 1, str(x.get("label") or "")))
  return items


def upsert_alert(
  *,
  profile_id: str,
  label: str = "",
  level: str = "expiring",
  message: str = "",
  days_left: Optional[int] = None,
) -> Dict[str, Any]:
  pid = (profile_id or "").strip()
  if not pid:
    raise ValueError("profile_id mancante")
  lvl = "expired" if (level or "").strip().lower() == "expired" else "expiring"
  msg = re.sub(r"\s+", " ", (message or "")).strip()[:500]
  if not msg:
    msg = (
      "La password Fisconline è scaduta."
      if lvl == "expired"
      else "La password Fisconline sta per scadere."
    )
  row = {
    "profile_id": pid,
    "label": (label or pid).strip()[:180],
    "level": lvl,
    "message": msg,
    "days_left": days_left if isinstance(days_left, int) else None,
    "detected_at": _now_iso(),
  }
  data = _read()
  items = [x for x in data["items"] if str(x.get("profile_id") or "") != pid]
  items.append(row)
  data["items"] = items
  _write(data)
  return row


def dismiss_alert(profile_id: str) -> None:
  pid = (profile_id or "").strip()
  if not pid:
    return
  data = _read()
  data["items"] = [x for x in data["items"] if str(x.get("profile_id") or "") != pid]
  _write(data)


def notice_from_page_text(body: str) -> Optional[Dict[str, Any]]:
  """Estrae l'avviso password dal testo della pagina AdE. Non restituisce credenziali."""
  compact = re.sub(r"\s+", " ", body or "").strip()
  low = compact.lower()
  if "password" not in low:
    return None
  expired = any(
    s in low
    for s in (
      "password del tuo account è scaduta",
      "password del tuo account e' scaduta",
      "password è scaduta",
      "password e' scaduta",
      "password scaduta",
    )
  )
  expiring = any(
    s in low
    for s in (
      "password scadrà",
      "password scadra",
      "password in scadenza",
      "sta per scadere",
      "prossima alla scadenza",
      "scadenza della password",
    )
  )
  if not expired and not expiring:
    return None
  days_left = 0 if expired else None
  if expiring and not expired:
    match = re.search(r"(\d{1,3})\s+giorn", low)
    if match:
      days_left = int(match.group(1))
  snippet = ""
  for sentence in re.split(r"(?<=[.!])\s+", compact):
    sl = sentence.lower()
    if "password" in sl and any(k in sl for k in ("scad", "cambio")):
      snippet = sentence.strip()
      break
  if not snippet:
    snippet = (
      "La password del tuo account è scaduta. Effettua l'operazione di cambio password."
      if expired
      else "La password Fisconline sta per scadere."
    )
  return {
    "level": "expired" if expired else "expiring",
    "message": snippet[:500],
    "days_left": days_left,
  }


def push_remote_alert(row: Dict[str, Any]) -> None:
  base = (os.getenv("ATLAS_API_BASE") or "").rstrip("/")
  if not base:
    return
  if os.getenv("ADE_STATUS_PUSH", "1").strip().lower() in ("0", "false", "no"):
    return
  url = f"{base}/ade/password-alerts"
  headers = {
    "Content-Type": "application/json",
    "User-Agent": "atlas-ade-agent/1.0",
  }
  tok = (os.getenv("SDI_RECEIVE_TOKEN") or "").strip()
  if tok:
    headers["Authorization"] = f"Bearer {tok}"
  try:
    req = urllib.request.Request(
      url,
      data=json.dumps(row).encode("utf-8"),
      method="POST",
      headers=headers,
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
      resp.read()
  except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
    pass


def publish_password_alert(**kwargs: Any) -> Dict[str, Any]:
  row = upsert_alert(**kwargs)
  push_remote_alert(row)
  return row
