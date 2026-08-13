from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class ElectronicInvoiceImportOut(BaseModel):
  status: str
  electronic_invoice_id: Optional[int] = None
  incoming_invoice_id: Optional[int] = None
  supplier_found: Optional[bool] = None
  supplier_id: Optional[int] = None
  invoice_number: Optional[str] = None
  invoice_date: Optional[str] = None
  total_amount: Optional[str] = None
