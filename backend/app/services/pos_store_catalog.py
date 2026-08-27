"""Catalogo locali POS + resolve_store (senza dipendenze DB).

Usato dall'agent GDB sul PC cassa e da pos_receipts_service sul server.
"""

from __future__ import annotations

import re
from typing import Optional, Tuple

SOURCE_EASYRETAIL = "easyretail"

# Allineato ai modelli VNE in routers/vne.py
POS_STORE_CATALOG = [
    {
        "model_id": "model-1",
        "model_label": "La Risacca",
        "aliases": ("risacca", "la risacca", "model-1", "model1", "1"),
    },
    {
        "model_id": "model-2",
        "model_label": "Mani in Pasta",
        "aliases": (
            "mani",
            "pasta",
            "mani in pasta",
            "lemaninpasta",
            "le mani in pasta",
            "model-2",
            "model2",
            "2",
            "abba",
            "via abba",
        ),
    },
    {
        "model_id": "model-3",
        "model_label": "Le Mucche Volanti",
        "aliases": (
            "mucche",
            "volanti",
            "le mucche",
            "le mucche volanti",
            "model-3",
            "model3",
            "3",
            "momento",
        ),
    },
]


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
        for item in POS_STORE_CATALOG:
            if item["model_id"] == fallback_model_id:
                return item["model_id"], item["model_id"], item["model_label"]
    for item in POS_STORE_CATALOG:
        aliases = {_norm_header(a) for a in item["aliases"]}
        aliases.add(_norm_header(item["model_label"]))
        aliases.add(item["model_id"])
        if key in aliases or any(a and a in key for a in aliases if len(a) >= 4):
            return item["model_id"], item["model_id"], item["model_label"]
    if fallback_model_id:
        for item in POS_STORE_CATALOG:
            if item["model_id"] == fallback_model_id:
                return item["model_id"], item["model_id"], item["model_label"]
    store_key = key or "unknown"
    return store_key, None if store_key == "unknown" else store_key, text or store_key
