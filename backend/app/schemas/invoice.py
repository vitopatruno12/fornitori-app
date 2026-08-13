from datetime import datetime
from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class InvoiceBase(BaseModel):
  supplier_id: int
  invoice_number: str
  invoice_date: datetime
  imponibile: Decimal
  vat_percent: Decimal = Decimal("23.0")
  note: Optional[str] = None
  is_paid: bool = False
  due_date: Optional[datetime] = None
  amount_paid: Decimal = Decimal("0")
  cash_entry_id: Optional[int] = None
  ignored: bool = False


class InvoiceCreate(InvoiceBase):
  pass


class InvoiceRead(InvoiceBase):
  id: int
  vat_amount: Decimal
  total: Decimal
  file_path: Optional[str] = None
  created_at: datetime

  class Config:
    from_attributes = True


class InvoiceRowOut(BaseModel):
  line_no: int
  description: Optional[str] = None
  quantity: Optional[Decimal] = None
  unit_price: Optional[Decimal] = None
  vat_percent: Decimal
  imponibile: Decimal
  vat_amount: Decimal
  total_line: Decimal

  class Config:
    from_attributes = True


class InvoiceDetailOut(InvoiceRead):
  """Dettaglio fattura con righe (solo GET /invoices/{id})."""

  rows: List[InvoiceRowOut] = Field(default_factory=list)


class InvoiceListOut(InvoiceRead):
  supplier_name: str = ""
  payment_status: Literal["paid", "unpaid", "partial"] = "unpaid"

  class Config:
    from_attributes = True
