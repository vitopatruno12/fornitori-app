from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Literal, Optional
from pathlib import Path
import re

from fastapi import UploadFile
from sqlalchemy.orm import Session

from ..constants.sdi_companies import (
  destination_to_legacy_section,
  is_our_issued_to_external,
  normalize_company_section,
  pick_company,
)
from ..models.bank_movement import BankMovement
from ..models.cash_entry import CashEntry
from ..models.electronic_invoice import ElectronicInvoice, IncomingInvoice
from ..models.invoice import Invoice
from ..models.invoice_row import InvoiceRow
from ..models.sdi_invoice import SdiInvoice
from ..models.supplier import Supplier
from ..schemas.invoice import InvoiceCreate, InvoiceDetailOut, InvoiceListOut, InvoiceRead, InvoiceRowOut
from .vat_service import calculate_vat

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads" / "invoices"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Prima Nota activity → società fatture (Mediazione A = Abba, Mediazione Z = Zanardelli)
_ACTIVITY_TO_COMPANY = {
  "via_abba": "mediazione_a",
  "via_zanardelli": "mediazione_z",
  "mediazione_a": "mediazione_a",
  "mediazione_z": "mediazione_z",
  "mediazione": "non_classificata",
  "via_lattea": "via_lattea",
  "risacca": "risacca",
  "pg": "pg",
}


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


def _company_from_activity(activity: Optional[str]) -> str:
  key = (activity or "").strip().lower()
  return _ACTIVITY_TO_COMPANY.get(key, "non_classificata")


def resolve_invoice_company(
  *,
  customer_vat: Optional[str] = None,
  receiver_vat: Optional[str] = None,
  seller_vat: Optional[str] = None,
  ade_profile_id: Optional[str] = None,
  cash_activity: Optional[str] = None,
  destination: Optional[str] = None,
) -> str:
  """Classifica fattura Atlas per società (destinazione A/Z, P.IVA, profilo AdE, activity)."""
  act_company = _company_from_activity(cash_activity)
  if act_company in {"mediazione_a", "mediazione_z"}:
    return act_company

  legacy = destination_to_legacy_section(destination) if destination else None
  by_sdi = pick_company(
    receiver_vat=receiver_vat or customer_vat,
    ade_profile_id=ade_profile_id,
    legacy_destination_section=legacy,
    seller_vat=seller_vat,
  )
  if by_sdi != "non_classificata":
    return by_sdi
  return act_company


