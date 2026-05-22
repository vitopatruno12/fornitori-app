"""Service AI: Ollama (locale) se disponibile, opzionale Gemini, altrimenti euristiche."""

from typing import Any, Dict, List, Optional

from ..services import ai_heuristics
from . import gemini_client, ollama_client
from .prompts import (
    ASK_AI,
    INVOICE_EXTRACT,
    ORDER_FULL_EXTRACT,
    ORDER_LINES_EXTRACT,
    PRIMA_NOTA_EXTRACT,
    STAFF_SHIFT_EXTRACT,
    SUPPLIER_EXTRACT,
)


def _llm_or_fallback(
    prompt: str,
    user_payload: str,
    fallback,
):
    if ollama_client.is_configured():
        data = ollama_client.generate_json(prompt, user_payload)
        if data:
            return data
    if gemini_client.is_configured():
        data = gemini_client.generate_json(prompt, user_payload)
        if data:
            return data
    return fallback()


def _staff_shifts_usable(data: Dict[str, Any] | None) -> bool:
    if not data:
        return False
    for item in ai_heuristics._staff_shifts_from_payload(data):
        if item.get("time_start") and item.get("time_end"):
            return True
    return False


def suggest_supplier_fields(text: str, existing_data: Dict[str, Any] | None = None) -> Dict[str, Any]:
    payload = f"Testo:\n{text}\n\nDati già presenti:\n{existing_data or {}}"
    return _llm_or_fallback(
        SUPPLIER_EXTRACT,
        payload,
        lambda: ai_heuristics.suggest_supplier_fields(text, existing_data),
    )


def suggest_prima_nota_fields(text: str, context: Dict[str, Any] | None = None) -> Dict[str, Any]:
    payload = f"Testo:\n{text}\n\nContesto:\n{context or {}}"
    return _llm_or_fallback(
        PRIMA_NOTA_EXTRACT,
        payload,
        lambda: ai_heuristics.suggest_prima_nota_fields(text),
    )


def suggest_invoice_fields(text: str, existing_data: Dict[str, Any] | None = None) -> Dict[str, Any]:
    payload = f"Testo:\n{text}\n\nDati esistenti:\n{existing_data or {}}"
    return _llm_or_fallback(
        INVOICE_EXTRACT,
        payload,
        lambda: ai_heuristics.suggest_invoice_fields(text, existing_data),
    )


def suggest_order_lines(text: str) -> Dict[str, Any]:
    return _llm_or_fallback(
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
    # Percorso veloce: euristiche (ms) per comandi tipo "Marianna 8-16" / "tutti lun-ven 8-16"
    local = ai_heuristics.suggest_staff_shift(text, names, ctx)
    if local.get("suggested_shifts"):
        return local

    payload = (
        f"Comando:\n{text}\n\nDipendenti:\n{', '.join(names[:40])}"
        f"\nselected_date={ctx.get('selected_date')} week_start={ctx.get('week_start')} "
        f"week_end={ctx.get('week_end')} today={ctx.get('today')}"
    )
    llm_data: Dict[str, Any] | None = None
    if ollama_client.is_configured():
        llm_data = ollama_client.generate_json(
            STAFF_SHIFT_EXTRACT, payload, timeout_sec=ollama_client.staff_timeout_sec()
        )
    if not _staff_shifts_usable(llm_data) and gemini_client.is_configured():
        llm_data = gemini_client.generate_json(STAFF_SHIFT_EXTRACT, payload)
    if llm_data:
        enriched = ai_heuristics.enrich_staff_shift_response(llm_data, text, names, ctx)
        if enriched.get("suggested_shifts"):
            return enriched
    return local


def suggest_order_full(text: str, supplier_names: List[str] | None = None) -> Dict[str, Any]:
    names = supplier_names or []
    payload = f"Testo ordine:\n{text}\n\nFornitori noti:\n{', '.join(names[:80])}"
    return _llm_or_fallback(
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
    return _llm_or_fallback(
        ASK_AI,
        user,
        lambda: ai_heuristics.ask_ai(question, module, context),
    )


def parse_command(user_input: str) -> Optional[Dict[str, Any]]:
    """Comando naturale → JSON (Ollama / Gemini)."""
    return ollama_client.parse_command(user_input)
