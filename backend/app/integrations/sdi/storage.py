"""Salvataggio XML su disco sotto uploads/sdi/{anno}/{mese}/."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

_UPLOADS = Path(__file__).resolve().parent.parent.parent / "uploads"


def safe_xml_filename(dedupe_key: str) -> str:
    base = re.sub(r"[^a-f0-9]", "", dedupe_key.lower())[:32] or "invoice"
    return f"{base}.xml"


def save_sdi_xml(xml_bytes: bytes, dedupe_key: str) -> str:
    """
    Scrive il file e restituisce il path relativo alla cartella uploads (es. sdi/2026/05/abc.xml).
    """
    now = datetime.now(timezone.utc)
    name = safe_xml_filename(dedupe_key)
    rel = Path("sdi") / str(now.year) / f"{now.month:02d}" / name
    dest = _UPLOADS / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(xml_bytes)
    return str(rel).replace("\\", "/")
