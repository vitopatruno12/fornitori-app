"""Codici accesso personale predefiniti per locali noti (chiave = _locale_name_key)."""

from typing import Optional

from .prima_nota_staff_locale import _locale_name_key

# Via Lattea / Mucche Volanti — personale postazione operativa Abba 44
DEFAULT_STAFF_LOCALE_ACCESS_CODES = {
    _locale_name_key("La Via Lattea"): "050408",
    _locale_name_key("Mucche Volanti"): "050408",
}


def default_access_code_for_locale(locale_name: Optional[str]) -> str:
    key = _locale_name_key(locale_name)
    return DEFAULT_STAFF_LOCALE_ACCESS_CODES.get(key, "")
