"""OTP monouso a 6 cifre per sbloccare Link codici."""

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
from typing import Any, Dict, Optional

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
_STORE: Dict[str, Dict[str, Any]] = {}
_STORE_PATH = Path(__file__).resolve().parent.parent.parent / ".access_code_otp_store.json"
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"

OTP_TTL_SEC = max(60, int(os.getenv("ACCESS_CODES_OTP_TTL_SEC", "300") or "300"))
OTP_COOLDOWN_SEC = max(15, int(os.getenv("ACCESS_CODES_OTP_COOLDOWN_SEC", "45") or "45"))


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


def _reload_otp_env() -> None:
    """Ricarica ACCESS_CODES_OTP_* da backend/.env (anche senza restart)."""
    load_dotenv(_ENV_FILE, override=True)


def _debug_enabled() -> bool:
    flag = (os.getenv("ACCESS_CODES_OTP_DEBUG") or "").strip().lower()
    if flag in {"1", "true", "yes", "on"}:
        return True
    return (os.getenv("DEBUG_ERRORS") or "").strip().lower() in {"1", "true", "yes", "on"}


def _otp_phone() -> str:
    return _normalize_phone(os.getenv("ACCESS_CODES_OTP_PHONE") or "")


def resolve_otp_phone(raw: Optional[str] = None) -> str:
    """Numero dalla UI, altrimenti ACCESS_CODES_OTP_PHONE nel .env."""
    typed = _normalize_phone(raw)
    if typed:
        if len(typed) == 12 and typed.startswith("39") and typed[2] == "3":
            return typed
        if len(typed) == 10 and typed.startswith("3"):
            return "39" + typed
        raise ValueError("Numero non valido: usa un cellulare italiano (es. 3331234567).")
    return _otp_phone()


def _load_store() -> None:
    global _STORE
    try:
        if not _STORE_PATH.exists():
            return
        raw = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            _STORE = {str(k): v for k, v in raw.items() if isinstance(v, dict)}
    except Exception:
        logger.warning("Impossibile leggere store OTP Link codici", exc_info=True)


def _save_store() -> None:
    try:
        _STORE_PATH.write_text(json.dumps(_STORE), encoding="utf-8")
    except Exception:
        logger.warning("Impossibile salvare store OTP Link codici", exc_info=True)


def _purge_expired(now: float) -> None:
    dead = [k for k, v in _STORE.items() if float(v.get("expires_at") or 0) <= now]
    for k in dead:
        _STORE.pop(k, None)


