"""Catalogo locali POS + resolve_store (senza dipendenze DB).

Usato dall'agent GDB sul PC cassa e da pos_receipts_service sul server.
"""

from __future__ import annotations

import re
from typing import Optional, Tuple

SOURCE_EASYRETAIL = "easyretail"
SOURCE_POSTE = "poste"

# Sedi Mani in Pasta senza VNE: incasso da scontrini EasyRetail (Via Abba).
POS_REVENUE_STORE_KEYS = frozenset({"via_abba", "abba", "model-2"})
POS_REVENUE_MODEL_ID = "model-2"
MANI_LOC_ZANARDELLI = "via_zanardelli"
MANI_LOC_ABBA = "via_abba"
MANI_LOCATION_IDS = frozenset({MANI_LOC_ZANARDELLI, MANI_LOC_ABBA})

# Locali analitica solo POS (niente macchina VNE). API Poste da collegare in seguito.
GAZZA_LADRA_MODEL_ID = "model-4"
GAZZA_LADRA_STORE_KEYS = frozenset({"gazza_ladra", "gazza", "model-4"})
POS_ONLY_MODEL_IDS = frozenset({GAZZA_LADRA_MODEL_ID})

# Allineato ai modelli VNE in routers/vne.py + locali solo-POS
POS_STORE_CATALOG = [
    {
        "model_id": "model-1",
        "model_label": "La Risacca",
        "store_key": "model-1",
        "aliases": ("risacca", "la risacca", "model-1", "model1", "1"),
    },
    {
        "model_id": "model-2",
        "model_label": "Mani in Pasta",
        "store_key": "model-2",
        "aliases": (
            "mani",
            "pasta",
            "mani in pasta",
            "lemaninpasta",
            "le mani in pasta",
            "model-2",
            "model2",
            "2",
        ),
    },
    {
        "model_id": "model-2",
        "model_label": "Mani in Pasta (Via Abba)",
        "store_key": "via_abba",
        "aliases": (
            "abba",
            "via abba",
            "mani in pasta abba",
            "mani_in_pasta_abba",
        ),
    },
    {
        "model_id": "model-2",
        "model_label": "Mani in Pasta (Via Zanardelli)",
        "store_key": "via_zanardelli",
        "aliases": (
            "zanardelli",
            "via zanardelli",
            "mani in pasta zanardelli",
            "mani_in_pasta_z_delli",
        ),
    },
    {
        "model_id": "model-3",
        "model_label": "Le Mucche Volanti",
        "store_key": "model-3",
        "aliases": (
            "mucche",
            "volanti",
            "le mucche",
            "le mucche volanti",
            "via lattea",
            "lattea",
            "model-3",
            "model3",
            "3",
            "momento",
        ),
    },
    {
        "model_id": GAZZA_LADRA_MODEL_ID,
        "model_label": "Gazza Ladra",
        "store_key": "gazza_ladra",
        "pos_provider": "poste",
        "aliases": (
            "gazza",
            "gazza ladra",
            "la gazza ladra",
            "gazzaladra",
            "model-4",
            "model4",
            "4",
            "poste",
        ),
    },
]


def analytics_pos_only_locales():
    """Locali presenti in Dashboard Analitica senza macchina VNE."""
    return [
        {
            "model_id": GAZZA_LADRA_MODEL_ID,
            "model_label": "Gazza Ladra",
            "store_key": "gazza_ladra",
            "pos_provider": "poste",
            "revenue_note": "Incasso da scontrini POS Poste (API da collegare)",
            "store_keys": tuple(GAZZA_LADRA_STORE_KEYS),
        }
    ]


def _catalog_by_model_id(model_id: str) -> Optional[dict]:
    mid = (model_id or "").strip()
    if not mid:
        return None
    exact = [x for x in POS_STORE_CATALOG if x["model_id"] == mid and x.get("store_key") == mid]
    if exact:
        return exact[0]
    # Prefer entry with store_key matching model for POS-only (gazza_ladra vs model-4)
    preferred = [x for x in POS_STORE_CATALOG if x["model_id"] == mid]
    if not preferred:
        return None
    for item in preferred:
        if item.get("store_key") and item["store_key"] not in ("model-1", "model-2", "model-3"):
            if item["model_id"] == mid:
                # For gazza, prefer gazza_ladra store_key entry
                if mid == GAZZA_LADRA_MODEL_ID and item.get("store_key") == "gazza_ladra":
                    return item
    return preferred[0]


def _norm_header(h: str) -> str:
    s = str(h or "").strip().lower()
    s = s.replace("à", "a").replace("è", "e").replace("é", "e").replace("ì", "i").replace("ò", "o").replace("ù", "u")
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def resolve_store(raw: str, fallback_model_id: Optional[str] = None) -> Tuple[str, Optional[str], str]:
    """Ritorna (store_key, model_id, model_label)."""
    text = str(raw or "").strip()
    key = _norm_header(text)
    if not key and fallback_model_id:
        hit = _catalog_by_model_id(fallback_model_id)
        if hit:
            return hit["store_key"], hit["model_id"], hit["model_label"]
    for item in POS_STORE_CATALOG:
        aliases = {_norm_header(a) for a in item["aliases"]}
        aliases.add(_norm_header(item["model_label"]))
        if key in aliases or any(a and a in key for a in aliases if len(a) >= 4):
            sk = item.get("store_key") or item["model_id"]
            return sk, item["model_id"], item["model_label"]
    if fallback_model_id:
        hit = _catalog_by_model_id(fallback_model_id)
        if hit:
            return hit["store_key"], hit["model_id"], hit["model_label"]
        fb = fallback_model_id.strip()
        return fb, fb, fb
    store_key = key or "unknown"
    return store_key, None if store_key == "unknown" else store_key, text or store_key
