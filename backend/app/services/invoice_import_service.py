"""
Import XML FatturaPA:
  hash → deduplica → parse → fornitore → ElectronicInvoice → IncomingInvoice + righe
  (+ specchio su Invoice Atlas per UI fatture registrate).
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.electronic_invoice import ElectronicInvoice, IncomingInvoice, IncomingInvoiceLine
from ..models.invoice import Invoice
from ..models.invoice_row import InvoiceRow
from ..models.supplier import Supplier
from .invoice_parser import InvoiceParser
from .invoice_service import sync_invoice_paid_flag

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads" / "electronic_invoices"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _sha256(xml: str | bytes) -> str:
  if isinstance(xml, str):
    data = xml.encode("utf-8")
  else:
    data = xml
  return hashlib.sha256(data).hexdigest()


def normalize_vat(value: Optional[str]) -> str:
  """Normalizza P.IVA per confronto (solo cifre, senza prefisso IT)."""
  if not value:
    return ""
  s = re.sub(r"[^0-9A-Za-z]", "", str(value).upper())
  if s.startswith("IT") and len(s) > 2:
    s = s[2:]
  return s


def _vat_lookup_variants(vat: str) -> list[str]:
  digits = normalize_vat(vat)
  if not digits:
    return []
  variants = {digits, f"IT{digits}", vat.strip()}
  return [v for v in variants if v]


class InvoiceImportService:
  """Orchestrazione import: XML → DB (senza SdI)."""

  def __init__(self, db: Session, parser: Optional[InvoiceParser] = None):
    self.db = db
    self.parser = parser or InvoiceParser()

  def import_xml(self, xml_content: str, filename: Optional[str] = None) -> Dict[str, Any]:
    if not xml_content or not str(xml_content).strip():
      raise ValueError("XML vuoto")

    xml_text = str(xml_content)

    # 1. hash
    document_hash = _sha256(xml_text)

    # 2. duplicato
    existing = self._find_electronic_invoice(document_hash)
    if existing:
      return self._duplicate_result(existing)

    # 3. parse
    data = self.parser.parse(xml_text)
    doc = data["document"]
    supplier_data = data["supplier"]
    customer_data = data["customer"]
    taxable = data["taxable_amount"]
    vat_amt = data["vat_amount"]
    total = doc["total_amount"]
    if total is None:
      total = taxable + vat_amt

    # 4. supplier (cerca per P.IVA; crea se assente)
    supplier, supplier_created = self.find_or_create_supplier(
      vat=supplier_data.get("vat"),
      name=supplier_data.get("name"),
      fiscal_code=supplier_data.get("fiscal_code"),
    )

    # 5. ElectronicInvoice
    electronic = ElectronicInvoice(
      filename=filename,
      xml_content=xml_text,
      document_hash=document_hash,
      document_type=doc.get("type"),
      invoice_number=doc.get("number"),
      invoice_date=doc.get("date"),
      currency=doc.get("currency") or "EUR",
      supplier_vat=supplier_data.get("vat") or supplier_data.get("fiscal_code"),
      customer_vat=customer_data.get("vat"),
      total_amount=total,
      taxable_amount=taxable,
      vat_amount=vat_amt,
      status="PARSED",
    )
    self.db.add(electronic)
    self.db.flush()

    # 6. IncomingInvoice
    inv_date = doc["date"]
    inv_dt = datetime(inv_date.year, inv_date.month, inv_date.day, tzinfo=timezone.utc)

    incoming = IncomingInvoice(
      electronic_invoice_id=electronic.id,
      supplier_id=supplier.id,
      invoice_number=str(doc["number"]),
      invoice_date=inv_dt,
      taxable_amount=taxable,
      vat_amount=vat_amt,
      total_amount=total,
      currency=doc.get("currency") or "EUR",
      status="IMPORTED",
    )
    self.db.add(incoming)
    self.db.flush()

    # 7. righe
    for line in data["lines"]:
      self.db.add(
        IncomingInvoiceLine(
          invoice_id=incoming.id,
          line_number=int(line.get("line_number") or 0),
          description=line.get("description"),
          quantity=line.get("quantity"),
          unit_price=line.get("unit_price"),
          line_total=line.get("line_total"),
          vat_rate=line.get("vat_rate"),
        )
      )
    self.db.flush()

    # 8. registrazione gestionale (Invoice + InvoiceRow)
    registered = self.create_atlas_invoice_from_incoming(incoming.id)
    atlas_invoice_id = registered["atlas_invoice_id"]

    # 9. commit
    try:
      self.db.commit()
    except IntegrityError:
      self.db.rollback()
      existing = self._find_electronic_invoice(document_hash)
      if existing:
        return self._duplicate_result(existing)
      raise

    self.db.refresh(electronic)
    self.db.refresh(incoming)
    lines = (
      self.db.query(IncomingInvoiceLine)
      .filter(IncomingInvoiceLine.invoice_id == incoming.id)
      .order_by(IncomingInvoiceLine.line_number.asc())
      .all()
    )

    return {
      "ok": True,
      "duplicated": False,
      "supplier_created": supplier_created,
      "supplier": {
        "id": supplier.id,
        "name": supplier.name,
        "vat_number": supplier.vat_number,
      },
      "electronic_invoice": _electronic_out(electronic),
      "incoming_invoice": _incoming_out(incoming, lines, supplier),
      "atlas_invoice_id": atlas_invoice_id,
    }

  def create_atlas_invoice_from_incoming(
    self,
    incoming_id: int,
  ) -> Dict[str, Any]:
    incoming = (
      self.db.query(IncomingInvoice)
      .filter(IncomingInvoice.id == incoming_id)
      .first()
    )

    if not incoming:
      raise ValueError(f"IncomingInvoice {incoming_id} non trovata")

    # Evita doppia registrazione
    if incoming.atlas_invoice_id is not None:
      return {
        "status": "ALREADY_REGISTERED",
        "incoming_invoice_id": incoming.id,
        "atlas_invoice_id": incoming.atlas_invoice_id,
      }

    electronic = (
      self.db.query(ElectronicInvoice)
      .filter(ElectronicInvoice.id == incoming.electronic_invoice_id)
      .first()
    )

    if not electronic:
      raise ValueError("ElectronicInvoice collegata non trovata")

    supplier = None
    if incoming.supplier_id:
      supplier = (
        self.db.query(Supplier)
        .filter(Supplier.id == incoming.supplier_id)
        .first()
      )

    if not supplier:
      raise ValueError("Fornitore della fattura non trovato")

    lines = (
      self.db.query(IncomingInvoiceLine)
      .filter(IncomingInvoiceLine.invoice_id == incoming.id)
      .order_by(IncomingInvoiceLine.line_number.asc())
      .all()
    )

    if not lines:
      raise ValueError("La fattura non contiene righe")

    # ---------------------------------------------------------
    # Aliquota documento
    # ---------------------------------------------------------
    vat_rates = [line.vat_rate for line in lines if line.vat_rate is not None]
    vat_rate = vat_rates[0] if vat_rates else Decimal("0")

    # ---------------------------------------------------------
    # XML su disco
    # ---------------------------------------------------------
    document_hash = electronic.document_hash
    safe_name = electronic.filename or f"{document_hash[:16]}.xml"
    safe_name = re.sub(r"[^\w.\-]+", "_", safe_name)[:180]
    dest = UPLOAD_DIR / f"{electronic.id}_{safe_name}"
    dest.write_text(electronic.xml_content, encoding="utf-8")
    rel_path = str(dest.relative_to(UPLOAD_DIR.parent.parent)).replace("\\", "/")

    # ---------------------------------------------------------
    # Invoice Atlas
    # ---------------------------------------------------------
    atlas_inv = Invoice(
      supplier_id=supplier.id,
      invoice_number=str(incoming.invoice_number),
      invoice_date=incoming.invoice_date,
      imponibile=Decimal(incoming.taxable_amount).quantize(Decimal("0.01")),
      vat_percent=Decimal(vat_rate).quantize(Decimal("0.01")),
      vat_amount=Decimal(incoming.vat_amount).quantize(Decimal("0.01")),
      total=Decimal(incoming.total_amount).quantize(Decimal("0.01")),
      file_path=rel_path,
      note=(
        f"Import XML FatturaPA "
        f"({electronic.document_type or 'TD'}) "
        f"· hash {document_hash[:12]}"
      ),
      amount_paid=Decimal("0"),
      ignored=False,
      is_paid=False,
    )
    sync_invoice_paid_flag(atlas_inv)
    self.db.add(atlas_inv)
    self.db.flush()

    # ---------------------------------------------------------
    # InvoiceRow
    # ---------------------------------------------------------
    for line in lines:
      line_imponibile = (
        Decimal(line.line_total) if line.line_total is not None else Decimal("0")
      )
      line_vat_rate = (
        Decimal(line.vat_rate) if line.vat_rate is not None else Decimal(vat_rate)
      )
      line_vat = (line_imponibile * line_vat_rate / Decimal("100")).quantize(Decimal("0.01"))
      line_total = (line_imponibile + line_vat).quantize(Decimal("0.01"))

      self.db.add(
        InvoiceRow(
          invoice_id=atlas_inv.id,
          line_no=int(line.line_number or 1),
          description=(line.description or "")[:500] or None,
          quantity=line.quantity,
          unit_price=(
            Decimal(line.unit_price).quantize(Decimal("0.01"))
            if line.unit_price is not None
            else None
          ),
          vat_percent=line_vat_rate.quantize(Decimal("0.01")),
          imponibile=line_imponibile.quantize(Decimal("0.01")),
          vat_amount=line_vat,
          total_line=line_total,
        )
      )

    # ---------------------------------------------------------
    # Collegamento
    # ---------------------------------------------------------
    incoming.atlas_invoice_id = atlas_inv.id
    incoming.status = "REGISTERED"
    electronic.status = "PARSED"
    self.db.flush()

    return {
      "status": "REGISTERED",
      "incoming_invoice_id": incoming.id,
      "atlas_invoice_id": atlas_inv.id,
    }

  def _find_electronic_invoice(self, document_hash: str) -> Optional[ElectronicInvoice]:
    return (
      self.db.query(ElectronicInvoice)
      .filter(ElectronicInvoice.document_hash == document_hash)
      .first()
    )

  def find_supplier_by_vat(self, vat: Optional[str]) -> Optional[Supplier]:
    digits = normalize_vat(vat)
    if not digits:
      return None
    for candidate in _vat_lookup_variants(vat or ""):
      supplier = self.db.query(Supplier).filter(Supplier.vat_number == candidate).first()
      if supplier:
        return supplier
    rows = self.db.query(Supplier).filter(Supplier.vat_number.isnot(None)).all()
    for row in rows:
      if normalize_vat(row.vat_number) == digits:
        return row
    return None

  def find_or_create_supplier(
    self,
    *,
    vat: Optional[str],
    name: Optional[str],
    fiscal_code: Optional[str],
  ) -> Tuple[Supplier, bool]:
    supplier = self.find_supplier_by_vat(vat)
    if supplier:
      if name and (not supplier.name or supplier.name.strip().upper() != name.strip().upper()):
        if not supplier.name or len(name) > len(supplier.name or ""):
          supplier.name = name.strip()
      if fiscal_code and not supplier.fiscal_code:
        supplier.fiscal_code = fiscal_code
      self.db.flush()
      return supplier, False

    digits = normalize_vat(vat)
    display_name = (name or "").strip() or f"Fornitore {digits or 'XML'}"
    supplier = Supplier(
      name=display_name,
      vat_number=digits or None,
      fiscal_code=fiscal_code or None,
      is_active=True,
      notes="Creato da import XML FatturaPA",
    )
    self.db.add(supplier)
    self.db.flush()
    return supplier, True

  def _duplicate_result(self, existing: ElectronicInvoice) -> Dict[str, Any]:
    incoming = (
      self.db.query(IncomingInvoice)
      .filter(IncomingInvoice.electronic_invoice_id == existing.id)
      .first()
    )
    lines: list[IncomingInvoiceLine] = []
    supplier = None
    if incoming:
      lines = (
        self.db.query(IncomingInvoiceLine)
        .filter(IncomingInvoiceLine.invoice_id == incoming.id)
        .order_by(IncomingInvoiceLine.line_number.asc())
        .all()
      )
      if incoming.supplier_id:
        supplier = self.db.query(Supplier).filter(Supplier.id == incoming.supplier_id).first()
    return {
      "ok": True,
      "duplicated": True,
      "electronic_invoice": _electronic_out(existing),
      "incoming_invoice": _incoming_out(incoming, lines, supplier) if incoming else None,
    }


def _electronic_out(row: ElectronicInvoice) -> Dict[str, Any]:
  return {
    "id": row.id,
    "filename": row.filename,
    "document_hash": row.document_hash,
    "document_type": row.document_type,
    "invoice_number": row.invoice_number,
    "invoice_date": row.invoice_date.isoformat() if row.invoice_date else None,
    "currency": row.currency,
    "supplier_vat": row.supplier_vat,
    "customer_vat": row.customer_vat,
    "total_amount": float(row.total_amount) if row.total_amount is not None else None,
    "taxable_amount": float(row.taxable_amount) if row.taxable_amount is not None else None,
    "vat_amount": float(row.vat_amount) if row.vat_amount is not None else None,
    "status": row.status,
    "error_message": row.error_message,
    "created_at": row.created_at.isoformat() if row.created_at else None,
  }


def _incoming_out(row: IncomingInvoice, lines: list[IncomingInvoiceLine], supplier: Optional[Supplier]) -> Dict[str, Any]:
  return {
    "id": row.id,
    "electronic_invoice_id": row.electronic_invoice_id,
    "supplier_id": row.supplier_id,
    "supplier_name": supplier.name if supplier else None,
    "supplier_vat": supplier.vat_number if supplier else None,
    "atlas_invoice_id": row.atlas_invoice_id,
    "invoice_number": row.invoice_number,
    "invoice_date": row.invoice_date.isoformat() if row.invoice_date else None,
    "taxable_amount": float(row.taxable_amount),
    "vat_amount": float(row.vat_amount),
    "total_amount": float(row.total_amount),
    "currency": row.currency,
    "status": row.status,
    "lines": [
      {
        "id": ln.id,
        "line_number": ln.line_number,
        "description": ln.description,
        "quantity": float(ln.quantity) if ln.quantity is not None else None,
        "unit_price": float(ln.unit_price) if ln.unit_price is not None else None,
        "line_total": float(ln.line_total) if ln.line_total is not None else None,
        "vat_rate": float(ln.vat_rate) if ln.vat_rate is not None else None,
      }
      for ln in lines
    ],
  }


# Compatibilità router / chiamate modulo
def import_xml(db: Session, xml: str, filename: Optional[str] = None) -> Dict[str, Any]:
  return InvoiceImportService(db).import_xml(xml, filename=filename)


def find_or_create_supplier(
  db: Session,
  *,
  vat: Optional[str],
  name: Optional[str],
  fiscal_code: Optional[str],
) -> Tuple[Supplier, bool]:
  return InvoiceImportService(db).find_or_create_supplier(vat=vat, name=name, fiscal_code=fiscal_code)
