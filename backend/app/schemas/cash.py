from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field


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
    activity: Optional[str] = None


class CashEntryCreate(CashEntryBase):
    """Creazione/aggiornamento movimento: descrizione obbligatoria."""

    description: str = Field(..., min_length=1, max_length=2000)


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
    saldo_giornaliero: Decimal  # entrate - uscite (solo fiscale)
    saldo_cumulativo: Decimal  # a fine giornata (solo fiscale)
    totale_fiscale: Decimal = Decimal("0")
    totale_non_fiscale: Decimal = Decimal("0")
    totale_pos: Decimal = Decimal("0")
    totale_refill: Decimal = Decimal("0")
    totale_vendita: Decimal = Decimal("0")


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


class PrimaNotaLocalePackSummary(BaseModel):
    activity_slug: str
    label: Optional[str] = None
    requires_access_code: bool = False


class PrimaNotaLocalePackRead(BaseModel):
    activity_slug: str
    label: Optional[str] = None
    access_code: Optional[str] = None
    requires_access_code: bool = False


class PrimaNotaLocalePackUpsert(BaseModel):
    activity_slug: str = Field(..., min_length=1, max_length=32)
    label: Optional[str] = Field(None, max_length=255)
    access_code: Optional[str] = Field(None, min_length=6, max_length=6, pattern=r"^\d{6}$")
    regenerate_access_code: bool = False
