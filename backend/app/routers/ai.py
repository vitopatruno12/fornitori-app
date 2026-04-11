from fastapi import APIRouter

from ..schemas.ai import (
    AnomalyCheckIn,
    AnomalyCheckOut,
    AskAiIn,
    AskAiOut,
    InvoiceSuggestIn,
    InvoiceSuggestOut,
    OrderSuggestIn,
    OrderSuggestOut,
    PrimaNotaSuggestIn,
    PrimaNotaSuggestOut,
    SupplierSuggestIn,
    SupplierSuggestOut,
)
from ..services import ai_service

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/suppliers/suggest", response_model=SupplierSuggestOut)
def suggest_supplier(dto: SupplierSuggestIn):
    return ai_service.suggest_supplier_fields(dto.text, dto.existing_data)


@router.post("/prima-nota/suggest", response_model=PrimaNotaSuggestOut)
def suggest_prima_nota(dto: PrimaNotaSuggestIn):
    return ai_service.suggest_prima_nota_fields(dto.text)


@router.post("/invoices/suggest", response_model=InvoiceSuggestOut)
def suggest_invoice(dto: InvoiceSuggestIn):
    return ai_service.suggest_invoice_fields(dto.text, dto.existing_data)


@router.post("/orders/suggest", response_model=OrderSuggestOut)
def suggest_order(dto: OrderSuggestIn):
    return ai_service.suggest_order_lines(dto.text)


@router.post("/anomalies/check", response_model=AnomalyCheckOut)
def check_anomalies(dto: AnomalyCheckIn):
    return ai_service.check_anomalies(dto.entity_type, dto.payload)


@router.post("/ask", response_model=AskAiOut)
def ask_ai(dto: AskAiIn):
    return ai_service.ask_ai(dto.question, dto.module, dto.context)

