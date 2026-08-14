"""Invio WhatsApp Cloud API (Meta), senza Twilio/CallMeBot."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any, Dict, Optional


def normalize_wa_phone(raw: Optional[str]) -> str:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 10 and digits.startswith("3"):
        digits = "39" + digits
    return digits


def extract_otp(message: str, otp: Optional[str] = None) -> str:
    got = "".join(ch for ch in str(otp or "") if ch.isdigit())
    if len(got) == 6:
        return got
    m = re.search(r"\b(\d{6})\b", str(message or ""))
    return m.group(1) if m else ""


def meta_configured() -> bool:
    token = (os.getenv("WHATSAPP_CLOUD_TOKEN") or os.getenv("WHATSAPP_TOKEN") or "").strip()
    phone_id = (os.getenv("WHATSAPP_PHONE_NUMBER_ID") or "").strip()
    return bool(token and phone_id)


def _graph_url(phone_id: str) -> str:
    ver = (os.getenv("WHATSAPP_GRAPH_VERSION") or "v21.0").strip().lstrip("/")
    return f"https://graph.facebook.com/{ver}/{phone_id}/messages"


def _post_graph(url: str, token: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    raw = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=raw,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            status = getattr(resp, "status", 200)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"WhatsApp Meta HTTP {exc.code}: {detail}") from exc
    if status >= 400:
        raise RuntimeError(f"WhatsApp Meta HTTP {status}: {body[:400]}")
    try:
        return json.loads(body) if body else {}
    except json.JSONDecodeError:
        return {"raw": body}


def send_whatsapp_cloud(phone: str, message: str, otp: Optional[str] = None) -> str:
    """Invia OTP via Meta. Ritorna 'template' o 'text'."""
    token = (os.getenv("WHATSAPP_CLOUD_TOKEN") or os.getenv("WHATSAPP_TOKEN") or "").strip()
    phone_id = (os.getenv("WHATSAPP_PHONE_NUMBER_ID") or "").strip()
    if not token or not phone_id:
        raise RuntimeError(
            "WhatsApp Meta non configurato: imposta WHATSAPP_CLOUD_TOKEN e WHATSAPP_PHONE_NUMBER_ID"
        )

    to = normalize_wa_phone(phone)
    if len(to) < 10:
        raise RuntimeError("Numero WhatsApp non valido")

    url = _graph_url(phone_id)
    template = (os.getenv("WHATSAPP_OTP_TEMPLATE") or "").strip()
    lang = (os.getenv("WHATSAPP_OTP_TEMPLATE_LANG") or "it").strip() or "it"
    code = extract_otp(message, otp)

    if template:
        if not code:
            raise RuntimeError("Template OTP Meta: manca il codice a 6 cifre")
        components: list[Dict[str, Any]] = [
            {
                "type": "body",
                "parameters": [{"type": "text", "text": code}],
            }
        ]
        button = (os.getenv("WHATSAPP_OTP_TEMPLATE_BUTTON") or "copy_code").strip().lower()
        if button in {"url", "copy_code"}:
            components.append(
                {
                    "type": "button",
                    "sub_type": button,
                    "index": "0",
                    "parameters": [{"type": "text", "text": code}],
                }
            )
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": template,
                "language": {"code": lang},
                "components": components,
            },
        }
        _post_graph(url, token, payload)
        return "template"

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "text",
        "text": {"preview_url": False, "body": message},
    }
    _post_graph(url, token, payload)
    return "text"