def list_invoices(
  db: Session,
  supplier_id: Optional[int] = None,
  due_filter: Optional[str] = None,
  include_ignored: bool = False,
  company: Optional[str] = None,
  activity: Optional[str] = None,
) -> List[InvoiceListOut]:
  q = (
    db.query(
      Invoice,
      Supplier.name,
      Supplier.vat_number,
      ElectronicInvoice.customer_vat,
      ElectronicInvoice.supplier_vat,
      SdiInvoice.receiver_vat,
      SdiInvoice.ade_profile_id,
      SdiInvoice.destination,
      CashEntry.activity,
    )
    .join(Supplier, Invoice.supplier_id == Supplier.id)
    .outerjoin(IncomingInvoice, IncomingInvoice.atlas_invoice_id == Invoice.id)
    .outerjoin(ElectronicInvoice, ElectronicInvoice.id == IncomingInvoice.electronic_invoice_id)
    .outerjoin(SdiInvoice, SdiInvoice.electronic_invoice_id == IncomingInvoice.electronic_invoice_id)
    .outerjoin(CashEntry, CashEntry.id == Invoice.cash_entry_id)
  )
  if supplier_id is not None:
    q = q.filter(Invoice.supplier_id == supplier_id)
  if not include_ignored:
    q = q.filter(Invoice.ignored.is_(False))
  rows = q.order_by(Invoice.invoice_date.desc()).all()

  company_filter = ""
  if company:
    raw = str(company).strip().lower()
    if raw in {"non_classificata", "non-classificata"}:
      company_filter = "non_classificata"
    else:
      company_filter = normalize_company_section(raw)
      if company_filter == "non_classificata":
        company_filter = ""  # id sconosciuto → nessun filtro

  activity_filter = (activity or "").strip().lower()

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
  for (
    inv,
    supplier_name,
    supplier_vat_anag,
    customer_vat,
    seller_vat,
    receiver_vat,
    ade_profile_id,
    destination,
    cash_activity,
  ) in rows:
    # Emessa nostra → cliente esterno: non va in ricevute / da registrare
    # (es. Mediazione 673/Z verso Vergari finita sotto Via Lattea / PG)
    if is_our_issued_to_external(
      seller_vat=seller_vat,
      receiver_vat=receiver_vat or customer_vat,
    ):
      continue

    ps = payment_status_label(inv)
    dd = _aware(inv.due_date)
    if due_filter == "overdue":
      if dd is None or dd >= today_start or ps == "paid":
        continue
    elif due_filter == "due_soon":
      if dd is None or dd < today_start or dd > week_end or ps == "paid":
        continue

    inv_company = resolve_invoice_company(
      customer_vat=customer_vat,
      receiver_vat=receiver_vat,
      seller_vat=seller_vat,
      ade_profile_id=ade_profile_id,
      cash_activity=cash_activity,
      destination=destination,
    )
    inv_activity = (cash_activity or "").strip().lower() or None
    if company_filter:
      if inv_company != company_filter:
        continue
    if activity_filter:
      # Match diretto su activity cassa; se assente, usa la società collegata al locale.
      if inv_activity:
        if inv_activity != activity_filter:
          continue
      else:
        linked = _company_from_activity(activity_filter)
        if not linked or linked == "non_classificata" or inv_company != linked:
          continue

    base = InvoiceRead.model_validate(inv).model_dump()
    base["supplier_name"] = supplier_name or ""
    # P.IVA fornitore: anagrafica Atlas, poi XML venditore (ricevute)
    vat_bits = [
      str(supplier_vat_anag or "").strip(),
      str(seller_vat or "").strip(),
    ]
    base["supplier_vat"] = next((v for v in vat_bits if v), None)
    base["payment_status"] = ps
    base["company"] = inv_company
    base["activity"] = inv_activity
    out.append(InvoiceListOut(**base))
  return out


def get_invoice(db: Session, invoice_id: int) -> Optional[Invoice]:
  return db.query(Invoice).filter(Invoice.id == invoice_id).first()


def get_invoice_detail(db: Session, invoice_id: int) -> Optional[InvoiceDetailOut]:
  inv = get_invoice(db, invoice_id)
  if not inv:
    return None
  row_models = (
    db.query(InvoiceRow)
    .filter(InvoiceRow.invoice_id == invoice_id)
    .order_by(InvoiceRow.line_no.asc())
    .all()
  )
  base = InvoiceRead.model_validate(inv)
  return InvoiceDetailOut(
    **base.model_dump(),
    rows=[InvoiceRowOut.model_validate(r) for r in row_models],
  )

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


def mark_invoice_unpaid(db: Session, invoice_id: int) -> Optional[Invoice]:
  inv = get_invoice(db, invoice_id)
  if not inv:
    return None
  inv.amount_paid = Decimal("0.00")
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


