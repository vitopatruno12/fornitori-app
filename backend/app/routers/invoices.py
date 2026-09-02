import io
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.invoice import InvoiceCreate, InvoiceDetailOut, InvoiceListOut, InvoiceRead
from ..services import invoice_service
from ..services.invoice_analytics import get_invoices_analytics_summary
from ..services import invoice_import_service


router = APIRouter(prefix="/invoices", tags=["invoices"])


def _parse_invoice_datetime(value: str) -> datetime:
  if "T" in value:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
  return datetime.fromisoformat(value + "T00:00:00").replace(tzinfo=timezone.utc)


def _parse_optional_due(value: Optional[str]):
  if value is None or (isinstance(value, str) and not value.strip()):
    return None
  s = value.strip()
  if len(s) == 10:
    return datetime.fromisoformat(s + "T00:00:00").replace(tzinfo=timezone.utc)
  return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _parse_optional_int(value: Optional[str]) -> Optional[int]:
  if value is None or (isinstance(value, str) and not str(value).strip()):
    return None
  return int(str(value).strip())


@router.get("/analytics/summary")
def invoices_analytics_summary(db: Session = Depends(get_db)):
  """KPI dashboard fatture (mese, IVA, scadenze, da registrare)."""
  return get_invoices_analytics_summary(db)


@router.post("/import-xml")
async def import_invoice_xml(
  file: UploadFile = File(..., description="XML FatturaPA"),
  db: Session = Depends(get_db),
):
  """
  Importa una fattura elettronica XML in Atlas (senza SdI).
  Deduplica per SHA-256 del contenuto.
  """
  raw = await file.read()
  if not raw:
    raise HTTPException(status_code=400, detail="File XML vuoto")
  xml_text = raw.decode("utf-8", errors="replace")
  try:
    return invoice_import_service.import_xml(db, xml_text, filename=file.filename)
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/incoming")
def list_incoming_invoices(
  limit: int = Query(50, ge=1, le=200),
  db: Session = Depends(get_db),
):
  """Elenco fatture ricevute (XML), una riga per documento logico (fornitore+numero+data)."""
  from ..models.electronic_invoice import IncomingInvoice, IncomingInvoiceLine
  from ..models.supplier import Supplier

  rows = (
    db.query(IncomingInvoice)
    .order_by(IncomingInvoice.invoice_date.desc(), IncomingInvoice.id.desc())
    .limit(max(limit * 5, 200))
    .all()
  )

  # Deduplica reimport dello stesso documento (hash XML diversi, stesso n./data/fornitore)
  best: dict[tuple, IncomingInvoice] = {}
  for row in rows:
    day = row.invoice_date.date().isoformat() if row.invoice_date else ""
    key = (row.supplier_id or 0, str(row.invoice_number or "").strip(), day)
    prev = best.get(key)
    if prev is None:
      best[key] = row
      continue
    prev_score = (1 if prev.atlas_invoice_id else 0, prev.id or 0)
    cur_score = (1 if row.atlas_invoice_id else 0, row.id or 0)
    if cur_score > prev_score:
      best[key] = row

  deduped = sorted(
    best.values(),
    key=lambda r: (r.invoice_date or datetime.min.replace(tzinfo=timezone.utc), r.id or 0),
    reverse=True,
  )[:limit]

  out = []
  for row in deduped:
    supplier = db.query(Supplier).filter(Supplier.id == row.supplier_id).first() if row.supplier_id else None
    lines = (
      db.query(IncomingInvoiceLine)
      .filter(IncomingInvoiceLine.invoice_id == row.id)
      .order_by(IncomingInvoiceLine.line_number.asc())
      .all()
    )
    out.append(invoice_import_service._incoming_out(row, lines, supplier))
  return {"items": out, "count": len(out)}


@router.get("/incoming/{incoming_id}")
def get_incoming_invoice(incoming_id: int, db: Session = Depends(get_db)):
  """Dettaglio fattura passiva importata da XML."""
  from ..models.electronic_invoice import ElectronicInvoice, IncomingInvoice, IncomingInvoiceLine
  from ..models.supplier import Supplier

  row = db.query(IncomingInvoice).filter(IncomingInvoice.id == incoming_id).first()
  if not row:
    raise HTTPException(status_code=404, detail="Fattura passiva non trovata")
  supplier = db.query(Supplier).filter(Supplier.id == row.supplier_id).first() if row.supplier_id else None
  lines = (
    db.query(IncomingInvoiceLine)
    .filter(IncomingInvoiceLine.invoice_id == row.id)
    .order_by(IncomingInvoiceLine.line_number.asc())
    .all()
  )
  electronic = (
    db.query(ElectronicInvoice).filter(ElectronicInvoice.id == row.electronic_invoice_id).first()
  )
  payload = invoice_import_service._incoming_out(row, lines, supplier)
  if electronic:
    payload["document_type"] = electronic.document_type
    payload["filename"] = electronic.filename
    payload["supplier_vat_xml"] = electronic.supplier_vat
  return payload


