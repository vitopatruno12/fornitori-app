"""Password Fisconline cambiate automaticamente dall'agent AdE (specchietto Impostazioni)."""
from __future__ import annotations

import json
import os
import re
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
  pin: Optional[str] = None,
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
  pin_v = (pin or "").strip()
  row = {
    "profile_id": pid,
    "label": (label or pid).strip()[:180],
    "password": pwd[:128],
    "source": (source or "agent").strip()[:40] or "agent",
    "message": (message or "").strip()[:400],
    "days_left": days_left if isinstance(days_left, int) else None,
    "changed_at": _now_iso(),
  }
  if pin_v:
    row["pin"] = pin_v[:20]
    row["pin_changed_at"] = row["changed_at"]
  data = _read()
  previous = next((x for x in data["items"] if str(x.get("profile_id") or "") == pid), None)
  if previous and not pin_v and previous.get("pin"):
    row["pin"] = str(previous.get("pin") or "")[:20]
    row["pin_changed_at"] = previous.get("pin_changed_at") or previous.get("changed_at")
  items = [x for x in data["items"] if str(x.get("profile_id") or "") != pid]
  items.append(row)
  data["items"] = items[-80:]
  _write(data)
  _stamp_clock(pid, password_at=row["changed_at"], pin_at=row.get("pin_changed_at"))
  return row


def generate_fisconline_password(*, old_password: str = "", codice_fiscale: str = "") -> str:
  """
  Genera password conforme alle regole Fisconline/AdE (pagina Cambio Password):
  8–15 caratteri, solo lettere non accentate e/o numeri (niente simboli).
  """
  lower = string.ascii_lowercase
  upper = string.ascii_uppercase
  digits = string.digits
  alphabet = lower + upper + digits
  old = (old_password or "").strip()
  cf = (codice_fiscale or "").strip().upper()

  for _ in range(40):
    length = secrets.choice((10, 11, 12, 13, 14))
    chars = [
      secrets.choice(lower),
      secrets.choice(upper),
      secrets.choice(digits),
      secrets.choice(lower),
    ]
    chars.extend(secrets.choice(alphabet) for _ in range(length - 4))
    for i in range(len(chars) - 1, 0, -1):
      j = secrets.randbelow(i + 1)
      chars[i], chars[j] = chars[j], chars[i]
    pwd = "".join(chars)
    if pwd == old:
      continue
    if cf and cf.lower() in pwd.lower():
      continue
    if not re.fullmatch(r"[A-Za-z0-9]{8,15}", pwd):
      continue
    return pwd
  return f"Ad{secrets.token_hex(4)}x1"


def generate_fisconline_pin(*, old_pin: str = "") -> str:
  """PIN Fisconline: 10 cifre, diverso dal precedente, senza tre cifre uguali di fila."""
  old = re.sub(r"\D", "", old_pin or "")
  for _ in range(60):
    pin = "".join(str(secrets.randbelow(10)) for _ in range(10))
    if pin == old:
      continue
    if re.search(r"(\d)\1\1", pin):
      continue
    if pin in ("0123456789", "9876543210", "0000000000"):
      continue
    if len(set(pin)) < 4:
      continue
    return pin
  return f"{secrets.randbelow(9000000000) + 1000000000:010d}"


def credential_validity_days() -> int:
  try:
    return max(30, min(180, int((os.getenv("ADE_CREDENTIAL_VALID_DAYS") or "90").strip() or "90")))
  except ValueError:
    return 90


def rotate_within_days() -> int:
  try:
    return max(1, min(30, int((os.getenv("ADE_AUTO_ROTATE_DAYS") or "7").strip() or "7")))
  except ValueError:
    return 7


def _clock_path() -> Path:
  return _uploads_root() / "credential_clock.json"


def _read_clock() -> Dict[str, Any]:
  path = _clock_path()
  if not path.is_file():
    return {}
  try:
    data = json.loads(path.read_text(encoding="utf-8"))
  except Exception:
    return {}
  return data if isinstance(data, dict) else {}


def _write_clock(data: Dict[str, Any]) -> None:
  path = _clock_path()
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _parse_iso(raw: Any) -> Optional[datetime]:
  text = str(raw or "").strip()
  if not text:
    return None
  try:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))
  except ValueError:
    return None


def _stamp_clock(profile_id: str, *, password_at: Optional[str] = None, pin_at: Optional[str] = None) -> None:
  pid = (profile_id or "").strip().lower()
  if not pid:
    return
  data = _read_clock()
  row = data.get(pid) if isinstance(data.get(pid), dict) else {}
  if password_at:
    row["password_at"] = password_at
  if pin_at:
    row["pin_at"] = pin_at
  data[pid] = row
  _write_clock(data)


def remember_credential_baseline(profile_id: str) -> None:
  """Primo accesso riuscito: da qui partono i 90 giorni, senza cambiare le credenziali."""
  pid = (profile_id or "").strip().lower()
  if not pid:
    return
  data = _read_clock()
  row = data.get(pid) if isinstance(data.get(pid), dict) else {}
  now = _now_iso()
  if not row.get("password_at"):
    row["password_at"] = now
  if not row.get("pin_at"):
    row["pin_at"] = now
  data[pid] = row
  _write_clock(data)


def credentials_due(profile_id: str) -> Dict[str, Any]:
  """True se password o PIN sono dentro la finestra prima della scadenza."""
  pid = (profile_id or "").strip().lower()
  valid = credential_validity_days()
  window = rotate_within_days()
  data = _read_clock()
  row = data.get(pid) if isinstance(data.get(pid), dict) else {}
  now = datetime.now(timezone.utc)

  def _days_left(key: str) -> Optional[int]:
    started = _parse_iso(row.get(key))
    if started is None:
      return None
    if started.tzinfo is None:
      started = started.replace(tzinfo=timezone.utc)
    age = (now - started).days
    return valid - age

  pwd_left = _days_left("password_at")
  pin_left = _days_left("pin_at")
  pwd_due = isinstance(pwd_left, int) and pwd_left <= window
  pin_due = isinstance(pin_left, int) and pin_left <= window
  return {
    "password_due": pwd_due,
    "pin_due": pin_due,
    "due": pwd_due or pin_due,
    "password_days_left": pwd_left,
    "pin_days_left": pin_left,
    "known": pwd_left is not None or pin_left is not None,
  }


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
    threshold = rotate_within_days()
  except Exception:
    threshold = 7
  days = notice.get("days_left")
  if isinstance(days, int):
    return days <= threshold
  # Avviso generico "in scadenza" senza giorni → ruota comunque
  return level == "expiring"


def push_remote_credentials(*, profile_id: str, password: Optional[str] = None, pin: Optional[str] = None) -> bool:
  """Copia password e PIN nuovi su Atlas Impostazioni (PUT credentials)."""
  base = (os.getenv("ATLAS_API_BASE") or "").rstrip("/")
  if not base:
    return False
  if (os.getenv("ADE_STATUS_PUSH", "1") or "1").strip().lower() in ("0", "false", "no"):
    return False
  payload: Dict[str, str] = {}
  if (password or "").strip():
    payload["fisconline_password"] = password.strip()
  if (pin or "").strip():
    payload["fisconline_pin"] = pin.strip()
  if not payload:
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
      data=json.dumps(payload).encode("utf-8"),
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
  password: Optional[str] = None,
  pin: Optional[str] = None,
) -> Dict[str, Any]:
  """Scrive password e PIN nel profiles.json locale usato dall'agent."""
  from .profiles import update_fisconline_credentials

  return update_fisconline_credentials(profile_id, password=password, pin=pin)
