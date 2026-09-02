"""Codici accesso personale predefiniti per locali noti (chiave = _locale_name_key)."""

from typing import Optional, Set

from .prima_nota_staff_locale import _locale_name_key

# Via Lattea / Mucche Volanti — personale postazione operativa Abba 44
DEFAULT_STAFF_LOCALE_ACCESS_CODES = {
    _locale_name_key("La Via Lattea"): "910689",
    _locale_name_key("Mucche Volanti"): "910689",
}

# Codice ritirato (non più accettato).
RETIRED_STAFF_LOCALE_ACCESS_CODES = frozenset({"050408"})


def _normalize_code(code: Optional[str]) -> str:
    digits = "".join(ch for ch in str(code or "") if ch.isdigit())
    return digits if len(digits) == 6 else ""


def default_access_code_for_locale(locale_name: Optional[str]) -> str:
    key = _locale_name_key(locale_name)
    return DEFAULT_STAFF_LOCALE_ACCESS_CODES.get(key, "")


def allowed_access_codes_for_locale(locale_name: Optional[str], stored_code: Optional[str] = None) -> Set[str]:
    """Codici validi: DB + predefinito (es. Via Lattea 910689)."""
    key = _locale_name_key(locale_name)
    allowed: Set[str] = set()
    stored = _normalize_code(stored_code)
    if stored and stored not in RETIRED_STAFF_LOCALE_ACCESS_CODES:
        allowed.add(stored)
    default = _normalize_code(default_access_code_for_locale(locale_name))
    if default:
        allowed.add(default)
    allowed.difference_update(RETIRED_STAFF_LOCALE_ACCESS_CODES)
    return allowed
