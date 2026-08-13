"""
Canale SDI / Agenzia delle Entrate (senza intermediario Aruba).

- POST /sdi/receive — ingest push XML FatturaPA
- POST /sdi/soap/RicezioneFatture — SdICoop locale (RiceviFatture + NotificaDecorrenzaTermini)
- GET  /sdi/soap/RicezioneFatture?wsdl — WSDL locale di test
- GET  /sdi/invoices/received — elenco inbox
- POST /sdi/invoices/assign — assegnazione sezione
- GET  /sdi/invoices/{id}/download — scarica XML
- GET  /sdi/status — stato canale
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..integrations.sdi.soap_ricezione import local_wsdl_xml, process_soap_request
from ..models.sdi_invoice import SdiInvoice
from ..services.sdi_ingest_service import ingest_fatturapa_bytes


router = APIRouter(prefix="/sdi", tags=["sdi"])

_ASSIGN_LOCK = threading.Lock()
_UPLOADS = Path(__file__).resolve().parent.parent / "uploads"
_ASSIGNMENTS_PATH = _UPLOADS / "sdi_manual_assignments.json"


def _env(name: str, default: str = "") -> str:
  return os.getenv(name, default).strip()


def _optional_bearer(expected: Optional[str], authorization: Optional[str]) -> None:
  if not expected:
    return
  if not authorization or authorization.strip() != f"Bearer {expected}":
    raise HTTPException(status_code=401, detail="Token SDI mancante o non valido")


def _keyword_list(name: str, default: str) -> List[str]:
  raw = _env(name, default)
  return [k.strip().lower() for k in raw.split(",") if k.strip()]


def _pick_section(destination: str) -> str:
  dest = (destination or "").lower()
  abba = _keyword_list("SDI_DEST_ABBA_KEYWORDS", "abba,via abba")
  zan = _keyword_list("SDI_DEST_ZANARDELLI_KEYWORDS", "zanardelli,via zanardelli")
  if any(k in dest for k in abba):
    return "abba"
  if any(k in dest for k in zan):
    return "zanardelli"
  return "non_classificata"


def _read_manual_assignments() -> Dict[str, str]:
  if not _ASSIGNMENTS_PATH.exists():
    return {}
  try:
    data = json.loads(_ASSIGNMENTS_PATH.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}
  except Exception:
    return {}


def _write_manual_assignments(data: Dict[str, str]) -> None:
  _ASSIGNMENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
  _ASSIGNMENTS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _resolve_storage_path(rel: str) -> Path:
  path = (_UPLOADS / str(rel or "").replace("\\", "/")).resolve()
  uploads_root = _UPLOADS.resolve()
  if uploads_root not in path.parents and path != uploads_root:
    raise HTTPException(status_code=400, detail="Percorso file non valido")
  if not path.is_file():
    raise HTTPException(status_code=404, detail="XML non trovato su disco")
  return path


def _row_to_item(row: SdiInvoice, manual: Dict[str, str]) -> Dict[str, Any]:
  auto_section = _pick_section(row.destination or "")
  key = str(row.id)
  section = manual.get(key, auto_section)
  return {
    "id": row.id,
    "filename": Path(row.storage_path or "").name or f"sdi-{row.id}.xml",
    "invoice_number": row.invoice_number or "",
    "invoice_date": row.invoice_date.isoformat() if row.invoice_date else None,
    "supplier_name": row.supplier_name or "",
    "supplier_vat": row.supplier_vat or "",
    "destination": row.destination or "",
    "receiver_code": row.receiver_code or "",
    "section": section,
    "auto_section": auto_section,
    "manual_section": manual.get(key),
    "source": row.source or "push",
    "sdi_message_id": row.sdi_message_id,
    "pipeline_status": row.pipeline_status,
    "electronic_invoice_id": row.electronic_invoice_id,
    "created_at": row.created_at.isoformat() if row.created_at else None,
  }


@router.get("/status")
def sdi_status() -> Dict[str, Any]:
  token_set = bool(_env("SDI_RECEIVE_TOKEN"))
  return {
    "channel": "agenzia_entrate_sdi",
    "intermediary": None,
    "receive_token_configured": token_set,
    "receive_endpoint": "/sdi/receive",
    "soap_ricezione_endpoint": "/sdi/soap/RicezioneFatture",
    "soap_ricezione_wsdl": "/sdi/soap/RicezioneFatture?wsdl",
    "soap_operations": ["RiceviFatture", "NotificaDecorrenzaTermini"],
    "dest_abba_keywords": _keyword_list("SDI_DEST_ABBA_KEYWORDS", "abba,via abba"),
    "dest_zanardelli_keywords": _keyword_list("SDI_DEST_ZANARDELLI_KEYWORDS", "zanardelli,via zanardelli"),
    "notes": (
      "Inbox locale + server SOAP RicezioneFatture di test (senza accreditamento SdICoop). "
      "Bridge applicativo: SdiInvoice → ElectronicInvoice → Invoice."
    ),
  }


@router.post("/receive")
async def sdi_receive(
  request: Request,
  db: Session = Depends(get_db),
  authorization: Optional[str] = Header(None),
  x_sdi_message_id: Optional[str] = Header(None, alias="X-SDI-Message-Id"),
) -> Dict[str, Any]:
  _optional_bearer(_env("SDI_RECEIVE_TOKEN") or None, authorization)

  body = await request.body()
  if not body:
    raise HTTPException(status_code=400, detail="Corpo vuoto")

  try:
    return ingest_fatturapa_bytes(
      db,
      body,
      sdi_message_id=(x_sdi_message_id or "").strip() or None,
      source="push",
    )
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e)) from e


@router.api_route("/soap/RicezioneFatture", methods=["GET", "POST"])
async def soap_ricezione_fatture(
  request: Request,
  db: Session = Depends(get_db),
  wsdl: Optional[int] = Query(default=None),
):
  """
  Endpoint SOAP locale SdICoop RicezioneFatture.
  GET ?wsdl → WSDL di test
  POST → RiceviFatture | NotificaDecorrenzaTermini
  """
  if request.method == "GET" or wsdl is not None:
    # location assoluta se possibile
    base = str(request.base_url).rstrip("/")
    endpoint = f"{base}/sdi/soap/RicezioneFatture"
    return Response(
      content=local_wsdl_xml(endpoint),
      media_type="text/xml; charset=utf-8",
    )

  raw = await request.body()
  soap_action = request.headers.get("SOAPAction") or request.headers.get("soapaction")
  soap_xml, status, info = process_soap_request(db, raw, soap_action=soap_action)
  # header debug opzionale (utile in locale)
  headers = {
    "X-Atlas-Sdi-Operation": str(info.get("operazione") or ""),
    "X-Atlas-Sdi-Invoice-Id": str(info.get("id") or ""),
    "X-Atlas-Electronic-Invoice-Id": str(info.get("electronic_invoice_id") or ""),
  }
  return Response(
    content=soap_xml,
    status_code=status,
    media_type="text/xml; charset=utf-8",
    headers={k: v for k, v in headers.items() if v},
  )


@router.get("/invoices/received")
def list_sdi_received_invoices(
  days: int = Query(default=60, ge=1, le=365),
  db: Session = Depends(get_db),
) -> Dict[str, Any]:
  since = datetime.now(timezone.utc) - timedelta(days=days)
  since_date = since.date()
  rows = (
    db.query(SdiInvoice)
    .order_by(SdiInvoice.created_at.desc(), SdiInvoice.id.desc())
    .limit(2000)
    .all()
  )
  manual = _read_manual_assignments()
  abba: List[Dict[str, Any]] = []
  zanardelli: List[Dict[str, Any]] = []
  non_classificata: List[Dict[str, Any]] = []

  for row in rows:
    inv_date = row.invoice_date
    created = row.created_at
    if inv_date is not None:
      if inv_date < since_date:
        continue
    elif created is not None:
      aware = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
      if aware < since:
        continue
    else:
      continue

    item = _row_to_item(row, manual)
    section = item["section"]
    if section == "abba":
      abba.append(item)
    elif section == "zanardelli":
      zanardelli.append(item)
    else:
      non_classificata.append(item)

  return {
    "abba": abba,
    "zanardelli": zanardelli,
    "non_classificata": non_classificata,
    "days": days,
    "count": len(abba) + len(zanardelli) + len(non_classificata),
    "channel": "agenzia_entrate_sdi",
  }


@router.post("/invoices/assign")
def assign_sdi_invoice_section(
  invoice_id: int = Query(..., ge=1),
  section: str = Query(...),
  db: Session = Depends(get_db),
) -> Dict[str, Any]:
  section_norm = (section or "").strip().lower()
  if section_norm not in {"abba", "zanardelli", "non_classificata"}:
    raise HTTPException(status_code=400, detail="section non valida")
  row = db.query(SdiInvoice).filter(SdiInvoice.id == invoice_id).first()
  if not row:
    raise HTTPException(status_code=404, detail="Fattura SDI non trovata")
  with _ASSIGN_LOCK:
    data = _read_manual_assignments()
    data[str(invoice_id)] = section_norm
    _write_manual_assignments(data)
  return {"ok": True, "id": invoice_id, "section": section_norm}


@router.get("/invoices/{invoice_id}/download")
def download_sdi_invoice(invoice_id: int, db: Session = Depends(get_db)) -> Response:
  row = db.query(SdiInvoice).filter(SdiInvoice.id == invoice_id).first()
  if not row:
    raise HTTPException(status_code=404, detail="Fattura SDI non trovata")
  path = _resolve_storage_path(row.storage_path)
  content = path.read_bytes()
  filename = Path(row.storage_path).name or f"sdi-{invoice_id}.xml"
  return Response(
    content=content,
    media_type="application/xml",
    headers={"Content-Disposition": f'attachment; filename="{filename}"'},
  )
