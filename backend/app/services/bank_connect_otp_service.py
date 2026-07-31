"""OTP monouso per collegare un conto banca (credenziali login da .env)."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import random
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from base64 import b64encode
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
_STORE: Dict[str, Dict[str, Any]] = {}
_STORE_PATH = Path(__file__).resolve().parent.parent.parent / ".bank_connect_otp_store.json"
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"

OTP_TTL_SEC = max(60, int(os.getenv("BANK_OTP_TTL_SEC", "300") or "300"))
OTP_COOLDOWN_SEC = max(15, int(os.getenv("BANK_OTP_COOLDOWN_SEC", "45") or "45"))


def _reload_bank_env() -> None:
  """Ricarica BANK_* da backend/.env (utile dopo modifica senza restart completo)."""
  load_dotenv(_ENV_FILE, override=True)


def _normalize_otp(code: Optional[str]) -> str:
  digits = "".join(ch for ch in str(code or "") if ch.isdigit())
  return digits if len(digits) == 6 else ""


def _normalize_phone(raw: Optional[str]) -> str:
  digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
  if digits.startswith("00"):
    digits = digits[2:]
  if len(digits) == 10 and digits.startswith("3"):
    digits = "39" + digits
  return digits


def _phone_hint(phone: str) -> str:
  if len(phone) < 6:
    return "***"
  return f"+{phone[:2]} *** **{phone[-4:-2]} {phone[-2:]}"


def _hash_otp(otp: str, salt: str) -> str:
  return hashlib.sha256(f"{salt}:{otp}".encode("utf-8")).hexdigest()


def _debug_enabled() -> bool:
  flag = (os.getenv("BANK_OTP_DEBUG") or "").strip().lower()
  return flag in {"1", "true", "yes", "on"}


def bank_credentials_configured() -> Tuple[bool, str]:
  _reload_bank_env()
  user = (os.getenv("BANK_USERNAME") or "").strip()
  password = (os.getenv("BANK_PASSWORD") or "").strip()
  if not user or not password:
    return False, "Credenziali banca mancanti in .env (BANK_USERNAME / BANK_PASSWORD)"
  return True, "OK"


def get_bank_env_profile() -> Dict[str, Any]:
  _reload_bank_env()
  ok, msg = bank_credentials_configured()
  return {
    "credentials_configured": ok,
    "credentials_message": msg,
    "bank_name": (os.getenv("BANK_NAME") or "").strip() or None,
    "iban": (os.getenv("BANK_IBAN") or "").strip().upper().replace(" ", "") or None,
    "portal_url": (os.getenv("BANK_PORTAL_URL") or "").strip() or None,
    "username_hint": _mask_user(os.getenv("BANK_USERNAME") or ""),
    "otp_phone_configured": bool(_otp_phone()),
  }


def _mask_user(user: str) -> str:
  u = (user or "").strip()
  if len(u) <= 2:
    return "***"
  if "@" in u:
    name, _, domain = u.partition("@")
    return f"{name[:2]}***@{domain}"
  return f"{u[:2]}***{u[-1:]}"


def _otp_phone() -> str:
  return _normalize_phone(os.getenv("BANK_OTP_PHONE") or os.getenv("ACCESS_CODES_OTP_PHONE") or "")


def _load_store() -> None:
  global _STORE
  if not _STORE_PATH.exists():
    _STORE = {}
    return
  try:
    raw = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    _STORE = raw if isinstance(raw, dict) else {}
  except Exception:
    logger.warning("Impossibile leggere store OTP banca", exc_info=True)
    _STORE = {}


def _save_store() -> None:
  try:
    _STORE_PATH.write_text(json.dumps(_STORE, ensure_ascii=False, indent=2), encoding="utf-8")
  except Exception:
    logger.warning("Impossibile salvare store OTP banca", exc_info=True)


def _send_sms(phone: str, message: str) -> None:
  webhook = (os.getenv("BANK_OTP_WEBHOOK_URL") or os.getenv("ACCESS_CODES_OTP_WEBHOOK_URL") or "").strip()
  if webhook:
    payload = json.dumps({"phone": phone, "message": message}).encode("utf-8")
    req = urllib.request.Request(
      webhook,
      data=payload,
      headers={"Content-Type": "application/json"},
      method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
      if getattr(resp, "status", 200) >= 400:
        raise RuntimeError(f"Webhook OTP banca HTTP {resp.status}")
    return

  sid = (os.getenv("TWILIO_ACCOUNT_SID") or "").strip()
  token = (os.getenv("TWILIO_AUTH_TOKEN") or "").strip()
  from_number = (os.getenv("TWILIO_FROM_NUMBER") or "").strip()
  if sid and token and from_number:
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    body = urllib.parse.urlencode(
      {"To": f"+{phone}", "From": from_number, "Body": message}
    ).encode("utf-8")
    auth = b64encode(f"{sid}:{token}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(
      url,
      data=body,
      headers={
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
      if getattr(resp, "status", 200) >= 400:
        raise RuntimeError(f"Twilio OTP banca HTTP {resp.status}")
    return

  if _debug_enabled():
    logger.info("BANK OTP debug (SMS non configurato): %s", message)
    return

  raise RuntimeError(
    "Invio OTP banca non configurato: imposta BANK_OTP_WEBHOOK_URL oppure Twilio, "
    "oppure BANK_OTP_DEBUG=1 in sviluppo"
  )


def request_bank_connect_otp(*, account_id: int) -> Dict[str, Any]:
  """Avvia login con BANK_USERNAME/PASSWORD da .env e invia OTP monouso."""
  _reload_bank_env()
  ok, msg = bank_credentials_configured()
  if not ok:
    raise ValueError(msg)

  phone = _otp_phone()
  if not phone and not _debug_enabled():
    raise ValueError("Numero OTP banca mancante in .env (BANK_OTP_PHONE)")

  key = f"account:{int(account_id)}"
  now = time.time()
  otp = f"{random.randint(0, 999999):06d}"
  salt = hashlib.sha256(f"{key}:{now}:{random.random()}".encode("utf-8")).hexdigest()[:16]

  with _LOCK:
    _load_store()
    prev = _STORE.get(key) or {}
    last_sent = float(prev.get("sent_at") or 0)
    if last_sent and (now - last_sent) < OTP_COOLDOWN_SEC:
      wait = int(OTP_COOLDOWN_SEC - (now - last_sent))
      raise ValueError(f"Attendi {wait}s prima di richiedere un nuovo OTP")

    _STORE[key] = {
      "hash": _hash_otp(otp, salt),
      "salt": salt,
      "expires_at": now + OTP_TTL_SEC,
      "sent_at": now,
      "used": False,
      "account_id": int(account_id),
    }
    _save_store()

  hint = _phone_hint(phone) if phone else "debug"
  message = f"Atlas Banca: codice OTP monouso {otp}. Scade in {OTP_TTL_SEC // 60} min."
  if phone:
    try:
      _send_sms(phone, message)
    except Exception as exc:
      with _LOCK:
        _load_store()
        _STORE.pop(key, None)
        _save_store()
      raise RuntimeError(f"Invio OTP fallito: {exc}") from exc
  elif _debug_enabled():
    logger.info("BANK OTP debug senza telefono: %s", otp)

  out: Dict[str, Any] = {
    "ok": True,
    "phone_hint": hint,
    "ttl_sec": OTP_TTL_SEC,
    "username_hint": _mask_user(os.getenv("BANK_USERNAME") or ""),
    "message": "Login banca avviato con credenziali .env. Inserisci l'OTP ricevuto.",
  }
  if _debug_enabled():
    out["debug_otp"] = otp
  return out


def verify_bank_connect_otp(*, account_id: int, otp: str) -> None:
  code = _normalize_otp(otp)
  if not code:
    raise ValueError("OTP non valido: inserisci 6 cifre")

  key = f"account:{int(account_id)}"
  now = time.time()
  with _LOCK:
    _load_store()
    row = _STORE.get(key)
    if not row:
      raise ValueError("OTP non richiesto o scaduto: richiedi un nuovo codice")
    if row.get("used"):
      raise ValueError("OTP già usato: richiedi un nuovo codice")
    if float(row.get("expires_at") or 0) < now:
      _STORE.pop(key, None)
      _save_store()
      raise ValueError("OTP scaduto: richiedi un nuovo codice")
    expected = str(row.get("hash") or "")
    salt = str(row.get("salt") or "")
    if not hmac.compare_digest(expected, _hash_otp(code, salt)):
      raise ValueError("OTP non corretto")
    row["used"] = True
    _STORE[key] = row
    _save_store()