@router.get("/export/csv")
def export_invoices_csv(
  supplier_id: Optional[int] = Query(None),
  db: Session = Depends(get_db),
):
  rows = invoice_service.get_invoices_for_export(db, supplier_id=supplier_id)

  def _esc(s):
    return (s or "").replace(";", ",")

  buf = io.StringIO()
  buf.write("Data;Fornitore;N. fattura;Imponibile;IVA %;IVA;Totale;Note\n")
  for r in rows:
    buf.write(
      f"{r['data']};{_esc(r['fornitore'])};{_esc(r['n_fattura'])};{r['imponibile']:.2f};{r['iva_percent']:.1f};{r['iva']:.2f};{r['totale']:.2f};{_esc(r['note'])}\n"
    )

  buf.seek(0)
  filename = "storico_fatture.csv"
  return StreamingResponse(
    iter([buf.getvalue().encode("utf-8-sig")]),
    media_type="text/csv",
    headers={"Content-Disposition": f'attachment; filename="{filename}"'},
  )


@router.get("", response_model=List[InvoiceListOut])
@router.get("/", response_model=List[InvoiceListOut], include_in_schema=False)
def list_invoices(
  supplier_id: Optional[int] = Query(default=None),
  due_filter: Optional[str] = Query(
    default=None,
    description="Filtra: overdue (scadute), due_soon (in scadenza entro 7 giorni)",
  ),
  include_ignored: bool = Query(default=False),
  company: Optional[str] = Query(
    default=None,
    description="Filtra per società: mediazione|via_lattea|risacca|pg|non_classificata",
  ),
  db: Session = Depends(get_db),
):
  if due_filter not in (None, "overdue", "due_soon"):
    raise HTTPException(status_code=400, detail="due_filter deve essere overdue o due_soon")
  return invoice_service.list_invoices(
    db,
    supplier_id=supplier_id,
    due_filter=due_filter,
    include_ignored=include_ignored,
    company=company,
  )


@router.get("/{invoice_id}", response_model=InvoiceDetailOut)
def get_invoice(invoice_id: int, db: Session = Depends(get_db)):
  inv = invoice_service.get_invoice_detail(db, invoice_id)
  if not inv:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fattura non trovata")
  return inv


@router.post("", response_model=InvoiceRead)
@router.post("/", response_model=InvoiceRead, include_in_schema=False)
async def create_invoice(
  supplier_id: int = Form(...),
  invoice_number: str = Form(...),
  invoice_date: str = Form(...),
  imponibile: float = Form(...),
  vat_percent: float = Form(23.0),
  note: Optional[str] = Form(None),
  due_date: Optional[str] = Form(None),
  amount_paid: float = Form(0),
  cash_entry_id: Optional[str] = Form(None),
  file: Optional[UploadFile] = File(None),
  db: Session = Depends(get_db),
):
  payload = InvoiceCreate(
    supplier_id=supplier_id,
    invoice_number=invoice_number,
    invoice_date=_parse_invoice_datetime(invoice_date),
    imponibile=imponibile,
    vat_percent=vat_percent,
    note=note,
    due_date=_parse_optional_due(due_date),
    amount_paid=amount_paid,
    cash_entry_id=_parse_optional_int(cash_entry_id),
  )
  return await invoice_service.create_invoice(db, payload, file)


@router.put("/{invoice_id}", response_model=InvoiceRead)
async def update_invoice(
  invoice_id: int,
  supplier_id: int = Form(...),
  invoice_number: str = Form(...),
  invoice_date: str = Form(...),
  imponibile: float = Form(...),
  vat_percent: float = Form(23.0),
  note: Optional[str] = Form(None),
  due_date: Optional[str] = Form(None),
  amount_paid: float = Form(0),
  cash_entry_id: Optional[str] = Form(None),
  file: Optional[UploadFile] = File(None),
  db: Session = Depends(get_db),
):
  inv = await invoice_service.update_invoice(
    db,
    invoice_id,
    supplier_id,
    invoice_number,
    _parse_invoice_datetime(invoice_date),
    imponibile,
    vat_percent,
    note,
    file,
    due_date=_parse_optional_due(due_date),
    amount_paid=amount_paid,
    cash_entry_id=_parse_optional_int(cash_entry_id),
  )
  if not inv:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fattura non trovata")
  return inv


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(invoice_id: int, db: Session = Depends(get_db)):
  deleted = invoice_service.delete_invoice(db, invoice_id)
  if not deleted:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fattura non trovata")


@router.post("/{invoice_id}/mark-paid", response_model=InvoiceRead)
def mark_invoice_paid(invoice_id: int, db: Session = Depends(get_db)):
  inv = invoice_service.mark_invoice_paid(db, invoice_id)
  if not inv:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fattura non trovata")
  return inv


@router.post("/{invoice_id}/ignore", response_model=InvoiceRead)
def toggle_invoice_ignore(
  invoice_id: int,
  ignored: bool = Query(True, description="True = ignora, False = ripristina"),
  db: Session = Depends(get_db),
):
  inv = invoice_service.set_invoice_ignored(db, invoice_id, ignored=ignored)
  if not inv:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fattura non trovata")
  return inv
