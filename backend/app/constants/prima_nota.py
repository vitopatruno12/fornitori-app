"""Attività economiche con registro cassa separato in Prima Nota."""

import re

PRIMA_NOTA_ACTIVITIES = ("risacca", "via_lattea", "via_abba", "via_zanardelli")
DEFAULT_PRIMA_NOTA_ACTIVITY = "risacca"
LEGACY_ACTIVITY_ALIASES = {"mediazione": "via_abba"}
ACTIVITY_SLUG_PATTERN = re.compile(r"^[a-z0-9_]{1,32}$")


def is_valid_activity_slug(activity: str) -> bool:
    return bool(ACTIVITY_SLUG_PATTERN.match(activity or ""))