def _send_via_webhook(phone: str, message: str, otp: str = "") -> bool:
    """POST JSON a ACCESS_CODES_OTP_WEBHOOK_URL (script locale → WhatsApp Meta)."""
    webhook = (os.getenv("ACCESS_CODES_OTP_WEBHOOK_URL") or "").strip()
    if not webhook:
        return False
    body = json.dumps(
        {
            "phone": phone,
            "to": phone,
            "message": message,
            "text": message,
            "otp": otp,
            "channel": "whatsapp",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        webhook,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        if getattr(resp, "status", 200) >= 400:
            raise RuntimeError(f"Webhook OTP HTTP {resp.status}")
    return True


def _send_via_twilio_sms(phone: str, message: str) -> bool:
    sid = (os.getenv("TWILIO_ACCOUNT_SID") or "").strip()
    token = (os.getenv("TWILIO_AUTH_TOKEN") or "").strip()
    from_number = (os.getenv("TWILIO_FROM_NUMBER") or "").strip()
    if not (sid and token and from_number):
        return False
    to = f"+{phone}" if not phone.startswith("+") else phone
    form = urllib.parse.urlencode({"To": to, "From": from_number, "Body": message}).encode("utf-8")
    auth = b64encode(f"{sid}:{token}".encode("ascii")).decode("ascii")
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    req = urllib.request.Request(
        url,
        data=form,
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        if getattr(resp, "status", 200) >= 400:
            raise RuntimeError(f"Twilio OTP HTTP {resp.status}")
    return True


def _send_otp_message(phone: str, message: str, otp: str = "") -> None:
    """Invia OTP: webhook locale (Meta) → Twilio SMS → debug."""
    if _send_via_webhook(phone, message, otp=otp):
        return
    if _send_via_twilio_sms(phone, message):
        return

    if _debug_enabled():
        logger.info("ACCESS_CODES OTP debug (canale WhatsApp non configurato): %s", message)
        return

    raise RuntimeError(
        "Invio OTP non configurato: imposta ACCESS_CODES_OTP_WEBHOOK_URL "
        "(http://127.0.0.1:8791/send → WhatsApp Meta) "
        "con WHATSAPP_CLOUD_TOKEN e WHATSAPP_PHONE_NUMBER_ID, "
        "oppure ACCESS_CODES_OTP_DEBUG=1 in sviluppo."
    )


def request_otp(query_key: str, phone: Optional[str] = None) -> Dict[str, Any]:
    """Crea e invia un OTP monouso legato al nome locale/registro."""
    _reload_otp_env()
    key = str(query_key or "").strip().lower()
    if len(key) < 2:
        raise ValueError("Nome locale o registro non valido.")

    dest = resolve_otp_phone(phone)
    if not dest and not _debug_enabled():
        raise ValueError("Inserisci il numero di cellulare per ricevere l'OTP su WhatsApp.")

    now = time.time()
    with _LOCK:
        _load_store()
        _purge_expired(now)
        existing = _STORE.get(key)
        if existing and float(existing.get("sent_at") or 0) + OTP_COOLDOWN_SEC > now:
            wait = int(OTP_COOLDOWN_SEC - (now - float(existing.get("sent_at") or 0)))
            raise ValueError(f"Attendi {max(wait, 1)} secondi prima di richiedere un nuovo OTP.")

        otp = f"{random.randint(0, 999999):06d}"
        salt = f"{key}:{now:.3f}:{random.randint(1000, 9999)}"
        _STORE[key] = {
            "hash": _hash_otp(otp, salt),
            "salt": salt,
            "expires_at": now + OTP_TTL_SEC,
            "sent_at": now,
            "used": False,
            "attempts": 0,
        }
        _save_store()

    message = (
        f"ATLAS Link codici: il tuo codice monouso e' {otp}. "
        f"Valido {OTP_TTL_SEC // 60} minuti. Non condividerlo."
    )

    sent = False
    send_error = ""
    if dest:
        try:
            _send_otp_message(dest, message, otp=otp)
            sent = True
        except Exception as exc:
            send_error = str(exc)
            logger.exception("Invio OTP Link codici fallito")
            if not _debug_enabled():
                with _LOCK:
                    _STORE.pop(key, None)
                    _save_store()
                raise ValueError(f"Impossibile inviare l'OTP sul telefono: {send_error}") from exc
    else:
        logger.warning("Nessun telefono OTP: codice solo in debug: %s", otp)

    logger.info(
        "OTP Link codici generato per query_key=%s phone=%s sent=%s",
        key,
        _phone_hint(dest) if dest else "n/a",
        sent,
    )

    out: Dict[str, Any] = {
        "ok": True,
        "phone_hint": _phone_hint(dest) if dest else "debug",
        "expires_in_sec": OTP_TTL_SEC,
        "sent": sent,
    }
    if _debug_enabled():
        out["debug_otp"] = otp
        if send_error:
            out["debug_send_error"] = send_error
    return out


def verify_unlock_password(password: Optional[str]) -> None:
    """Verifica password di sblocco Link codici (sostituto temporaneo dell'OTP WhatsApp)."""
    _reload_otp_env()
    expected = (os.getenv("ACCESS_CODES_UNLOCK_PASSWORD") or "").strip()
    if not expected:
        raise ValueError(
            "Password Link codici non configurata sul server (ACCESS_CODES_UNLOCK_PASSWORD)."
        )
    provided = str(password or "").strip()
    if not provided:
        raise ValueError("Inserisci la password di sblocco.")
    if not hmac.compare_digest(provided, expected):
        raise ValueError("Password non valida.")


def verify_and_consume_otp(query_key: str, otp_code: Optional[str]) -> None:
    """Verifica OTP monouso. In caso di successo lo consuma (non riutilizzabile)."""
    key = str(query_key or "").strip().lower()
    otp = _normalize_otp(otp_code)
    if not otp:
        raise ValueError("Inserisci il codice OTP a 6 cifre ricevuto sul telefono.")

    now = time.time()
    with _LOCK:
        _load_store()
        _purge_expired(now)
        row = _STORE.get(key)
        if not row:
            raise ValueError("OTP assente o scaduto: richiedi un nuovo codice.")
        if row.get("used"):
            raise ValueError("OTP già usato: richiedi un nuovo codice.")
        if float(row.get("expires_at") or 0) <= now:
            _STORE.pop(key, None)
            _save_store()
            raise ValueError("OTP scaduto: richiedi un nuovo codice.")

        attempts = int(row.get("attempts") or 0) + 1
        row["attempts"] = attempts
        expected = str(row.get("hash") or "")
        salt = str(row.get("salt") or "")
        got = _hash_otp(otp, salt)
        if not hmac.compare_digest(expected, got):
            _save_store()
            if attempts >= 5:
                _STORE.pop(key, None)
                _save_store()
                raise ValueError("Troppi tentativi errati: richiedi un nuovo OTP.")
            raise ValueError("Codice OTP non valido.")

        row["used"] = True
        _STORE.pop(key, None)  # monouso: rimuovi subito
        _save_store()