def ignore_misrouted_our_emesse(db: Session, *, dry_run: bool = False) -> dict:
  """
  Marca ignored le fatture Atlas che sono in realtà emesse nostre verso clienti
  (cedente = P.IVA Atlas, cessionario esterno). Restano in Emesse, non in Da registrare.
  """
  rows = (
    db.query(Invoice, ElectronicInvoice.supplier_vat, ElectronicInvoice.customer_vat, Invoice.invoice_number)
    .outerjoin(IncomingInvoice, IncomingInvoice.atlas_invoice_id == Invoice.id)
    .outerjoin(ElectronicInvoice, ElectronicInvoice.id == IncomingInvoice.electronic_invoice_id)
    .filter(Invoice.ignored.is_(False))
    .all()
  )
  # Fallback: anche join via Sdi per receiver se manca customer_vat
  sdi_by_ei: dict = {}
  for sid, eid, rv in (
    db.query(SdiInvoice.id, SdiInvoice.electronic_invoice_id, SdiInvoice.receiver_vat)
    .filter(SdiInvoice.electronic_invoice_id.isnot(None))
    .all()
  ):
    if eid:
      sdi_by_ei[int(eid)] = rv

  marked = 0
  sample: List[dict] = []
  for inv, seller_vat, customer_vat, inv_num in rows:
    recv = customer_vat
    if not recv:
      # prova da Incoming → electronic → sdi
      incoming = (
        db.query(IncomingInvoice)
        .filter(IncomingInvoice.atlas_invoice_id == inv.id)
        .first()
      )
      if incoming and incoming.electronic_invoice_id:
        recv = sdi_by_ei.get(int(incoming.electronic_invoice_id)) or recv
    if not is_our_issued_to_external(seller_vat=seller_vat, receiver_vat=recv):
      continue
    marked += 1
    if len(sample) < 40:
      sample.append(
        {
          "id": inv.id,
          "invoice_number": inv_num,
          "seller_vat": seller_vat,
          "customer_vat": recv,
        }
      )
    if not dry_run:
      inv.ignored = True
      note = (inv.note or "").strip()
      tag = "Emessa nostra verso cliente (esclusa da ricevute)"
      if tag not in note:
        inv.note = f"{note} · {tag}".strip(" ·") if note else tag
  if not dry_run and marked:
    db.commit()
  return {
    "ok": True,
    "dry_run": dry_run,
    "ignored": marked,
    "sample": sample,
  }


def _invoice_day(inv: Invoice) -> str:
  if not inv.invoice_date:
    return ""
  d = inv.invoice_date
  return d.date().isoformat() if hasattr(d, "date") else str(d)[:10]


def _norm_invoice_number(value: Optional[str]) -> str:
  return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def dedupe_received_invoices(db: Session, *, dry_run: bool = False) -> dict:
  """
  Nasconde duplicati Atlas sulla stessa fattura ricevuta
  (fornitore + n. documento + data). Tiene la migliore e collega
  IncomingInvoice / movimenti banca al survivor.
  """
  rows = (
    db.query(Invoice)
    .filter(Invoice.ignored.is_(False))
    .order_by(Invoice.id.asc())
    .all()
  )
  groups: dict[tuple, list] = {}
  for inv in rows:
    key = (int(inv.supplier_id or 0), _norm_invoice_number(inv.invoice_number), _invoice_day(inv))
    if not key[1] or not key[2]:
      continue
    groups.setdefault(key, []).append(inv)

  ignored = 0
  sample: List[dict] = []
  for key, items in groups.items():
    if len(items) < 2:
      continue
    items_sorted = sorted(
      items,
      key=lambda i: (
        0 if payment_status_label(i) == "paid" else 1,
        0 if Decimal(str(i.amount_paid or 0)) > Decimal("0.009") else 1,
        0 if i.file_path else 1,
        int(i.id or 0),
      ),
    )
    keep = items_sorted[0]
    for dup in items_sorted[1:]:
      ignored += 1
      if len(sample) < 60:
        sample.append(
          {
            "keep_id": keep.id,
            "ignored_id": dup.id,
            "supplier_id": keep.supplier_id,
            "invoice_number": keep.invoice_number,
            "invoice_date": key[2],
          }
        )
      if dry_run:
        continue
      # Collega incoming e movimenti al survivor
      db.query(IncomingInvoice).filter(IncomingInvoice.atlas_invoice_id == dup.id).update(
        {IncomingInvoice.atlas_invoice_id: keep.id},
        synchronize_session=False,
      )
      db.query(BankMovement).filter(BankMovement.matched_invoice_id == dup.id).update(
        {BankMovement.matched_invoice_id: keep.id},
        synchronize_session=False,
      )
      if payment_status_label(dup) == "paid" and payment_status_label(keep) != "paid":
        keep.amount_paid = Decimal(str(keep.total or 0)).quantize(Decimal("0.01"))
        sync_invoice_paid_flag(keep)
      dup.ignored = True
      note = (dup.note or "").strip()
      tag = f"Duplicato di invoice #{keep.id} (stesso fornitore/n./data)"
      if tag not in note:
        dup.note = f"{note} · {tag}".strip(" ·") if note else tag

  if not dry_run and ignored:
    db.commit()
  return {
    "ok": True,
    "dry_run": dry_run,
    "duplicate_groups": sum(1 for items in groups.values() if len(items) > 1),
    "ignored": ignored,
    "sample": sample,
  }


