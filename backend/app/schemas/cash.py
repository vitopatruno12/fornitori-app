from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel


class CashEntryBase(BaseModel):
    entry_date: datetime
    type: str  # entrata | uscita
    amount: Decimal
    description: Optional[str] = None
    note: Optional[str] = None
    conto: Optional[str] = None
    riferimento_documento: Optional[str] = None
    supplier_id: Optional[int] = None
    invoice_id: Optional[int] = None
    delivery_id: Optional[int] = None
    customer_id: Optional[int] = None
    account_id: Optional[int] = None
    payment_method_id: Optional[int] = None
    category_id: Optional[int] = None


class CashEntryCreate(CashEntryBase):
    pass


class CashEntryRead(CashEntryBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class CashEntryWithBalance(CashEntryRead):
    saldo_progressivo: Decimal

    class Config:
        from_attributes = True


class DailySummary(BaseModel):
    date: str
    totale_entrate: Decimal
    totale_uscite: Decimal
    saldo_giornaliero: Decimal  # entrate - uscite
    saldo_cumulativo: Decimal  # a fine giornata


class PrimaNotaLinkInvoice(BaseModel):
    id: int
    invoice_number: str
    supplier_name: str
    total: Decimal


class PrimaNotaLinkDelivery(BaseModel):
    id: int
    product_description: Optional[str] = None
    supplier_name: str
    delivery_date: datetime


class PrimaNotaLinkOptions(BaseModel):
    invoices: List[PrimaNotaLinkInvoice]
    deliveries: List[PrimaNotaLinkDelivery]
