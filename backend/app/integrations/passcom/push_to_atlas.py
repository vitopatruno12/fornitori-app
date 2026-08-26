"""Push XML/ZIP FatturaPA verso Atlas POST /sdi/receive."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, Optional


def push_xml_bytes(
  file_bytes: bytes,
  *,
  filename: str = "fattura.xml",
  api_base: Optional[str] = None,
  token: Optional[str] = None,
  timeout_sec: int = 120,
) -> Dict[str, Any]:
  """
  Invia raw XML/ZIP a Atlas.
  Riusa SDI_RECEIVE_TOKEN come Bearer (stesso canale della UI Sincronizzazione).
  """
  base = (api_base or os.getenv("ATLAS_API_BASE") or "https://www.atlass.it/api").rstrip("/")
  tok = (token if token is not None else os.getenv("SDI_RECEIVE_TOKEN") or "").strip()
  url = f"{base}/sdi/receive"
  headers = {
    "Content-Type": "application/xml; charset=utf-8",
    "User-Agent": "atlas-passcom-agent/1.0",
    "X-Atlas-Filename": filename[:200],
  }
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
