import io
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.invoice import InvoiceCreate, InvoiceListOut, InvoiceRead
from ..services import invoice_service


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


@router.get("/", response_model=List[InvoiceListOut])
def list_invoices(
  supplier_id: Optional[int] = Query(default=None),
  due_filter: Optional[str] = Query(
    default=None,
    description="Filtra: overdue (scadute), due_soon (in scadenza entro 7 giorni)",
  ),
  include_ignored: bool = Query(default=False),
  db: Session = Depends(get_db),
):
  if due_filter not in (None, "overdue", "due_soon"):
    raise HTTPException(status_code=400, detail="due_filter deve essere overdue o due_soon")
  return invoice_service.list_invoices(
    db,
    supplier_id=supplier_id,
    due_filter=due_filter,
    include_ignored=include_ignored,
  )


@router.get("/{invoice_id}", response_model=InvoiceRead)
def get_invoice(invoice_id: int, db: Session = Depends(get_db)):
  inv = invoice_service.get_invoice(db, invoice_id)
  if not inv:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fattura non trovata")
  return inv


@router.post("/", response_model=InvoiceRead)
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
