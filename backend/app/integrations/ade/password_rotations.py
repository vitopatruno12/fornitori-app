"""Password Fisconline cambiate automaticamente dall'agent AdE (specchietto Impostazioni)."""
from __future__ import annotations

import json
import os
import secrets
import string
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


def _uploads_root() -> Path:
  return Path(__file__).resolve().parents[3] / "uploads" / "ade"


def rotations_path() -> Path:
  raw = (os.getenv("ADE_PASSWORD_ROTATIONS_PATH") or "").strip()
  if raw:
    return Path(raw)
  return _uploads_root() / "password_rotations.json"


def _now_iso() -> str:
  return datetime.now(timezone.utc).isoformat()


def _read() -> Dict[str, Any]:
  path = rotations_path()
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
  path = rotations_path()
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def list_rotations(*, limit: int = 40) -> List[Dict[str, Any]]:
  """Ultime password cambiate dall'agent (una riga per società, la più recente)."""
  items = list(_read().get("items") or [])
  items.sort(key=lambda x: str(x.get("changed_at") or ""), reverse=True)
  seen: set[str] = set()
  out: List[Dict[str, Any]] = []
  for row in items:
    pid = str(row.get("profile_id") or "").strip()
    if not pid or pid in seen:
      continue
    seen.add(pid)
    out.append(row)
    if len(out) >= max(1, limit):
      break
  return out


def record_rotation(
  *,
  profile_id: str,
  label: str = "",
  password: str,
  source: str = "agent",
  message: str = "",
  days_left: Optional[int] = None,
) -> Dict[str, Any]:
  pid = (profile_id or "").strip()
  pwd = (password or "").strip()
  if not pid:
    raise ValueError("profile_id mancante")
  if not pwd:
    raise ValueError("password mancante")
  row = {
    "profile_id": pid,
    "label": (label or pid).strip()[:180],
    "password": pwd[:128],
    "source": (source or "agent").strip()[:40] or "agent",
    "message": (message or "").strip()[:400],
    "days_left": days_left if isinstance(days_left, int) else None,
    "changed_at": _now_iso(),
  }
  data = _read()
  items = [x for x in data["items"] if str(x.get("profile_id") or "") != pid]
  items.append(row)
  # Tieni storico recente oltre allo specchio "ultima per società"
  data["items"] = items[-80:]
  _write(data)
  return row


def generate_fisconline_password(*, old_password: str = "", codice_fiscale: str = "") -> str:
  """
  Genera password conforme alle regole tipiche Fisconline/AdE:
  lunghezza 12–14, maiuscole, minuscole, cifre, simbolo; diversa dalla precedente.
  """
  specials = "!@#$%&*?"
  lower = string.ascii_lowercase
  upper = string.ascii_uppercase
  digits = string.digits
  alphabet = lower + upper + digits + specials
  old = (old_password or "").strip()
  cf = (codice_fiscale or "").strip().upper()

  for _ in range(40):
    length = secrets.choice((12, 13, 14))
    chars = [
      secrets.choice(lower),
      secrets.choice(upper),
      secrets.choice(digits),
      secrets.choice(specials),
    ]
    chars.extend(secrets.choice(alphabet) for _ in range(length - 4))
    # mescola
    for i in range(len(chars) - 1, 0, -1):
      j = secrets.randbelow(i + 1)
      chars[i], chars[j] = chars[j], chars[i]
    pwd = "".join(chars)
    if pwd == old:
      continue
    if cf and cf.lower() in pwd.lower():
      continue
    return pwd
  # fallback estremamente improbabile
  return f"Ad{secrets.token_urlsafe(8)}!1a"


def auto_rotate_enabled() -> bool:
  return (os.getenv("ADE_AUTO_ROTATE_PASSWORD", "1") or "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
  )


def should_auto_rotate(notice: Optional[Dict[str, Any]]) -> bool:
  if not notice or not auto_rotate_enabled():
    return False
  level = str(notice.get("level") or "").strip().lower()
  if level == "expired":
    return True
  try:
    threshold = int((os.getenv("ADE_AUTO_ROTATE_DAYS") or "7").strip() or "7")
  except ValueError:
    threshold = 7
  days = notice.get("days_left")
  if isinstance(days, int):
    return days <= threshold
  # Avviso generico "in scadenza" senza giorni → ruota comunque
  return level == "expiring"


def push_remote_credentials(*, profile_id: str, password: str) -> bool:
  """Copia la nuova password su Atlas Impostazioni (PUT credentials)."""
  base = (os.getenv("ATLAS_API_BASE") or "").rstrip("/")
  if not base:
    return False
  if (os.getenv("ADE_STATUS_PUSH", "1") or "1").strip().lower() in ("0", "false", "no"):
    return False
  url = f"{base}/ade/profiles/{profile_id}/credentials"
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
      data=json.dumps({"fisconline_password": password}).encode("utf-8"),
      method="PUT",
      headers=headers,
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
      resp.read()
    return True
  except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
    return False


def push_remote_rotation(row: Dict[str, Any]) -> None:
  base = (os.getenv("ATLAS_API_BASE") or "").rstrip("/")
  if not base:
    return
  if (os.getenv("ADE_STATUS_PUSH", "1") or "1").strip().lower() in ("0", "false", "no"):
    return
  url = f"{base}/ade/password-rotations"
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


def publish_rotation(**kwargs: Any) -> Dict[str, Any]:
  row = record_rotation(**kwargs)
  push_remote_rotation(row)
  return row


def apply_rotated_password_locally(
  *,
  profile_id: str,
  password: str,
) -> Dict[str, Any]:
  """Scrive la password nel profiles.json locale usato dall'agent."""
  from .profiles import update_fisconline_credentials

  return update_fisconline_credentials(profile_id, password=password)
