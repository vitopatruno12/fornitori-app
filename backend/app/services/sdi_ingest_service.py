"""
Ingest FatturaPA condiviso: REST /sdi/receive e SOAP RicezioneFatture.
"""
from __future__ import annotations

import hashlib
import io
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..integrations.sdi.storage import save_sdi_xml
from ..integrations.sdi.xml_parser import parse_fatturapa
from ..models.sdi_invoice import SdiInvoice
from .invoice_import_service import InvoiceImportService


def extract_invoice_xml_bytes(payload: bytes) -> bytes:
  """Accetta XML FatturaPA oppure ZIP SdI (primo .xml)."""
  if not payload:
    raise ValueError("File vuoto")
  if payload[:2] == b"PK":
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
      names = [n for n in zf.namelist() if n.lower().endswith(".xml") and not n.endswith("/")]
      if not names:
        raise ValueError("ZIP senza XML")
      return zf.read(names[0])
  return payload


def link_sdi_to_electronic(
  db: Session,
  row: SdiInvoice,
  xml_text: str,
  filename: Optional[str] = None,
) -> Dict[str, Any]:
  """SdiInvoice → import_xml → ElectronicInvoice (+ Incoming + Invoice)."""
  if row.electronic_invoice_id is not None:
    return {
      "linked": True,
      "already_linked": True,
      "electronic_invoice_id": row.electronic_invoice_id,
    }

  try:
    result = InvoiceImportService(db).import_xml(
      xml_text,
      filename=filename or Path(row.storage_path or "").name or None,
    )
  except Exception as exc:  # pylint: disable=broad-except
    row.pipeline_status = "import_error"
    row.error_message = str(exc)[:2000]
    db.commit()
    return {"linked": False, "error": str(exc)}

  electronic_id = None
  if isinstance(result, dict):
    electronic = result.get("electronic_invoice") or {}
    electronic_id = electronic.get("id")

  if electronic_id is None:
    row.pipeline_status = "import_error"
    row.error_message = "import_xml non ha restituito electronic_invoice_id"
    db.commit()
    return {"linked": False, "error": row.error_message, "import_result": result}

  row = db.query(SdiInvoice).filter(SdiInvoice.id == row.id).first() or row
  row.electronic_invoice_id = int(electronic_id)
  row.pipeline_status = "imported"
  row.error_message = None
  db.commit()
  db.refresh(row)

  return {
    "linked": True,
    "already_linked": False,
    "electronic_invoice_id": row.electronic_invoice_id,
    "incoming_invoice_id": (result.get("incoming_invoice") or {}).get("id"),
    "atlas_invoice_id": result.get("atlas_invoice_id"),
    "duplicated_electronic": bool(result.get("duplicated")),
  }


def ingest_fatturapa_bytes(
  db: Session,
  file_bytes: bytes,
  *,
  sdi_message_id: Optional[str] = None,
  filename: Optional[str] = None,
  source: str = "push",
) -> Dict[str, Any]:
  """
  Pipeline: bytes → SdiInvoice → bridge Atlas.
  Usata da REST e da SOAP RiceviFatture.
  """
  xml_bytes = extract_invoice_xml_bytes(file_bytes)
  dedupe_key = hashlib.sha256(xml_bytes).hexdigest()
  xml_text = xml_bytes.decode("utf-8", errors="replace")

  existing = db.query(SdiInvoice).filter(SdiInvoice.dedupe_key == dedupe_key).first()
  if existing:
    if sdi_message_id and not existing.sdi_message_id:
      existing.sdi_message_id = sdi_message_id
      db.commit()
      db.refresh(existing)
    link = link_sdi_to_electronic(
      db,
      existing,
      xml_text,
      filename=filename or Path(existing.storage_path or "").name or None,
    )
    return {
      "ok": True,
      "duplicate": True,
      "id": existing.id,
      "dedupe_key": dedupe_key,
      "storage_path": existing.storage_path,
      "electronic_invoice_id": existing.electronic_invoice_id or link.get("electronic_invoice_id"),
      "import": link,
      "sdi_message_id": existing.sdi_message_id,
    }

  parsed = parse_fatturapa(xml_text)
  storage_path = save_sdi_xml(xml_bytes, dedupe_key)
  filename_hint = filename or Path(storage_path).name

  row = SdiInvoice(
    dedupe_key=dedupe_key,
    sdi_message_id=(sdi_message_id or "").strip() or None,
    storage_path=storage_path,
    supplier_vat=parsed.get("supplier_vat") or None,
    supplier_name=parsed.get("supplier_name") or None,
    invoice_number=parsed.get("invoice_number") or None,
    invoice_date=parsed.get("invoice_date"),
    receiver_code=parsed.get("receiver_code") or None,
    destination=parsed.get("destination") or None,
    pipeline_status="parsed",
    source=source,
    error_message=None,
  )
  db.add(row)
  try:
    db.commit()
    db.refresh(row)
  except IntegrityError:
    db.rollback()
    existing = db.query(SdiInvoice).filter(SdiInvoice.dedupe_key == dedupe_key).first()
    if existing:
      link = link_sdi_to_electronic(
        db,
        existing,
        xml_text,
        filename=filename or Path(existing.storage_path or "").name or None,
      )
      return {
        "ok": True,
        "duplicate": True,
        "id": existing.id,
        "dedupe_key": dedupe_key,
        "storage_path": existing.storage_path,
        "electronic_invoice_id": existing.electronic_invoice_id or link.get("electronic_invoice_id"),
        "import": link,
        "sdi_message_id": existing.sdi_message_id,
      }
    raise

  link = link_sdi_to_electronic(db, row, xml_text, filename=filename_hint)
  db.refresh(row)

  return {
    "ok": True,
    "duplicate": False,
    "id": row.id,
    "dedupe_key": dedupe_key,
    "storage_path": storage_path,
    "supplier_vat": row.supplier_vat,
    "invoice_number": row.invoice_number,
    "receiver_code": row.receiver_code,
    "electronic_invoice_id": row.electronic_invoice_id,
    "import": link,
    "sdi_message_id": row.sdi_message_id,
  }
