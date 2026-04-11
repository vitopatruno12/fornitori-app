from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel


class DashboardCashMovement(BaseModel):
    id: int
    entry_date: datetime
    type: str
    amount: Decimal
    description: Optional[str] = None
    conto: Optional[str] = None


class DashboardDeliveryRow(BaseModel):
    id: int
    delivery_date: datetime
    supplier_name: str
    product_description: Optional[str] = None
    unit_price: Decimal
    total: Decimal
    ddt_number: Optional[str] = None


class DashboardPriceIncrease(BaseModel):
    supplier_name: str
    product_description: str
    previous_unit_price: Decimal
    latest_unit_price: Decimal
    previous_date: datetime
    latest_date: datetime


class DashboardInvoiceSnippet(BaseModel):
    id: int
    supplier_name: str
    invoice_number: str
    due_date: Optional[datetime] = None
    residual: Decimal


class DashboardMonthlyFlow(BaseModel):
    month_key: str
    month_label: str
    entrate: Decimal
    uscite: Decimal


class DashboardBreakdownItem(BaseModel):
    label: str
    amount: Decimal


class DashboardPendingOrderSnippet(BaseModel):
    id: int
    supplier_name: str
    order_date: date
    expected_delivery_date: Optional[date] = None
    merchandise_summary: Optional[str] = None


class DashboardSummary(BaseModel):
    month_label: str
    saldo_cassa: Decimal
    saldo_banca: Decimal
    entrate_mese: Decimal
    uscite_mese: Decimal
    fatture_da_pagare_count: int
    fatture_da_pagare_residuo: Decimal
    fatture_scadute_count: int
    fatture_scadute_residuo: Decimal
    ultimi_movimenti: List[DashboardCashMovement]
    consegne_recenti: List[DashboardDeliveryRow]
    fornitori_prezzi_in_aumento: List[DashboardPriceIncrease]
    fatture_scadute_elenco: List[DashboardInvoiceSnippet]
    flussi_mensili: List[DashboardMonthlyFlow]
    costi_per_categoria: List[DashboardBreakdownItem]
    costi_per_fornitore: List[DashboardBreakdownItem]
    andamento_spese_6_mesi: List[DashboardBreakdownItem]
    ordini_consegna_in_ritardo: List[DashboardPendingOrderSnippet] = []
