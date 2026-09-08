"""Carica XML / PDF fattura Atlas o SDI per anteprima."""
from __future__ import annotations

from pathlib import Path
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from ..models.electronic_invoice import ElectronicInvoice, IncomingInvoice
from ..models.invoice import Invoice
from ..models.sdi_invoice import SdiInvoice
from .fatturapa_pdf import build_fatturapa_pdf_bytes, unwrap_p7m_to_xml_text

APP_ROOT = Path(__file__).resolve().parent.parent  # backend/app
UPLOADS_ROOT = APP_ROOT / "uploads"


def _resolve_uploads_relative(rel: str) -> Optional[Path]:
  raw = (rel or "").replace("\\", "/").lstrip("/")
  if not raw:
    return None
  if raw.startswith("uploads/"):
    candidate = APP_ROOT / raw
    if candidate.is_file():
      return candidate
    raw = raw[len("uploads/") :]
  candidate = UPLOADS_ROOT / raw
  if candidate.is_file():
    return candidate
  alt = UPLOADS_ROOT / Path(raw).name
  if alt.is_file():
    return alt
  return candidate if candidate.exists() else None


def load_xml_text_for_atlas_invoice(
  db: Session, invoice_id: int
) -> Tuple[Optional[str], Optional[bytes], Optional[str]]:
  """
  Restituisce (xml_text, existing_pdf_bytes, error).
  Se la fattura ha gia un PDF caricato, existing_pdf_bytes e valorizzato.
  """
  inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
  if not inv:
    return None, None, "Fattura non trovata"

  incoming = (
    db.query(IncomingInvoice)
    .filter(IncomingInvoice.atlas_invoice_id == invoice_id)
    .order_by(IncomingInvoice.id.desc())
    .first()
  )
  if incoming and incoming.electronic_invoice_id:
    electronic = (
      db.query(ElectronicInvoice)
      .filter(ElectronicInvoice.id == incoming.electronic_invoice_id)
      .first()
    )
    if electronic and electronic.xml_content and "<FatturaElettronica" in electronic.xml_content:
      return electronic.xml_content, None, None

  file_path = (inv.file_path or "").strip()
  if not file_path:
    return None, None, "Nessun file XML/PDF collegato a questa fattura"

  path = _resolve_uploads_relative(file_path)
  if path is None or not path.is_file():
    return None, None, "File fattura non trovato sul server"

  lower = path.name.lower()
  raw = path.read_bytes()
  if lower.endswith(".pdf") or raw[:5] == b"%PDF-":
    return None, raw, None

  xml_text = unwrap_p7m_to_xml_text(raw)
  if xml_text:
    return xml_text, None, None
  return None, None, "Il file collegato non e un XML FatturaPA ne un PDF"


def load_xml_text_for_sdi_invoice(db: Session, invoice_id: int) -> Tuple[Optional[str], Optional[str]]:
  row = db.query(SdiInvoice).filter(SdiInvoice.id == invoice_id).first()
  if not row:
    return None, "Fattura SDI non trovata"

  if row.electronic_invoice_id:
    electronic = (
      db.query(ElectronicInvoice)
      .filter(ElectronicInvoice.id == row.electronic_invoice_id)
      .first()
    )
    if electronic and electronic.xml_content and "<FatturaElettronica" in electronic.xml_content:
      return electronic.xml_content, None

  rel = (row.storage_path or "").strip()
  if not rel:
    return None, "Percorso XML SDI mancante"

  path = _resolve_uploads_relative(rel)
  if path is None or not path.is_file():
    return None, "File XML SDI non trovato sul server"

  xml_text = unwrap_p7m_to_xml_text(path.read_bytes())
  if not xml_text:
    return None, "File SDI non contiene XML FatturaPA"
  return xml_text, None


def pdf_bytes_for_atlas_invoice(db: Session, invoice_id: int) -> Tuple[Optional[bytes], str, Optional[str]]:
  xml_text, existing_pdf, err = load_xml_text_for_atlas_invoice(db, invoice_id)
  if existing_pdf:
    return existing_pdf, "file", None
  if err:
    return None, "", err
  try:
    pdf, source = build_fatturapa_pdf_bytes(xml_text or "")
    return pdf, source, None
  except ValueError as e:
    return None, "", str(e)
  except Exception as e:
    return None, "", f"Errore generazione PDF: {e}"


def pdf_bytes_for_sdi_invoice(db: Session, invoice_id: int) -> Tuple[Optional[bytes], str, Optional[str]]:
  xml_text, err = load_xml_text_for_sdi_invoice(db, invoice_id)
  if err:
    return None, "", err
  try:
    pdf, source = build_fatturapa_pdf_bytes(xml_text or "")
    return pdf, source, None
  except ValueError as e:
    return None, "", str(e)
  except Exception as e:
    return None, "", f"Errore generazione PDF: {e}"
