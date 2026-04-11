from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Literal, Optional
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session

from ..models.invoice import Invoice
from ..models.supplier import Supplier
from ..schemas.invoice import InvoiceCreate, InvoiceListOut, InvoiceRead
from .vat_service import calculate_vat

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads" / "invoices"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def payment_status_label(inv: Invoice) -> Literal["paid", "unpaid", "partial"]:
  total = float(inv.total)
  paid = float(inv.amount_paid or 0)
  if paid >= total - 0.009:
    return "paid"
  if paid <= 0.009:
    return "unpaid"
  return "partial"


def sync_invoice_paid_flag(inv: Invoice) -> None:
  inv.is_paid = payment_status_label(inv) == "paid"


def list_invoices(
  db: Session,
  supplier_id: Optional[int] = None,
  due_filter: Optional[str] = None,
  include_ignored: bool = False,
) -> List[InvoiceListOut]:
  q = db.query(Invoice, Supplier.name).join(Supplier, Invoice.supplier_id == Supplier.id)
  if supplier_id is not None:
    q = q.filter(Invoice.supplier_id == supplier_id)
  if not include_ignored:
    q = q.filter(Invoice.ignored.is_(False))
  rows = q.order_by(Invoice.invoice_date.desc()).all()

  def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
      return None
    if dt.tzinfo is None:
      return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

  now = datetime.now(timezone.utc)
  today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
  week_end = today_start + timedelta(days=7)

  out: List[InvoiceListOut] = []
  for inv, supplier_name in rows:
    ps = payment_status_label(inv)
    dd = _aware(inv.due_date)
    if due_filter == "overdue":
      if dd is None or dd >= today_start or ps == "paid":
        continue
    elif due_filter == "due_soon":
      if dd is None or dd < today_start or dd > week_end or ps == "paid":
        continue

    base = InvoiceRead.model_validate(inv).model_dump()
    base["supplier_name"] = supplier_name or ""
    base["payment_status"] = ps
    out.append(InvoiceListOut(**base))
  return out


def get_invoice(db: Session, invoice_id: int) -> Optional[Invoice]:
  return db.query(Invoice).filter(Invoice.id == invoice_id).first()


async def create_invoice(
  db: Session,
  data: InvoiceCreate,
  file: Optional[UploadFile] = None,
) -> Invoice:
  payload = data.model_dump()
  imponibile = Decimal(str(payload["imponibile"])).quantize(Decimal("0.01"))
  vat_percent = Decimal(str(payload.get("vat_percent") or "23.0"))

  vat_amount, total = calculate_vat(imponibile, vat_percent)

  file_path_str: Optional[str] = None
  if file is not None:
    safe_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{file.filename}"
    dest = UPLOAD_DIR / safe_name
    content = await file.read()
    dest.write_bytes(content)
    file_path_str = str(dest.relative_to(UPLOAD_DIR.parent.parent))

  amount_paid = Decimal(str(payload.get("amount_paid") or "0")).quantize(Decimal("0.01"))
  if amount_paid < 0:
    amount_paid = Decimal("0")

  invoice = Invoice(
    supplier_id=payload["supplier_id"],
    invoice_number=payload["invoice_number"],
    invoice_date=payload["invoice_date"],
    imponibile=imponibile,
    vat_percent=vat_percent,
    vat_amount=vat_amount,
    total=total,
    file_path=file_path_str,
    note=payload.get("note"),
    due_date=payload.get("due_date"),
    amount_paid=amount_paid,
    cash_entry_id=payload.get("cash_entry_id"),
    ignored=bool(payload.get("ignored") or False),
    is_paid=False,
  )
  sync_invoice_paid_flag(invoice)

  db.add(invoice)
  db.commit()
  db.refresh(invoice)
  return invoice


async def update_invoice(
  db: Session,
  invoice_id: int,
  supplier_id: int,
  invoice_number: str,
  invoice_date,
  imponibile: float,
  vat_percent: float = 23.0,
  note: Optional[str] = None,
  file: Optional[UploadFile] = None,
  due_date=None,
  amount_paid: Optional[float] = None,
  cash_entry_id: Optional[int] = None,
) -> Optional[Invoice]:
  inv = get_invoice(db, invoice_id)
  if not inv:
    return None

  if isinstance(invoice_date, str):
    invoice_date = datetime.fromisoformat(invoice_date.replace("Z", "+00:00"))

  imp = Decimal(str(imponibile)).quantize(Decimal("0.01"))
  vp = Decimal(str(vat_percent))
  vat_amount, total = calculate_vat(imp, vp)

  file_path_str = inv.file_path
  if file is not None:
    safe_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{file.filename}"
    dest = UPLOAD_DIR / safe_name
    content = await file.read()
    dest.write_bytes(content)
    file_path_str = str(dest.relative_to(UPLOAD_DIR.parent.parent))

  inv.supplier_id = supplier_id
  inv.invoice_number = invoice_number
  inv.invoice_date = invoice_date
  inv.imponibile = imp
  inv.vat_percent = vp
  inv.vat_amount = vat_amount
  inv.total = total
  inv.file_path = file_path_str
  inv.note = note
  inv.due_date = due_date
  inv.amount_paid = Decimal(str(amount_paid if amount_paid is not None else 0)).quantize(Decimal("0.01"))
  inv.cash_entry_id = cash_entry_id
  if inv.ignored is None:
    inv.ignored = False
  sync_invoice_paid_flag(inv)

  db.commit()
  db.refresh(inv)
  return inv


def delete_invoice(db: Session, invoice_id: int) -> bool:
  inv = get_invoice(db, invoice_id)
  if not inv:
    return False
  db.delete(inv)
  db.commit()
  return True


def mark_invoice_paid(db: Session, invoice_id: int) -> Optional[Invoice]:
  inv = get_invoice(db, invoice_id)
  if not inv:
    return None
  inv.amount_paid = Decimal(str(inv.total or 0)).quantize(Decimal("0.01"))
  inv.ignored = False
  sync_invoice_paid_flag(inv)
  db.commit()
  db.refresh(inv)
  return inv


def set_invoice_ignored(db: Session, invoice_id: int, ignored: bool) -> Optional[Invoice]:
  inv = get_invoice(db, invoice_id)
  if not inv:
    return None
  inv.ignored = bool(ignored)
  db.commit()
  db.refresh(inv)
  return inv


def get_invoices_for_export(db: Session, supplier_id: Optional[int] = None) -> List[dict]:
  query = db.query(Invoice, Supplier.name).join(Supplier, Invoice.supplier_id == Supplier.id)
  if supplier_id is not None:
    query = query.filter(Invoice.supplier_id == supplier_id)
  rows = query.order_by(Invoice.invoice_date.desc()).all()

  return [
    {
      "data": inv.invoice_date.strftime("%Y-%m-%d") if inv.invoice_date else "",
      "fornitore": name or "",
      "n_fattura": inv.invoice_number or "",
      "imponibile": float(inv.imponibile),
      "iva_percent": float(inv.vat_percent),
      "iva": float(inv.vat_amount),
      "totale": float(inv.total),
      "note": inv.note or "",
    }
    for inv, name in rows
  ]
