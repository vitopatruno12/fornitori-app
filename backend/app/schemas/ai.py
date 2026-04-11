from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class SupplierSuggestIn(BaseModel):
    text: str
    existing_data: Optional[Dict[str, Any]] = None


class SupplierSuggestOut(BaseModel):
    suggested_fields: Dict[str, Any]
    missing_fields: List[str]
    warnings: List[str]
    confidence: float


class PrimaNotaSuggestIn(BaseModel):
    text: str
    context: Optional[Dict[str, Any]] = None


class PrimaNotaSuggestOut(BaseModel):
    suggested_fields: Dict[str, Any]
    warnings: List[str]
    confidence: float


class InvoiceSuggestIn(BaseModel):
    text: str
    existing_data: Optional[Dict[str, Any]] = None


class InvoiceSuggestOut(BaseModel):
    suggested_fields: Dict[str, Any]
    warnings: List[str]
    confidence: float


class AnomalyCheckIn(BaseModel):
    entity_type: str
    payload: Dict[str, Any]
    history: Optional[Dict[str, Any]] = None


class AnomalyCheckOut(BaseModel):
    has_anomalies: bool
    anomalies: List[str]
    severity: str


class AskAiIn(BaseModel):
    question: str
    module: Optional[str] = None
    context: Optional[Dict[str, Any]] = None


class AskAiOut(BaseModel):
    answer: str
    confidence: float
    suggested_actions: List[str]


class OrderLineSuggest(BaseModel):
    product_description: str
    pieces: Optional[int] = None
    weight_kg: Optional[Decimal] = None
    note: Optional[str] = None


class OrderSuggestIn(BaseModel):
    text: str


class OrderSuggestOut(BaseModel):
    suggested_lines: List[OrderLineSuggest]
    warnings: List[str]
    confidence: float

