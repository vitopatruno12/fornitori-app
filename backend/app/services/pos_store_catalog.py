"""Catalogo locali POS + resolve_store (senza dipendenze DB).

Usato dall'agent GDB sul PC cassa e da pos_receipts_service sul server.

Mapping agent EasyRetail:
  model-1 = La Risacca
  model-2 = Mani in Pasta Via Abba
  model-3 = Le Mucche Volanti (Via Lattea)
  model-4 = Mani in Pasta Via Zanardelli
  model-5 = Gazza Ladra (POS Poste)
"""

from __future__ import annotations

import re
from typing import Optional, Tuple

SOURCE_EASYRETAIL = "easyretail"
SOURCE_POSTE = "poste"

# Via Abba — EasyRetail agent (model-2)
POS_REVENUE_STORE_KEYS = frozenset({"via_abba", "abba", "model-2"})
POS_REVENUE_ABBA_KEYS = frozenset({"via_abba", "abba", "model-2"})
POS_REVENUE_MODEL_ID = "model-2"
MANI_LOC_ZANARDELLI = "via_zanardelli"
MANI_LOC_ABBA = "via_abba"
MANI_LOCATION_IDS = frozenset({MANI_LOC_ZANARDELLI, MANI_LOC_ABBA})

# Via Zanardelli — EasyRetail agent (model-4)
ZANARDELLI_MODEL_ID = "model-4"
ZANARDELLI_STORE_KEYS = frozenset({"via_zanardelli", "zanardelli", "model-4"})

# Gazza Ladra — solo POS (API Poste in seguito)
GAZZA_LADRA_MODEL_ID = "model-5"
GAZZA_LADRA_STORE_KEYS = frozenset({"gazza_ladra", "gazza", "model-5"})

# Locali analitica senza macchina VNE (solo scontrini / POS)
POS_ONLY_MODEL_IDS = frozenset({ZANARDELLI_MODEL_ID, GAZZA_LADRA_MODEL_ID})

POS_STORE_CATALOG = [
    {
        "model_id": "model-1",
        "model_label": "La Risacca",
        "store_key": "model-1",
        "aliases": ("risacca", "la risacca", "model-1", "model1"),
    },
    {
        "model_id": "model-2",
        "model_label": "Mani in Pasta (Via Abba)",
        "store_key": "via_abba",
        "aliases": (
            "abba",
            "via abba",
            "mani in pasta",
            "mani in pasta abba",
            "mani_in_pasta_abba",
            "lemaninpasta",
            "le mani in pasta",
            "model-2",
            "model2",
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
            "momento",
        ),
    },
    {
        "model_id": ZANARDELLI_MODEL_ID,
        "model_label": "Mani in Pasta (Via Zanardelli)",
        "store_key": "via_zanardelli",
        "aliases": (
            "zanardelli",
            "via zanardelli",
            "mani in pasta zanardelli",
            "mani_in_pasta_z_delli",
            "model-4",
            "model4",
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
            "model-5",
            "model5",
            "poste",
        ),
    },
]


def analytics_pos_only_locales():
    """Locali senza macchina VNE (Zanardelli + Gazza)."""
    return [
        {
            "model_id": ZANARDELLI_MODEL_ID,
            "model_label": "Mani in Pasta (Via Zanardelli)",
            "store_key": "via_zanardelli",
            "pos_provider": "easyretail",
            "revenue_note": "Incasso da scontrini EasyRetail (agent PC cassa)",
            "store_keys": tuple(ZANARDELLI_STORE_KEYS),
        },
        {
            "model_id": GAZZA_LADRA_MODEL_ID,
            "model_label": "Gazza Ladra",
            "store_key": "gazza_ladra",
            "pos_provider": "poste",
            "revenue_note": "Incasso da scontrini POS Poste (API da collegare)",
            "store_keys": tuple(GAZZA_LADRA_STORE_KEYS),
        },
    ]


def analytics_dashboard_locales():
    """I 5 locali della Dashboard Analitica (solo flussi agent / POS, niente VNE)."""
    return [
        {
            "model_id": "model-1",
            "model_label": "La Risacca",
            "store_key": "model-1",
            "pos_provider": "easyretail",
            "revenue_note": "Incasso da scontrini EasyRetail (agent PC cassa)",
            "store_keys": ("model-1", "risacca"),
        },
        {
            "model_id": POS_REVENUE_MODEL_ID,
            "model_label": "Mani in Pasta (Via Abba)",
            "store_key": "via_abba",
            "pos_provider": "easyretail",
            "revenue_note": "Incasso da scontrini EasyRetail (agent PC cassa)",
            "store_keys": tuple(POS_REVENUE_ABBA_KEYS),
        },
        {
            "model_id": "model-3",
            "model_label": "Le Mucche Volanti (Via Lattea)",
            "store_key": "model-3",
            "pos_provider": "easyretail",
            "revenue_note": "Incasso da scontrini EasyRetail (agent PC cassa)",
            "store_keys": ("model-3", "via_lattea", "lattea", "mucche"),
        },
        *analytics_pos_only_locales(),
    ]


def _catalog_by_model_id(model_id: str) -> Optional[dict]:
    mid = (model_id or "").strip()
    if not mid:
        return None
    preferred = [x for x in POS_STORE_CATALOG if x["model_id"] == mid]
    if not preferred:
        return None
    if mid == ZANARDELLI_MODEL_ID:
        for item in preferred:
            if item.get("store_key") == "via_zanardelli":
                return item
    if mid == GAZZA_LADRA_MODEL_ID:
        for item in preferred:
            if item.get("store_key") == "gazza_ladra":
                return item
    if mid == POS_REVENUE_MODEL_ID:
        for item in preferred:
            if item.get("store_key") == "via_abba":
                return item
    exact = [x for x in preferred if x.get("store_key") == mid]
    return exact[0] if exact else preferred[0]


def _norm_header(h: str) -> str:
    s = str(h or "").strip().lower()
    s = s.replace("à", "a").replace("è", "e").replace("é", "e").replace("ì", "i").replace("ò", "o").replace("ù", "u")
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def resolve_store(raw: str, fallback_model_id: Optional[str] = None) -> Tuple[str, Optional[str], str]:
    """Ritorna (store_key, model_id, model_label).

    NUMEROPOS / codici cassa numerici (es. "4") NON sono model_id: se c'è
    fallback_model_id dell'agent, usa quello e non gli alias "1"/"2"/…
    """
    text = str(raw or "").strip()
    key = _norm_header(text)
    if not key and fallback_model_id:
        hit = _catalog_by_model_id(fallback_model_id)
        if hit:
            return hit["store_key"], hit["model_id"], hit["model_label"]
    # Codice postazione EasyRetail (solo cifre): non confondere con model-1..5
    if fallback_model_id and key.isdigit():
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
