"""Push XML/ZIP FatturaPA verso Atlas + assegnazione sezione sede."""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Dict, Optional


def _api_base(api_base: Optional[str] = None) -> str:
  return (api_base or os.getenv("ATLAS_API_BASE") or "https://www.atlass.it/api").rstrip("/")


def _token(token: Optional[str] = None) -> str:
  return (token if token is not None else os.getenv("SDI_RECEIVE_TOKEN") or "").strip()


def _vat_digits(value: str) -> str:
  return re.sub(r"\D+", "", value or "")


def detect_invoice_direction(xml_bytes: bytes, our_vat: str) -> str:
  """Ritorna 'emessa' se Cedente ≈ nostra P.IVA, altrimenti 'ricevuta'."""
  our = _vat_digits(our_vat)
  if not our or len(our) < 11:
    return "ricevuta"
  try:
    text = xml_bytes.decode("utf-8", errors="replace")
  except Exception:
    return "ricevuta"
  m = re.search(
    r"<CedentePrestatore>[\s\S]*?<IdFiscaleIVA>[\s\S]*?<IdCodice>\s*([^<]+)\s*</IdCodice>",
    text,
    re.I,
  )
  cedente = _vat_digits(m.group(1) if m else "")
  if cedente and (cedente == our or cedente.endswith(our) or our.endswith(cedente)):
    return "emessa"
  return "ricevuta"


def issued_company_for_profile(
  *,
  profile_id: str,
  sdi_section: Optional[str],
  auto_section: bool,
  xml_bytes: bytes,
) -> str:
  if sdi_section:
    return sdi_section
  pid = (profile_id or "").strip().lower()
  if pid in ("via_lattea", "risacca", "pg"):
    return pid
  try:
    low = xml_bytes.decode("utf-8", errors="replace").lower()
  except Exception:
    low = ""
  if "zanardelli" in low:
    return "mediazione_z"
  if "abba" in low:
    return "mediazione_a"
  if auto_section or pid == "mediazione":
    return "mediazione_a"
  return pid or "mediazione_a"


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


def push_issued_xml(
  file_bytes: bytes,
  *,
  filename: str = "fattura.xml",
  company: str,
  api_base: Optional[str] = None,
  token: Optional[str] = None,
  timeout_sec: int = 120,
) -> Dict[str, Any]:
  """Invia XML fattura emessa a POST /invoices/emesse/upload (multipart)."""
  base = _api_base(api_base)
  tok = _token(token)
  url = f"{base}/invoices/emesse/upload"
  boundary = f"----AtlasAde{uuid.uuid4().hex}"
  fname = (filename or "fattura.xml").replace('"', "")
  company_safe = (company or "").strip()

  parts: list[bytes] = []
  parts.append(
    (
      f"--{boundary}\r\n"
      f'Content-Disposition: form-data; name="company"\r\n\r\n'
      f"{company_safe}\r\n"
    ).encode("utf-8")
  )
  parts.append(
    (
      f"--{boundary}\r\n"
      f'Content-Disposition: form-data; name="file_kind"\r\n\r\n'
      f"xml\r\n"
    ).encode("utf-8")
  )
  parts.append(
    (
      f"--{boundary}\r\n"
      f'Content-Disposition: form-data; name="file"; filename="{fname}"\r\n'
      f"Content-Type: application/xml\r\n\r\n"
    ).encode("utf-8")
    + file_bytes
    + b"\r\n"
  )
  parts.append(f"--{boundary}--\r\n".encode("utf-8"))
  body = b"".join(parts)

  headers = {
    "Content-Type": f"multipart/form-data; boundary={boundary}",
    "User-Agent": "atlas-ade-agent/1.0",
  }
  if tok:
    headers["Authorization"] = f"Bearer {tok}"

  req = urllib.request.Request(url, data=body, method="POST", headers=headers)
  try:
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
      raw = resp.read().decode("utf-8", errors="replace")
      try:
        parsed = json.loads(raw)
      except Exception:
        parsed = {"raw": raw}
      return {"ok": True, "status": getattr(resp, "status", 200), "result": parsed, "channel": "emesse"}
  except urllib.error.HTTPError as e:
    err = e.read().decode("utf-8", errors="replace")
    try:
      detail = json.loads(err)
    except Exception:
      detail = {"detail": err}
    return {"ok": False, "status": e.code, "result": detail, "channel": "emesse"}
  except Exception as e:
    return {"ok": False, "status": 0, "result": {"detail": str(e)}, "channel": "emesse"}


def assign_sdi_section(
  invoice_id: int,
  section: str,
  *,
  api_base: Optional[str] = None,
  token: Optional[str] = None,
  timeout_sec: int = 60,
) -> Dict[str, Any]:
  """POST /sdi/invoices/assign?invoice_id=&section= (mediazione_a|mediazione_z|via_lattea|risacca|pg|non_classificata)."""
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
