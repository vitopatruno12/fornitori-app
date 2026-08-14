#!/usr/bin/env python3
"""
Webhook locale OTP → WhatsApp Business Cloud API (Meta).

Flusso:
  Atlas → POST http://127.0.0.1:8791/send → Meta Graph API → telefono

JSON atteso:
  {"phone":"3933...","message":"...","otp":"123456","channel":"whatsapp"}

Variabili in backend/.env:
  WHATSAPP_CLOUD_TOKEN=...
  WHATSAPP_PHONE_NUMBER_ID=...
  WHATSAPP_OTP_TEMPLATE=atlas_otp          # opzionale, consigliato in produzione
  WHATSAPP_OTP_TEMPLATE_LANG=it
  ACCESS_CODES_OTP_WEBHOOK_URL=http://127.0.0.1:8791/send
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.whatsapp_cloud import meta_configured, send_whatsapp_cloud  # noqa: E402

HOST = os.getenv("OTP_WHATSAPP_WEBHOOK_HOST", "127.0.0.1")
PORT = int(os.getenv("OTP_WHATSAPP_WEBHOOK_PORT", "8791") or "8791")


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
            self._json(
                200,
                {
                    "ok": True,
                    "service": "otp-whatsapp-webhook",
                    "channel": "meta",
                    "configured": meta_configured(),
                },
            )
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
        otp = str(data.get("otp") or "")
        if not phone or not message:
            self._json(400, {"ok": False, "error": "servono phone e message"})
            return
        try:
            mode = send_whatsapp_cloud(phone, message, otp=otp)
        except Exception as exc:
            self._json(502, {"ok": False, "error": str(exc)})
            return
        self._json(200, {"ok": True, "sent": True, "channel": "whatsapp-meta", "mode": mode})


def main() -> None:
    if not meta_configured():
        raise SystemExit(
            "Imposta WHATSAPP_CLOUD_TOKEN e WHATSAPP_PHONE_NUMBER_ID in backend/.env"
        )
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"OTP WhatsApp Meta webhook in ascolto su http://{HOST}:{PORT}/send")
    server.serve_forever()


if __name__ == "__main__":
    main()
