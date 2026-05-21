"""Controller AI (endpoint REST /ai)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.ai import (
    AnomalyCheckIn,
    AnomalyCheckOut,
    AskAiIn,
    AskAiOut,
    InvoiceSuggestIn,
    InvoiceSuggestOut,
    ManagerInsightsOut,
    OrderFullSuggestIn,
    OrderFullSuggestOut,
    OrderSuggestIn,
    OrderSuggestOut,
    PrimaNotaSuggestIn,
    PrimaNotaSuggestOut,
    SupplierSuggestIn,
    SupplierSuggestOut,
)
from ..services import ai_manager_service
from . import service as ai_service

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/suppliers/suggest", response_model=SupplierSuggestOut)
def suggest_supplier(dto: SupplierSuggestIn):
    return ai_service.suggest_supplier_fields(dto.text, dto.existing_data)


@router.post("/prima-nota/suggest", response_model=PrimaNotaSuggestOut)
def suggest_prima_nota(dto: PrimaNotaSuggestIn):
    return ai_service.suggest_prima_nota_fields(dto.text, dto.context)


@router.post("/invoices/suggest", response_model=InvoiceSuggestOut)
def suggest_invoice(dto: InvoiceSuggestIn):
    return ai_service.suggest_invoice_fields(dto.text, dto.existing_data)


@router.post("/orders/suggest", response_model=OrderSuggestOut)
def suggest_order(dto: OrderSuggestIn):
    return ai_service.suggest_order_lines(dto.text)


@router.post("/staff/shift-suggest")
def suggest_staff_shift(body: dict):
    return ai_service.suggest_staff_shift(
        str(body.get("text") or ""),
        body.get("member_names") or [],
        body.get("context") or {},
    )


@router.post("/orders/suggest-full", response_model=OrderFullSuggestOut)
def suggest_order_full(dto: OrderFullSuggestIn):
    return ai_service.suggest_order_full(dto.text, dto.supplier_names)


@router.post("/anomalies/check", response_model=AnomalyCheckOut)
def check_anomalies(dto: AnomalyCheckIn):
    return ai_service.check_anomalies(dto.entity_type, dto.payload)


@router.post("/ask", response_model=AskAiOut)
def ask_ai(dto: AskAiIn):
    return ai_service.ask_ai(dto.question, dto.module, dto.context)


@router.get("/manager/insights", response_model=ManagerInsightsOut)
def manager_insights(db: Session = Depends(get_db)):
    return ai_manager_service.gather_insights(db)
