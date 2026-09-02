"""Push XML/ZIP FatturaPA verso Atlas + assegnazione sezione sede."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional


def _api_base(api_base: Optional[str] = None) -> str:
  return (api_base or os.getenv("ATLAS_API_BASE") or "https://www.atlass.it/api").rstrip("/")


def _token(token: Optional[str] = None) -> str:
  return (token if token is not None else os.getenv("SDI_RECEIVE_TOKEN") or "").strip()


def push_xml_bytes(
  file_bytes: bytes,
  *,
  filename: str = "fattura.xml",
  sede: str = "",
  profile_id: str = "",
  api_base: Optional[str] = None,
  token: Optional[str] = None,
  timeout_sec: int = 120,
) -> Dict[str, Any]:
  """
  Invia raw XML/ZIP a Atlas POST /sdi/receive.
  Header X-Atlas-Sede / X-Atlas-Ade-Profile per tracciamento (server può ignorarli).
  """
  base = _api_base(api_base)
  tok = _token(token)
  url = f"{base}/sdi/receive"
  headers = {
    "Content-Type": "application/xml; charset=utf-8",
    "User-Agent": "atlas-ade-agent/1.0",
    "X-Atlas-Filename": filename[:200],
  }
  if sede:
    headers["X-Atlas-Sede"] = sede[:80]
  if profile_id:
    headers["X-Atlas-Ade-Profile"] = profile_id[:80]
  if tok:
    headers["Authorization"] = f"Bearer {tok}"

  req = urllib.request.Request(url, data=file_bytes, method="POST", headers=headers)
  try:
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
      body = resp.read().decode("utf-8", errors="replace")
      try:
        parsed = json.loads(body)
      except Exception:
        parsed = {"raw": body}
      return {"ok": True, "status": getattr(resp, "status", 200), "result": parsed}
  except urllib.error.HTTPError as e:
    err = e.read().decode("utf-8", errors="replace")
    try:
      detail = json.loads(err)
    except Exception:
      detail = {"detail": err}
    return {"ok": False, "status": e.code, "result": detail}
  except Exception as e:
    return {"ok": False, "status": 0, "result": {"detail": str(e)}}


def assign_sdi_section(
  invoice_id: int,
  section: str,
  *,
  api_base: Optional[str] = None,
  token: Optional[str] = None,
  timeout_sec: int = 60,
) -> Dict[str, Any]:
  """POST /sdi/invoices/assign?invoice_id=&section= (mediazione|via_lattea|risacca|pg|non_classificata)."""
  base = _api_base(api_base)
  tok = _token(token)
  q = urllib.parse.urlencode({"invoice_id": int(invoice_id), "section": section})
  url = f"{base}/sdi/invoices/assign?{q}"
  headers = {"User-Agent": "atlas-ade-agent/1.0"}
  if tok:
    headers["Authorization"] = f"Bearer {tok}"
  req = urllib.request.Request(url, data=b"", method="POST", headers=headers)
  try:
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
      body = resp.read().decode("utf-8", errors="replace")
      try:
        parsed = json.loads(body)
      except Exception:
        parsed = {"raw": body}
      return {"ok": True, "status": getattr(resp, "status", 200), "result": parsed}
  except Exception as e:
    return {"ok": False, "status": 0, "result": {"detail": str(e)}}
