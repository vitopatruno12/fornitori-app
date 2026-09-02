"""
Canale SDI / Agenzia delle Entrate (senza intermediario Aruba).

- POST /sdi/receive — ingest push XML FatturaPA
- POST /sdi/soap/RicezioneFatture — SdICoop locale (RiceviFatture + NotificaDecorrenzaTermini)
- GET  /sdi/soap/RicezioneFatture?wsdl — WSDL locale di test
- GET  /sdi/companies — elenco società destinatario
- GET  /sdi/invoices/received — elenco inbox per società
- POST /sdi/invoices/assign — assegnazione società
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

from ..constants.sdi_companies import (
  SDI_COMPANY_LABELS,
  SDI_COMPANY_ORDER,
  company_label,
  list_companies,
  normalize_company_section,
  pick_company,
  valid_assign_sections,
)
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


def _legacy_destination_section(destination: str) -> str:
  """Classificazione legacy per indirizzo (Abba / Zanardelli → Mediazione)."""
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


def _auto_company(row: SdiInvoice) -> str:
  legacy = _legacy_destination_section(row.destination or "")
  return pick_company(
    receiver_vat=row.receiver_vat,
    ade_profile_id=row.ade_profile_id,
    legacy_destination_section=legacy,
  )


def _row_to_item(row: SdiInvoice, manual: Dict[str, str]) -> Dict[str, Any]:
  auto_company = _auto_company(row)
  key = str(row.id)
  manual_raw = manual.get(key)
  company = normalize_company_section(manual_raw) if manual_raw else auto_company
  return {
    "id": row.id,
    "filename": Path(row.storage_path or "").name or f"sdi-{row.id}.xml",
    "invoice_number": row.invoice_number or "",
    "invoice_date": row.invoice_date.isoformat() if row.invoice_date else None,
    "supplier_name": row.supplier_name or "",
    "supplier_vat": row.supplier_vat or "",
    "destination": row.destination or "",
    "receiver_code": row.receiver_code or "",
    "receiver_vat": row.receiver_vat or "",
    "ade_profile_id": row.ade_profile_id or "",
    "company": company,
    "company_label": company_label(company),
    "section": company,
    "auto_section": auto_company,
    "auto_company": auto_company,
    "manual_section": normalize_company_section(manual_raw) if manual_raw else None,
    "manual_company": normalize_company_section(manual_raw) if manual_raw else None,
    "source": row.source or "push",
    "sdi_message_id": row.sdi_message_id,
    "pipeline_status": row.pipeline_status,
    "electronic_invoice_id": row.electronic_invoice_id,
    "created_at": row.created_at.isoformat() if row.created_at else None,
  }


def _empty_company_buckets() -> Dict[str, List[Dict[str, Any]]]:
  return {cid: [] for cid in SDI_COMPANY_ORDER} | {"non_classificata": []}


@router.get("/companies")
def sdi_companies() -> Dict[str, Any]:
  companies = list_companies()
  return {
    "companies": companies,
    "labels": dict(SDI_COMPANY_LABELS),
    "order": list(SDI_COMPANY_ORDER),
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
    "companies": list_companies(),
    "dest_abba_keywords": _keyword_list("SDI_DEST_ABBA_KEYWORDS", "abba,via abba"),
    "dest_zanardelli_keywords": _keyword_list("SDI_DEST_ZANARDELLI_KEYWORDS", "zanardelli,via zanardelli"),
    "notes": (
      "Inbox locale + server SOAP RicezioneFatture di test (senza accreditamento SdICoop). "
      "Classificazione per P.IVA destinatario (Mediazione, Via Lattea, Risacca, PG)."
    ),
  }


@router.post("/receive")
async def sdi_receive(
  request: Request,
  db: Session = Depends(get_db),
  authorization: Optional[str] = Header(None),
  x_sdi_message_id: Optional[str] = Header(None, alias="X-SDI-Message-Id"),
  x_atlas_ade_profile: Optional[str] = Header(None, alias="X-Atlas-Ade-Profile"),
  x_atlas_sede: Optional[str] = Header(None, alias="X-Atlas-Sede"),
) -> Dict[str, Any]:
  _optional_bearer(_env("SDI_RECEIVE_TOKEN") or None, authorization)

  body = await request.body()
  if not body:
    raise HTTPException(status_code=400, detail="Corpo vuoto")

  profile_id = (x_atlas_ade_profile or "").strip()
  if not profile_id and x_atlas_sede:
    profile_id = (x_atlas_sede or "").strip()

  try:
    return ingest_fatturapa_bytes(
      db,
      body,
      sdi_message_id=(x_sdi_message_id or "").strip() or None,
      source="push",
      ade_profile_id=profile_id or None,
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
    base = str(request.base_url).rstrip("/")
    endpoint = f"{base}/sdi/soap/RicezioneFatture"
    return Response(
      content=local_wsdl_xml(endpoint),
      media_type="text/xml; charset=utf-8",
    )

  raw = await request.body()
  soap_action = request.headers.get("SOAPAction") or request.headers.get("soapaction")
  soap_xml, status, info = process_soap_request(db, raw, soap_action=soap_action)
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
  company: Optional[str] = Query(default=None, description="Filtra per società (mediazione|via_lattea|risacca|pg)"),
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
  buckets = _empty_company_buckets()
  legacy_abba: List[Dict[str, Any]] = []
  legacy_zanardelli: List[Dict[str, Any]] = []
  company_filter = normalize_company_section(company) if company else None
  if company_filter == "non_classificata" and company:
    company_filter = None

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
    cid = item["company"]
    if cid in buckets:
      buckets[cid].append(item)
    else:
      buckets["non_classificata"].append(item)

    legacy = _legacy_destination_section(row.destination or "")
    if legacy == "abba":
      legacy_abba.append(item)
    elif legacy == "zanardelli":
      legacy_zanardelli.append(item)

  count = sum(len(v) for v in buckets.values())
  payload: Dict[str, Any] = {
    "companies": buckets,
    "company_labels": {cid: SDI_COMPANY_LABELS[cid] for cid in SDI_COMPANY_ORDER},
    "non_classificata": buckets["non_classificata"],
    "abba": legacy_abba,
    "zanardelli": legacy_zanardelli,
    "days": days,
    "count": count,
    "channel": "agenzia_entrate_sdi",
  }
  if company_filter and company_filter in SDI_COMPANY_LABELS:
    payload["filtered_company"] = company_filter
    payload["items"] = buckets.get(company_filter, [])
  return payload


@router.post("/invoices/assign")
def assign_sdi_invoice_section(
  invoice_id: int = Query(..., ge=1),
  section: str = Query(...),
  db: Session = Depends(get_db),
) -> Dict[str, Any]:
  section_norm = (section or "").strip().lower()
  if section_norm not in valid_assign_sections():
    raise HTTPException(status_code=400, detail="section non valida")
  company = normalize_company_section(section_norm)
  row = db.query(SdiInvoice).filter(SdiInvoice.id == invoice_id).first()
  if not row:
    raise HTTPException(status_code=404, detail="Fattura SDI non trovata")
  with _ASSIGN_LOCK:
    data = _read_manual_assignments()
    data[str(invoice_id)] = company
    _write_manual_assignments(data)
  return {"ok": True, "id": invoice_id, "section": company, "company": company}


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
