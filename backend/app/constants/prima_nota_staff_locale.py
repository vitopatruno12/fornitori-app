"""Collegamento locali Prima Nota (slug activity) → locale Personale (nome)."""

from typing import Optional

# Nomi come in Personale (confronto tollerante spazi/trattini/maiuscole).
DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS = {
    "risacca": "Bar-momento",
    "via_zanardelli": "La mediazione via zanardelli",
    "via_abba": "Mediazione via abba",
    "via_lattea": "Mucche Volanti",
}

STAFF_LOCALE_MATCH_CANDIDATES = {
    "via_lattea": ("Mucche Volanti", "Le Mucche Volanti", "La Via Lattea"),
}

STAFF_LOCALE_SLUG_TOKENS = {
    "via_zanardelli": ("zanardelli",),
    "via_abba": ("abba",),
    "via_lattea": ("mucche", "volanti"),
    "risacca": ("risacca", "momento"),
}

STAFF_LOCALE_EXCLUDED_NAME_FRAGMENTS = {
    "via_lattea": ("abba", "zanardelli", "maninpasta", "maniinpasta", "mediazione"),
}


def _locale_name_key(value: Optional[str]) -> str:
    return "".join(str(value or "").strip().lower().replace("-", " ").replace("_", " ").split())


def staff_locale_link_for_activity(activity: Optional[str]) -> str:
    slug = str(activity or "").strip().lower()
    return DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS.get(slug, "")


def match_staff_locale_name(preferred: str, available_names: list, activity_slug: Optional[str] = None) -> str:
    slug = str(activity_slug or "").strip().lower()
    candidates = STAFF_LOCALE_MATCH_CANDIDATES.get(slug, (preferred,))
    seen = set()
    for candidate in candidates:
        key = _locale_name_key(candidate)
        if not key or key in seen:
            continue
        seen.add(key)
        for name in available_names:
            if _locale_name_key(name) == key:
                return str(name)
    tokens = STAFF_LOCALE_SLUG_TOKENS.get(slug, ())
    excluded = STAFF_LOCALE_EXCLUDED_NAME_FRAGMENTS.get(slug, ())
    if tokens:
        for name in available_names:
            row_key = _locale_name_key(name)
            if any(fragment in row_key for fragment in excluded):
                continue
            if all(token in row_key for token in tokens):
                return str(name)
    return preferred.strip()
