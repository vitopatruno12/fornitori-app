"""Collegamento locali Prima Nota (slug activity) → locale Personale (nome)."""

from typing import Optional

# Nomi come in Personale (confronto tollerante spazi/trattini/maiuscole).
DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS = {
    "risacca": "Bar-momento",
    "via_zanardelli": "La mediazione via zanardelli",
    "via_abba": "Mediazione via abba",
    "via_lattea": "La Via Lattea",
}


def _locale_name_key(value: Optional[str]) -> str:
    return "".join(str(value or "").strip().lower().replace("-", " ").replace("_", " ").split())


def staff_locale_link_for_activity(activity: Optional[str]) -> str:
    slug = str(activity or "").strip().lower()
    return DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS.get(slug, "")


def match_staff_locale_name(preferred: str, available_names: list) -> str:
    key = _locale_name_key(preferred)
    if not key:
        return ""
    for name in available_names:
        if _locale_name_key(name) == key:
            return str(name)
    return preferred.strip()
