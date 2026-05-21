"""Compatibilità: re-export dal modulo AI (Gemini + euristiche)."""

from ..ai.service import (
    ask_ai,
    check_anomalies,
    suggest_invoice_fields,
    suggest_order_full,
    suggest_order_lines,
    suggest_prima_nota_fields,
    suggest_supplier_fields,
)

__all__ = [
    "ask_ai",
    "check_anomalies",
    "suggest_invoice_fields",
    "suggest_order_full",
    "suggest_order_lines",
    "suggest_prima_nota_fields",
    "suggest_supplier_fields",
]
