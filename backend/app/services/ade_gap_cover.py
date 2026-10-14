"""Mesi di fatture ricevute troppo vuoti nell'ultimo trimestre.

Lo scarico ordinario copre gli ultimi giorni. Si guarda solo il trimestre
già chiuso: se quei tre mesi sono pieni, non si torna indietro. Se uno
è quasi vuoto, la richiesta parte da quel mese.
"""
from __future__ import annotations

import json
import os
import statistics
import urllib.request
from datetime import date, timedelta
from typing import Dict, Optional

PROFILE_COMPANIES = {
    "mediazione": ("mediazione_a", "mediazione_z"),
    "via_lattea": ("via_lattea",),
    "risacca": ("risacca",),
    "pg": ("pg",),
}

_CACHE: Optional[Dict[str, Dict[str, int]]] = None


def _quarter_months(today: date) -> list:
    """Tre mesi completi prima del mese in corso."""
    cursor = date(today.year, today.month, 1)
    months = []
    for _ in range(3):
        cursor = date(cursor.year, cursor.month, 1) - timedelta(days=1)
        months.append(date(cursor.year, cursor.month, 1))
    months.reverse()
    return months


def earliest_hole_start(counts: Dict[str, int], *, today: date) -> Optional[date]:
    """Primo giorno del mese vuoto nel trimestre già chiuso.

    I mesi più vecchi non si ricontrollano. Un mese del trimestre è vuoto
    se ha meno del 20% della mediana dei mesi pieni (sotto 8 fatture non
    conta come pieno). Se il trimestre è pieno, si resta sul periodo breve.
    """
    months = [(day, int(counts.get(f"{day.year:04d}-{day.month:02d}") or 0)) for day in _quarter_months(today)]
    full = [count for _day, count in months if count >= 8]
    if not full:
        return months[0][0]
    floor = max(8, int(statistics.median(full) * 0.20))
    for day, count in months:
        if count < floor:
            return day
    return None


def month_counts_by_company(api_base: str) -> Dict[str, Dict[str, int]]:
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    base = (api_base or "https://www.atlass.it/api").rstrip("/")
    url = f"{base}/sdi/invoices/received?days=365"
    with urllib.request.urlopen(url, timeout=120) as res:
        payload = json.loads(res.read().decode("utf-8"))
    out: Dict[str, Dict[str, int]] = {}
    companies = payload.get("companies") if isinstance(payload, dict) else None
    if not isinstance(companies, dict):
        companies = {}
    for company, items in companies.items():
        bucket: Dict[str, int] = {}
        for row in items or []:
            month = str((row or {}).get("invoice_date") or "")[:7]
            if len(month) == 7:
                bucket[month] = bucket.get(month, 0) + 1
        out[str(company)] = bucket
    _CACHE = out
    return out


def cover_from_for_profile(profile_id: str, today: date, *, api_base: str = "") -> Optional[date]:
    """Inizio periodo se a quel profilo manca un mese. None se la copertura regge."""
    flag = (os.getenv("ADE_GAP_COVER") or "1").strip().lower()
    if flag in ("0", "false", "no", "off"):
        return None
    companies = PROFILE_COMPANIES.get((profile_id or "").strip().lower())
    if not companies:
        return None
    base = api_base or (os.getenv("ATLAS_API_BASE") or "https://www.atlass.it/api")
    try:
        by_company = month_counts_by_company(base)
    except Exception:
        return None
    merged: Dict[str, int] = {}
    for company in companies:
        for month, count in (by_company.get(company) or {}).items():
            merged[month] = merged.get(month, 0) + int(count)
    return earliest_hole_start(merged, today=today)