def reset_unverified_paid_invoices(db: Session, *, dry_run: bool = False) -> dict:
  """
  Riporta a «da pagare» le fatture segnate pagate senza prova solida:
  - movimento banca con n. documento + importo, oppure
  - riga file fornitori con colonna PAGATO (DARE) > 0
  Scollega anche match banca deboli (solo nome / senza importo).
  """
  from . import banca_service
  from . import supplier_payments_service

  paid_rows = []
  try:
    paid_rows = supplier_payments_service.list_cash_paid_document_rows(db, all_workbooks=True)
  except Exception:
    paid_rows = []

  movements = (
    db.query(BankMovement)
    .filter(BankMovement.movement_type == "uscita")
    .order_by(BankMovement.movement_date.desc(), BankMovement.id.desc())
    .limit(8000)
    .all()
  )
  mov_meta = [{"mov": m, "blob": banca_service._movement_search_blob(m)} for m in movements]

  invoices = (
    db.query(Invoice, Supplier.name, Supplier.vat_number)
    .join(Supplier, Supplier.id == Invoice.supplier_id)
    .filter(Invoice.ignored.is_(False))
    .filter((Invoice.is_paid.is_(True)) | (Invoice.amount_paid > 0))
    .all()
  )

  reset = 0
  weak_unlinked = 0
  sample: List[dict] = []

  for inv, supplier_name, supplier_vat in invoices:
    inv.supplier_name = supplier_name  # usato dal matcher banca
    has_bank = False
    for meta in mov_meta:
      mov = meta["mov"]
      if mov.matched_invoice_id == inv.id or banca_service._bank_movement_pays_invoice(
        inv, mov, meta["blob"]
      ):
        if banca_service._bank_movement_pays_invoice(inv, mov, meta["blob"]):
          has_bank = True
          break
        # Match collegato ma non valido con le nuove regole → scollega
        if mov.matched_invoice_id == inv.id and not dry_run:
          mov.matched_invoice_id = None
          mov.reconciliation_status = "unmatched"
          mov.difference_amount = None
          weak_unlinked += 1

    file_hit = None
    if not has_bank and paid_rows:
      file_hit = supplier_payments_service.find_paid_row_for_invoice(
        paid_rows,
        invoice_number=inv.invoice_number,
        supplier_name=supplier_name,
        supplier_vat=supplier_vat,
        invoice_total=float(inv.total or 0),
      )

    if has_bank or file_hit:
      continue

    reset += 1
    if len(sample) < 80:
      sample.append(
        {
          "id": inv.id,
          "invoice_number": inv.invoice_number,
          "supplier_name": supplier_name,
          "total": float(inv.total or 0),
          "amount_paid": float(inv.amount_paid or 0),
        }
      )
    if dry_run:
      continue
    inv.amount_paid = Decimal("0.00")
    inv.is_paid = False
    # Scollega eventuali match residui
    for meta in mov_meta:
      mov = meta["mov"]
      if mov.matched_invoice_id == inv.id:
        mov.matched_invoice_id = None
        mov.reconciliation_status = "unmatched"
        mov.difference_amount = None
        weak_unlinked += 1

  if not dry_run and (reset or weak_unlinked):
    db.commit()
  return {
    "ok": True,
    "dry_run": dry_run,
    "checked_paid": len(invoices),
    "reset_unpaid": reset,
    "weak_bank_links_cleared": weak_unlinked,
    "sample": sample,
  }


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
