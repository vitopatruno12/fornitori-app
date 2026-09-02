"""Codici accesso personale predefiniti per locali noti (chiave = _locale_name_key)."""

from typing import Optional, Set

from .prima_nota_staff_locale import _locale_name_key

# Via Lattea / Mucche Volanti — personale postazione operativa Abba 44
DEFAULT_STAFF_LOCALE_ACCESS_CODES = {
    _locale_name_key("La Via Lattea"): "050408",
    _locale_name_key("Mucche Volanti"): "050408",
}

# Codici vecchi ancora accettati (cache browser / postazioni non aggiornate).
LEGACY_STAFF_LOCALE_ACCESS_CODES = {
    _locale_name_key("La Via Lattea"): frozenset({"910689"}),
    _locale_name_key("Mucche Volanti"): frozenset({"910689"}),
}


def _normalize_code(code: Optional[str]) -> str:
    digits = "".join(ch for ch in str(code or "") if ch.isdigit())
    return digits if len(digits) == 6 else ""


def default_access_code_for_locale(locale_name: Optional[str]) -> str:
    key = _locale_name_key(locale_name)
    return DEFAULT_STAFF_LOCALE_ACCESS_CODES.get(key, "")


def allowed_access_codes_for_locale(locale_name: Optional[str], stored_code: Optional[str] = None) -> Set[str]:
    """Codici validi: DB + predefinito + legacy (es. Via Lattea 050408 e 910689)."""
    key = _locale_name_key(locale_name)
    allowed: Set[str] = set()
    stored = _normalize_code(stored_code)
    if stored:
        allowed.add(stored)
    default = _normalize_code(default_access_code_for_locale(locale_name))
    if default:
        allowed.add(default)
    allowed.update(LEGACY_STAFF_LOCALE_ACCESS_CODES.get(key, ()))
    return allowed
