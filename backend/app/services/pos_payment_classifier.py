"""Classificazione pagamenti POS EasyRetail: contanti vs carta/POS."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, Optional, Tuple

CASH_KEYWORDS = (
    "contant",
    "cash",
    "cassetto",
    "monete",
    "banconot",
)
CARD_KEYWORDS = (
    "carta",
    "bancomat",
    "pos",
    "elettron",
    "credito",
    "satispay",
    "pagobancomat",
    "bancontact",
    "nexi",
    "sumup",
    "stripe",
    "contactless",
    "debit",
    "visa",
    "mastercard",
    "maestro",
    "vpay",
    "amex",
)
OTHER_KEYWORDS = (
    "assegno",
    "bonifico",
    "buono",
    "ticket",
    "sospeso",
    "credito",
    "finanzi",
    "nota credito",
)
QUOTE_KEYWORDS = (
    "quote",
    "preventiv",
    "non fiscal",
    "non_fiscal",
    "vea",
    "proforma",
    "preconto",
)

# Tipi già risolti che non vanno riclassificati su unknown.
PRESERVE_PAYMENT_TYPES = frozenset({"cash", "card", "mixed", "other", "quote", "non_fiscal", "vea", "preventivo"})



def _norm_text(value: Any) -> str:
    return str(value or "").strip().lower()


def label_suggests_cash(label: str) -> bool:
    low = _norm_text(label)
    return any(k in low for k in CASH_KEYWORDS)


def label_suggests_card(label: str) -> bool:
    low = _norm_text(label)
    return any(k in low for k in CARD_KEYWORDS)


def label_suggests_other(label: str) -> bool:
    low = _norm_text(label)
    return any(k in low for k in OTHER_KEYWORDS)


def label_suggests_quote(label: str) -> bool:
    low = _norm_text(label)
    return any(k in low for k in QUOTE_KEYWORDS)


def classify_payment(
    *,
    cash_amount: Optional[Decimal] = None,
    card_amount: Optional[Decimal] = None,
    total_amount: Optional[Decimal] = None,
    label: Optional[str] = None,
    type_code: Any = None,
) -> Tuple[str, Optional[Decimal], Optional[Decimal]]:
    """Ritorna (payment_type, cash_amount_eur, card_amount_eur)."""
    cash = Decimal(str(cash_amount or 0)).quantize(Decimal("0.01"))
    card = Decimal(str(card_amount or 0)).quantize(Decimal("0.01"))
    total = None
    if total_amount is not None:
        total = Decimal(str(total_amount)).quantize(Decimal("0.01"))

    if cash > 0 and card > 0:
        return "mixed", cash, card
    if cash > 0:
        return "cash", cash, None
    if card > 0:
        return "card", None, card

    label_text = _norm_text(label)
    code_text = _norm_text(type_code)
    hint = " ".join(x for x in (label_text, code_text) if x).strip()

    if hint:
        if label_suggests_quote(hint):
            return "quote", None, None
        if label_suggests_cash(hint) and not label_suggests_card(hint):
            amt = total if total and total > 0 else None
            return "cash", amt, None
        if label_suggests_card(hint) and not label_suggests_cash(hint):
            amt = total if total and total > 0 else None
            return "card", None, amt
        if label_suggests_other(hint):
            return "other", None, None

    if total and total > 0:
        return "unknown", None, None
    return "unknown", None, None


def merge_payment_fields(row: Dict[str, Any]) -> Dict[str, Any]:
    """Normalizza campi pagamento su un dict scontrino."""
    existing_type = str(row.get("payment_type") or "").strip().lower()
    # VEA / preventivo: non riclassificare in unknown
    if existing_type in ("quote", "non_fiscal", "vea", "preventivo"):
        out = dict(row)
        out["payment_type"] = "quote"
        out["cash_amount_eur"] = None
        out["card_amount_eur"] = None
        raw_u = str(out.get("payment_raw") or "").strip().upper()
        if not out.get("payment_label"):
            out["payment_label"] = (
                "Preventivo" if raw_u == "PREVENTIVO" else "Non fiscale (VEA)"
            )
        if not out.get("payment_raw"):
            out["payment_raw"] = "VEA"
        return out

    cash_raw = row.get("cash_amount_eur")
    card_raw = row.get("card_amount_eur")
    amount = row.get("amount_eur")
    ptype, cash, card = classify_payment(
        cash_amount=cash_raw,
        card_amount=card_raw,
        total_amount=amount,
        label=row.get("payment_label"),
        type_code=row.get("payment_raw"),
    )
    # Se il chiamante ha già un tipo valido e classify torna unknown, preserva
    if ptype == "unknown" and existing_type in PRESERVE_PAYMENT_TYPES:
        ptype = existing_type
    out = dict(row)
    out["payment_type"] = ptype
    if cash is not None:
        out["cash_amount_eur"] = cash
    elif cash_raw is None:
        out["cash_amount_eur"] = None
    if card is not None:
        out["card_amount_eur"] = card
    elif card_raw is None:
        out["card_amount_eur"] = None
    return out
