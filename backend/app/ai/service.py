"""Service AI: Ollama (locale) se disponibile, opzionale Gemini, euristiche come supporto."""

import os
from datetime import date
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
    SUPPLIER_EXTRACT_FAST,
)


def _supplier_force_llm() -> bool:
    return os.getenv("OLLAMA_SUPPLIER_FORCE_LLM", "").strip().lower() in ("1", "true", "yes")


def _supplier_skip_llm(heur: Dict[str, Any], text: str) -> bool:
    """Se le euristiche hanno già dati utili, non attendere Ollama (evita 10–20 s di attesa)."""
    if _supplier_force_llm():
        return False
    if ai_heuristics.supplier_instant_path_ok(heur, text):
        return True
    sf = (heur or {}).get("suggested_fields") or {}
    core = (
        "name",
        "vat_number",
        "email",
        "phone",
        "contact_person",
        "iban",
        "fiscal_code",
        "city",
        "payment_terms",
    )
    return any(str(sf.get(k) or "").strip() for k in core)


def _llm_configured() -> bool:
    return ollama_client.is_configured() or gemini_client.is_configured()


def _call_llm(
    prompt: str,
    user_payload: str,
    *,
    order: bool = False,
    supplier: bool = False,
) -> Optional[Dict[str, Any]]:
    if ollama_client.is_configured():
        kwargs: Dict[str, Any] = {}
        if order:
            kwargs["timeout_sec"] = ollama_client.order_timeout_sec()
            kwargs["num_predict"] = ollama_client.order_num_predict()
        elif supplier:
            kwargs["timeout_sec"] = ollama_client.supplier_timeout_sec()
            kwargs["num_predict"] = ollama_client.supplier_num_predict()
        data = ollama_client.generate_json(prompt, user_payload, **kwargs)
        if data:
            return data
    if gemini_client.is_configured():
        return gemini_client.generate_json(prompt, user_payload)
    return None


def _llm_or_fallback(
    prompt: str,
    user_payload: str,
    fallback,
):
    data = _call_llm(prompt, user_payload)
    if data:
        return data
    return fallback()


def _supplier_payload(text: str, existing_data: Dict[str, Any] | None) -> str:
    return (
        "### Testo dettato\n"
        f"{text}\n\n"
        "### Campi già nel form (non sovrascrivere se il testo non li menziona)\n"
        f"{existing_data or {}}\n\n"
        "Mappa ogni informazione nella SEZIONE suggested_fields, campo per campo."
    )


def _order_full_payload(text: str, supplier_names: List[str]) -> str:
    names = ", ".join(supplier_names[:80]) if supplier_names else "(nessuno)"
    today = date.today().isoformat()
    return (
        "### Testo comando vocale\n"
        f"{text}\n\n"
        f"### Oggi (per oggi/domani/giorni settimana): {today}\n\n"
        "### SEZIONE intestazione — fornitori noti (scegli supplier_name esatto se possibile)\n"
        f"{names}\n\n"
        "SEZIONE 1 = suggested_fields. SEZIONE 2 = suggested_lines (una riga per prodotto)."
    )


def _staff_shifts_usable(data: Dict[str, Any] | None) -> bool:
    if not data:
        return False
    for item in ai_heuristics._staff_shifts_from_payload(data):
        if item.get("time_start") and item.get("time_end"):
            return True
    return False


def suggest_supplier_fields(text: str, existing_data: Dict[str, Any] | None = None) -> Dict[str, Any]:
    heur = ai_heuristics.suggest_supplier_fields(text, existing_data)
    if _supplier_skip_llm(heur, text):
        out = dict(heur)
        out["suggested_fields"] = ai_heuristics._sanitize_supplier_suggested_fields(
            out.get("suggested_fields") or {}, text
        )
        out["local_fallback"] = True
        out["fast_path"] = True
        return out
    if not _llm_configured():
        out = dict(heur)
        out["local_fallback"] = True
        return out
    prompt = SUPPLIER_EXTRACT_FAST if ai_heuristics.supplier_heuristics_usable(heur) else SUPPLIER_EXTRACT
    llm = _call_llm(
        prompt,
        _supplier_payload(text, existing_data),
        supplier=True,
    )
    if llm:
        merged = ai_heuristics.merge_supplier_fields_response(llm, heur, text)
        merged["ai_used"] = True
        return merged
    out = dict(heur)
    out["local_fallback"] = True
    return out


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
    heur = ai_heuristics.normalize_order_suggest_result(
        ai_heuristics.suggest_order_lines(text)
    )
    if not _llm_configured():
        heur["local_fallback"] = True
        return heur
    data = _call_llm(
        ORDER_LINES_EXTRACT,
        f"### Elenco merce (ogni prodotto = una riga JSON)\n{text}",
        order=True,
    )
    if not data:
        heur["local_fallback"] = True
        return heur
    merged = ai_heuristics.merge_order_full_response(
        {"suggested_fields": {}, **data},
        {"suggested_fields": {}, **heur},
    )
    return {
        "suggested_lines": merged.get("suggested_lines") or [],
        "warnings": merged.get("warnings") or [],
        "confidence": merged.get("confidence") or 0.74,
        "ai_used": True,
    }


def suggest_staff_shift(
    text: str,
    member_names: List[str] | None = None,
    context: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    names = member_names or []
    ctx = context or {}
    local = ai_heuristics.suggest_staff_shift(text, names, ctx)
    local_shifts = local.get("suggested_shifts") or []
    if local_shifts and not _llm_configured():
        return local
    # Comandi "tutti + settimana": espansione locale affidabile; evita risposta LLM troncata.
    if (
        local_shifts
        and ai_heuristics.is_staff_bulk_command(text)
        and len(local_shifts) >= 2
    ):
        out = dict(local)
        out["fast_path"] = True
        return out

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
        llm_shifts = enriched.get("suggested_shifts") or []
        if llm_shifts:
            if (
                ai_heuristics.is_staff_bulk_command(text)
                and len(local_shifts) > len(llm_shifts)
            ):
                out = dict(local)
                out["warnings"] = list(local.get("warnings") or []) + [
                    "Espansione completa in locale (risposta AI parziale)."
                ]
                out["fast_path"] = True
                return out
            enriched["ai_used"] = True
            return enriched
    return local


def suggest_order_full(text: str, supplier_names: List[str] | None = None) -> Dict[str, Any]:
    names = supplier_names or []
    heur = ai_heuristics.normalize_order_suggest_result(
        ai_heuristics.suggest_order_full(text, supplier_names)
    )
    if not _llm_configured():
        heur["local_fallback"] = True
        return heur
    data = _call_llm(ORDER_FULL_EXTRACT, _order_full_payload(text, names), order=True)
    if not data:
        heur["local_fallback"] = True
        return heur
    merged = ai_heuristics.merge_order_full_response(data, heur)
    merged["ai_used"] = True
    return merged


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
