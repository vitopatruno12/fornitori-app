"""Service AI: Gemini se configurato, altrimenti euristiche locali."""

from typing import Any, Dict, List, Optional

from ..services import ai_heuristics
from . import gemini_client
from .prompts import (
    ASK_AI,
    INVOICE_EXTRACT,
    ORDER_FULL_EXTRACT,
    ORDER_LINES_EXTRACT,
    PRIMA_NOTA_EXTRACT,
    STAFF_SHIFT_EXTRACT,
    SUPPLIER_EXTRACT,
)


def _gemini_or_fallback(
    prompt: str,
    user_payload: str,
    fallback,
):
    if gemini_client.is_configured():
        data = gemini_client.generate_json(prompt, user_payload)
        if data:
            return data
    return fallback()


def suggest_supplier_fields(text: str, existing_data: Dict[str, Any] | None = None) -> Dict[str, Any]:
    payload = f"Testo:\n{text}\n\nDati già presenti:\n{existing_data or {}}"
    return _gemini_or_fallback(
        SUPPLIER_EXTRACT,
        payload,
        lambda: ai_heuristics.suggest_supplier_fields(text, existing_data),
    )


def suggest_prima_nota_fields(text: str, context: Dict[str, Any] | None = None) -> Dict[str, Any]:
    payload = f"Testo:\n{text}\n\nContesto:\n{context or {}}"
    return _gemini_or_fallback(
        PRIMA_NOTA_EXTRACT,
        payload,
        lambda: ai_heuristics.suggest_prima_nota_fields(text),
    )


def suggest_invoice_fields(text: str, existing_data: Dict[str, Any] | None = None) -> Dict[str, Any]:
    payload = f"Testo:\n{text}\n\nDati esistenti:\n{existing_data or {}}"
    return _gemini_or_fallback(
        INVOICE_EXTRACT,
        payload,
        lambda: ai_heuristics.suggest_invoice_fields(text, existing_data),
    )


def suggest_order_lines(text: str) -> Dict[str, Any]:
    return _gemini_or_fallback(
        ORDER_LINES_EXTRACT,
        f"Elenco prodotti:\n{text}",
        lambda: ai_heuristics.suggest_order_lines(text),
    )


def suggest_staff_shift(
    text: str,
    member_names: List[str] | None = None,
    context: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    names = member_names or []
    ctx = context or {}
    payload = (
        f"Comando:\n{text}\n\nDipendenti:\n{', '.join(names[:80])}"
        f"\n\nContesto (data selezionata in UI se non diversa nel comando):\n{ctx}"
    )
    return _gemini_or_fallback(
        STAFF_SHIFT_EXTRACT,
        payload,
        lambda: ai_heuristics.suggest_staff_shift(text, names, ctx),
    )


def suggest_order_full(text: str, supplier_names: List[str] | None = None) -> Dict[str, Any]:
    names = supplier_names or []
    payload = f"Testo ordine:\n{text}\n\nFornitori noti:\n{', '.join(names[:80])}"
    return _gemini_or_fallback(
        ORDER_FULL_EXTRACT,
        payload,
        lambda: ai_heuristics.suggest_order_full(text, supplier_names),
    )


def check_anomalies(entity_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    return ai_heuristics.check_anomalies(entity_type, payload)


def ask_ai(question: str, module: str | None = None, context: Dict[str, Any] | None = None) -> Dict[str, Any]:
    mod = module or ""
    ctx = context or {}
    user = f"Modulo attivo: {mod}\nDomanda: {question}\nContesto: {ctx}"
    return _gemini_or_fallback(
        ASK_AI,
        user,
        lambda: ai_heuristics.ask_ai(question, module, context),
    )
