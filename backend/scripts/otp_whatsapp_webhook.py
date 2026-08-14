#!/usr/bin/env python3
"""
Webhook locale OTP → WhatsApp (CallMeBot), senza Twilio.

Atlas invia POST JSON:
  {"phone":"3933...","message":"ATLAS Link codici: ...","channel":"whatsapp"}

Avvio sul server (solo localhost):
  export ACCESS_CODES_OTP_WHATSAPP_CALLMEBOT_APIKEY=LA_TUA_APIKEY
  python3 backend/scripts/otp_whatsapp_webhook.py

Poi in /opt/fornitori-app/backend/.env:
  ACCESS_CODES_OTP_WEBHOOK_URL=http://127.0.0.1:8791/send

Attivazione CallMeBot (una volta per numero):
  1) Su WhatsApp salva +34 644 86 50 05 (CallMeBot)
  2) Invia: I allow callmebot to send me messages
  3) Ricevi l'apikey e mettila in ACCESS_CODES_OTP_WHATSAPP_CALLMEBOT_APIKEY
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = os.getenv("OTP_WHATSAPP_WEBHOOK_HOST", "127.0.0.1")
PORT = int(os.getenv("OTP_WHATSAPP_WEBHOOK_PORT", "8791") or "8791")


def send_callmebot(phone: str, message: str) -> None:
    apikey = (os.getenv("ACCESS_CODES_OTP_WHATSAPP_CALLMEBOT_APIKEY") or "").strip()
    if not apikey:
        raise RuntimeError("Manca ACCESS_CODES_OTP_WHATSAPP_CALLMEBOT_APIKEY")
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 10 and digits.startswith("3"):
        digits = "39" + digits
    if len(digits) < 10:
        raise RuntimeError("Numero telefono non valido")
    qs = urllib.parse.urlencode({"phone": digits, "text": message, "apikey": apikey})
    url = f"https://api.callmebot.com/whatsapp.php?{qs}"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        if getattr(resp, "status", 200) >= 400:
            raise RuntimeError(f"CallMeBot HTTP {resp.status}: {body[:200]}")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        print(f"[otp-wa] {self.address_string()} - {fmt % args}")

    def _json(self, code: int, payload: dict) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in {"", "/health"}:
            self._json(200, {"ok": True, "service": "otp-whatsapp-webhook"})
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/send":
            self._json(404, {"ok": False, "error": "use POST /send"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8") if length else "{}")
        except Exception:
            self._json(400, {"ok": False, "error": "JSON non valido"})
            return
        phone = str(data.get("phone") or data.get("to") or "")
        message = str(data.get("message") or data.get("text") or "")
        if not phone or not message:
            self._json(400, {"ok": False, "error": "servono phone e message"})
            return
        try:
            send_callmebot(phone, message)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
            self._json(502, {"ok": False, "error": f"CallMeBot HTTP {exc.code}: {detail}"})
            return
        except Exception as exc:
            self._json(502, {"ok": False, "error": str(exc)})
            return
        self._json(200, {"ok": True, "sent": True, "channel": "whatsapp"})


def main() -> None:
    if not (os.getenv("ACCESS_CODES_OTP_WHATSAPP_CALLMEBOT_APIKEY") or "").strip():
        raise SystemExit("Imposta ACCESS_CODES_OTP_WHATSAPP_CALLMEBOT_APIKEY prima di avviare.")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"OTP WhatsApp webhook in ascolto su http://{HOST}:{PORT}/send")
    server.serve_forever()


if __name__ == "__main__":
    main()
