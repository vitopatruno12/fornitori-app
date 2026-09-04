"""Analytics / BI: vendite e traffico da macchine VNE (operazioni + chiusure cassa)."""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from ..routers.vne import VneAnalyticsEvent, collect_analytics_events
from .pos_store_catalog import (
    GAZZA_LADRA_MODEL_ID,
    GAZZA_LADRA_STORE_KEYS,
    MANI_LOC_ABBA,
    MANI_LOC_ZANARDELLI,
    MANI_LOCATION_IDS,
    POS_ONLY_MODEL_IDS,
    POS_REVENUE_MODEL_ID,
    ZANARDELLI_MODEL_ID,
    ZANARDELLI_STORE_KEYS,
    analytics_dashboard_locales,
    analytics_pos_only_locales,
)

BUSINESS_HOURS = list(range(8, 23))  # 08–22
WEEKDAY_LABELS_IT = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"]
MONTH_LABELS_IT = [
    "Gen",
    "Feb",
    "Mar",
    "Apr",
    "Mag",
    "Giu",
    "Lug",
    "Ago",
    "Set",
    "Ott",
    "Nov",
    "Dic",
]

_CACHE: Dict[str, Tuple[float, Any]] = {}
_CACHE_TTL_SEC = float(__import__("os").getenv("ANALYTICS_CACHE_TTL_SEC", "1200"))
DATA_NOTE = (
    "Incassi e pagamenti (contanti vs carta/POS) solo da scontrini agent sulle casse "
    "(EasyRetail) e POS Poste — la Dashboard Analitica non legge più le VNE. "
    "Visite = numero scontrini. Cinque locali: Risacca, Abba, Mucche, Zanardelli, Gazza Ladra."
)


def _pos_bucket_hit(buckets, scope_key: str, wd: int, hr: int) -> Optional[Dict[str, Any]]:
    if not buckets:
        return None
    return buckets.get((scope_key, wd, hr)) or buckets.get(("all", wd, hr))


def _load_pos_heatmap_buckets(
    date_from: date,
    date_to: date,
    model_id: Optional[str] = None,
) -> Dict[Tuple[str, int, int], Dict[str, float]]:
    try:
        from ..database import SessionLocal
        from .pos_receipts_service import load_pos_visit_buckets
    except Exception:
        return {}

    db = SessionLocal()
    try:
        return load_pos_visit_buckets(db, date_from=date_from, date_to=date_to, model_id=model_id)
    except Exception:
        return {}
    finally:
        db.close()


def _recalculate_heatmap_cells(cells: List[dict]) -> tuple[List[dict], float, float, List[dict]]:
    max_avg = 0.0
    max_avg_visits = 0.0
    for cell in cells:
        max_avg = max(max_avg, float(cell.get("avg_amount") or 0))
        max_avg_visits = max(max_avg_visits, float(cell.get("avg_visits") or 0))

    for cell in cells:
        avg = float(cell.get("avg_amount") or 0)
        avg_v = float(cell.get("avg_visits") or 0)
        intensity = 0.0 if max_avg <= 0 else avg / max_avg
        visit_intensity = 0.0 if max_avg_visits <= 0 else avg_v / max_avg_visits
        cell["intensity"] = round(intensity, 3)
        cell["visit_intensity"] = round(visit_intensity, 3)
        cell["operatori_consigliati"] = _intensity_to_operators(avg, max_avg)
        if intensity >= 0.75:
            cell["level"] = "alto"
        elif intensity >= 0.4:
            cell["level"] = "medio"
        elif intensity > 0:
            cell["level"] = "basso"
        else:
            cell["level"] = "nullo"

    ranked = sorted(cells, key=lambda c: float(c.get("avg_amount") or 0), reverse=True)
    top = [c for c in ranked if float(c.get("avg_amount") or 0) > 0][:12]
    suggestions = [
        {
            "weekday_label": c["weekday_label"],
            "slot_label": c["slot_label"],
            "operatori_consigliati": c["operatori_consigliati"],
            "avg_amount": c["avg_amount"],
            "message": (
                f"Consigliati {c['operatori_consigliati']} operator"
                f"{'i' if c['operatori_consigliati'] != 1 else 'e'} "
                f"{c['weekday_label'].lower()} {c['slot_label']}"
            ),
        }
        for c in top
    ]
    return cells, max_avg, max_avg_visits, suggestions


def _merge_pos_into_heatmap(
    heat: dict,
    *,
    date_from: date,
    date_to: date,
    model_id: Optional[str] = None,
) -> dict:
    """Mani in Pasta: somma visite/incassi POS (Abba) alle celle VNE (Zanardelli)."""
    mid = _parse_model_id(model_id) or POS_REVENUE_MODEL_ID
    buckets = _load_pos_heatmap_buckets(date_from, date_to, mid)
    if not buckets:
        return heat

    scope_key = mid
    cells = list(heat.get("cells") or [])
    merged = 0
    for cell in cells:
        wd = int(cell.get("weekday") or 0)
        hr = int(cell.get("hour") or 0)
        hit = _pos_bucket_hit(buckets, scope_key, wd, hr)
        if not hit:
            continue
        pos_avg_visits = float(hit.get("avg_visits") or 0)
        pos_visits = float(hit.get("visits") or 0)
        pos_days = max(1.0, float(hit.get("sample_days") or 1))
        pos_avg_amount = float(hit.get("amount") or 0) / pos_days
        vne_avg_visits = float(cell.get("avg_visits") or 0)
        vne_avg_amount = float(cell.get("avg_amount") or 0)
        had_vne = vne_avg_visits > 0 or vne_avg_amount > 0
        had_pos = pos_avg_visits > 0 or pos_avg_amount > 0
        if not had_pos:
            continue
        cell["avg_visits"] = round(vne_avg_visits + pos_avg_visits, 2)
        cell["movimenti"] = int(cell.get("movimenti") or 0) + int(round(pos_visits))
        cell["avg_amount"] = _dec(vne_avg_amount + pos_avg_amount)
        cell["total_amount"] = _dec(float(cell.get("total_amount") or 0) + float(hit.get("amount") or 0))
        cell["sample_days"] = int(max(float(cell.get("sample_days") or 1), pos_days))
        if had_vne and had_pos:
            cell["visit_source"] = "vne+pos"
        elif had_pos:
            cell["visit_source"] = "pos"
        merged += 1

    if merged <= 0:
        return heat

    cells, max_avg, max_avg_visits, suggestions = _recalculate_heatmap_cells(cells)
    heat["cells"] = cells
    heat["suggestions"] = suggestions
    heat["max_avg_amount"] = _dec(max_avg)
    heat["max_avg_visits"] = round(max_avg_visits, 2)
    heat["visits_source"] = "vne+pos"
    note = str(heat.get("data_note") or "")
    if "VNE + scontrini" not in note:
        heat["data_note"] = (
            (note + " ").strip()
            + " Orari di punta: VNE Via Zanardelli + scontrini Via Abba."
        ).strip()
    return heat


def _merge_pos_into_peak_buckets(
    bucket_amount: Dict[Tuple[int, int], Decimal],
    bucket_count: Dict[Tuple[int, int], int],
    *,
    date_from: date,
    date_to: date,
    weekday: int,
) -> None:
    """Aggiunge scontrini Abba ai bucket orari del picco previsto (oggi)."""
    buckets = _load_pos_heatmap_buckets(date_from, date_to, POS_REVENUE_MODEL_ID)
    if not buckets:
        return
    for hr in BUSINESS_HOURS:
        hit = _pos_bucket_hit(buckets, POS_REVENUE_MODEL_ID, weekday, hr)
        if not hit:
            continue
        pos_days = max(1.0, float(hit.get("sample_days") or 1))
        pos_avg_visits = float(hit.get("avg_visits") or 0)
        pos_avg_amount = float(hit.get("amount") or 0) / pos_days
        if pos_avg_visits <= 0 and pos_avg_amount <= 0:
            continue
        bucket_count[(weekday, hr)] = bucket_count.get((weekday, hr), 0) + int(round(pos_avg_visits))
        bucket_amount[(weekday, hr)] = _dec(float(bucket_amount.get((weekday, hr), 0)) + pos_avg_amount)


def _apply_pos_visits(
    heat: dict,
    *,
    date_from: date,
    date_to: date,
    model_id: Optional[str] = None,
    merge: bool = False,
) -> dict:
    """Arricchisce heatmap con scontrini POS. merge=True somma VNE+POS (Mani in Pasta)."""
    if merge and (_parse_model_id(model_id) or "") in ("", POS_REVENUE_MODEL_ID):
        return _merge_pos_into_heatmap(heat, date_from=date_from, date_to=date_to, model_id=model_id)

    try:
        from ..database import SessionLocal
        from .pos_receipts_service import load_pos_visit_buckets
    except Exception:
        return heat

    db = SessionLocal()
    try:
        mid = _parse_model_id(model_id)
        buckets = load_pos_visit_buckets(db, date_from=date_from, date_to=date_to, model_id=mid)
    except Exception:
        return heat
    finally:
        db.close()

    if not buckets:
        return heat

    scope_key = mid or "all"
    cells = list(heat.get("cells") or [])
    max_avg_visits = 0.0
    used = 0
    for cell in cells:
        wd = int(cell.get("weekday") or 0)
        hr = int(cell.get("hour") or 0)
        hit = _pos_bucket_hit(buckets, scope_key, wd, hr)
        if not hit:
            continue
        cell["avg_visits"] = round(float(hit["avg_visits"]), 2)
        cell["movimenti"] = int(round(float(hit["visits"])))
        cell["sample_days"] = int(hit.get("sample_days") or cell.get("sample_days") or 1)
        cell["visit_source"] = "pos"
        max_avg_visits = max(max_avg_visits, float(hit["avg_visits"]))
        used += 1

    if used <= 0:
        return heat

    for cell in cells:
        avg_v = float(cell.get("avg_visits") or 0)
        cell["visit_intensity"] = round(0.0 if max_avg_visits <= 0 else avg_v / max_avg_visits, 3)

    heat["cells"] = cells
    heat["max_avg_visits"] = round(max_avg_visits, 2)
    heat["visits_source"] = "pos"
    note = str(heat.get("data_note") or "")
    if "EasyRetail" not in note:
        heat["data_note"] = (
            (note + " ").strip()
            + " Orari di punta da scontrini EasyRetail (registratore)."
        ).strip()
    return heat



def _dec(n: Any) -> Decimal:
    return Decimal(str(n or 0)).quantize(Decimal("0.01"))


def _slot_label(hour: int) -> str:
    return f"{hour:02d}:00–{(hour + 1) % 24:02d}:00"


def _intensity_to_operators(intensity: float, max_intensity: float) -> int:
    if max_intensity <= 0 or intensity <= 0:
        return 1
    ratio = intensity / max_intensity
    if ratio >= 0.85:
        return 4
    if ratio >= 0.65:
        return 3
    if ratio >= 0.35:
        return 2
    return 1


def _parse_model_id(model_id: Optional[str]) -> Optional[str]:
    if model_id is None or str(model_id).strip() in ("", "all", "*"):
        return None
    return str(model_id).strip()


def _parse_mani_location(location: Optional[str]) -> Optional[str]:
    loc = str(location or "").strip().lower()
    if not loc or loc in ("combined", "totale", "all", "entrambe"):
        return None
    if loc in (MANI_LOC_ZANARDELLI, "zanardelli"):
        return MANI_LOC_ZANARDELLI
    if loc in (MANI_LOC_ABBA, "abba", "model-2-abba"):
        return MANI_LOC_ABBA
    return None


def _revenue_mode_for(model_id: Optional[str], location: Optional[str] = None) -> str:
    """vne | pos | combined — locali EasyRetail usano solo agent cassa (pos)."""
    mid = _parse_model_id(model_id)
    if mid in POS_ONLY_MODEL_IDS:
        return "pos"
    # Risacca / Mucche / Abba: agent EasyRetail sul PC cassa
    if mid in ("model-1", "model-2", "model-3"):
        return "pos"
    return "vne"


def _should_load_pos(model_id: Optional[str], revenue_mode: str) -> bool:
    mid = _parse_model_id(model_id)
    if mid in POS_ONLY_MODEL_IDS:
        return True
    if mid in ("model-1", "model-2", "model-3"):
        return revenue_mode in ("combined", "pos")
    if mid not in (None, POS_REVENUE_MODEL_ID):
        return False
    return revenue_mode in ("combined", "pos")


def _pos_store_keys_for(model_id: Optional[str], location: Optional[str] = None) -> Optional[tuple]:
    mid = _parse_model_id(model_id)
    if mid == GAZZA_LADRA_MODEL_ID:
        return tuple(GAZZA_LADRA_STORE_KEYS)
    if mid == ZANARDELLI_MODEL_ID:
        return tuple(ZANARDELLI_STORE_KEYS)
    if mid == POS_REVENUE_MODEL_ID:
        from .pos_store_catalog import POS_REVENUE_ABBA_KEYS

        # Solo Via Abba: Zanardelli è scheda dedicata model-4
        loc = _parse_mani_location(location)
        if loc == MANI_LOC_ZANARDELLI:
            return tuple(ZANARDELLI_STORE_KEYS)
        return tuple(POS_REVENUE_ABBA_KEYS)
    if mid in ("model-1", "model-3"):
        return (mid,)
    return None


def _cache_get(key: str):
    hit = _CACHE.get(key)
    if not hit:
        return None
    ts, value = hit
    if (time.monotonic() - ts) > _CACHE_TTL_SEC:
        _CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any) -> Any:
    _CACHE[key] = (time.monotonic(), value)
    return value


def _load_events(
    *,
    date_from: date,
    date_to: date,
    model_id: Optional[str] = None,
    max_op_pages: int = 10,
    max_closing_pages: int = 6,
) -> tuple[List[VneAnalyticsEvent], List[str]]:
    mid = _parse_model_id(model_id)
    key = f"evt:{mid or 'all'}:{date_from.isoformat()}:{date_to.isoformat()}:{max_op_pages}:{max_closing_pages}"
    cached = _cache_get(key)
    if cached is not None:
        return cached
    events, warnings = collect_analytics_events(
        date_from=date_from,
        date_to=date_to,
        model_id=mid,
        max_op_pages=max_op_pages,
        max_closing_pages=max_closing_pages,
    )
    # Non mettere in cache risposte vuote con errori VNE (altrimenti restano 0 per ~20 min).
    if warnings and not events:
        return events, warnings
    return _cache_set(key, (events, warnings))


def _ops(events: List[VneAnalyticsEvent]) -> List[VneAnalyticsEvent]:
    return [e for e in events if e.source == "operation"]


def _closings(events: List[VneAnalyticsEvent]) -> List[VneAnalyticsEvent]:
    return [e for e in events if e.source == "closing"]


def _day_incasso(events: List[VneAnalyticsEvent], day: date) -> Decimal:
    """Preferisce somma chiusure del giorno; altrimenti somma valori operazioni."""
    clos = [e for e in _closings(events) if e.when.date() == day]
    if clos:
        return _dec(sum(e.amount for e in clos))
    ops = [e for e in _ops(events) if e.when.date() == day]
    return _dec(sum(e.amount for e in ops))


def _day_incasso_chiusure(events: List[VneAnalyticsEvent], day: date) -> Decimal:
    """Incasso giornata: solo chiusure cassa (nessun fallback sulle operazioni)."""
    clos = [e for e in _closings(events) if e.when.date() == day]
    return _dec(sum(e.amount for e in clos))


def _day_movimenti(events: List[VneAnalyticsEvent], day: date) -> int:
    return sum(1 for e in _ops(events) if e.when.date() == day)


def _pos_revenue_applies(model_id: Optional[str], revenue_mode: str = "combined") -> bool:
    return _should_load_pos(model_id, revenue_mode)


def _load_pos_daily_totals(
    date_from: date,
    date_to: date,
    model_id: Optional[str] = None,
    *,
    revenue_mode: str = "combined",
    store_keys: Optional[tuple] = None,
    location: Optional[str] = None,
) -> Dict[date, Dict[str, Any]]:
    """Incasso giornaliero da scontrini EasyRetail (agent PC cassa)."""
    if not _should_load_pos(model_id, revenue_mode):
        return {}
    try:
        from ..database import SessionLocal
        from .pos_receipts_service import load_pos_daily_incasso
    except Exception:
        return {}

    mid = _parse_model_id(model_id)
    loc = _parse_mani_location(location)
    if mid == POS_REVENUE_MODEL_ID and loc == MANI_LOC_ZANARDELLI:
        target_mid = ZANARDELLI_MODEL_ID
    elif mid in POS_ONLY_MODEL_IDS or mid in ("model-1", "model-2", "model-3"):
        target_mid = mid
    else:
        target_mid = POS_REVENUE_MODEL_ID
    keys = store_keys or _pos_store_keys_for(target_mid if target_mid != POS_REVENUE_MODEL_ID or loc else mid, location)

    # Totale Mani (Abba + Zanardelli): unisce model-2 e model-4
    if mid == POS_REVENUE_MODEL_ID and loc is None and revenue_mode == "combined":
        abba = _load_pos_daily_totals(
            date_from, date_to, POS_REVENUE_MODEL_ID, revenue_mode="pos", location=MANI_LOC_ABBA
        )
        zan = _load_pos_daily_totals(
            date_from, date_to, ZANARDELLI_MODEL_ID, revenue_mode="pos"
        )
        merged: Dict[date, Dict[str, Any]] = {}
        for src in (abba, zan):
            for day, hit in (src or {}).items():
                slot = merged.setdefault(
                    day,
                    {
                        "incasso": Decimal("0.00"),
                        "movimenti": 0,
                        "cash_eur": Decimal("0.00"),
                        "card_eur": Decimal("0.00"),
                    },
                )
                slot["incasso"] = _dec(slot["incasso"] + _dec(hit.get("incasso", 0)))
                slot["movimenti"] += int(hit.get("movimenti") or 0)
                slot["cash_eur"] = _dec(slot["cash_eur"] + _dec(hit.get("cash_eur", 0)))
                slot["card_eur"] = _dec(slot["card_eur"] + _dec(hit.get("card_eur", 0)))
        return merged

    db = SessionLocal()
    try:
        return load_pos_daily_incasso(
            db,
            date_from=date_from,
            date_to=date_to,
            model_id=target_mid,
            store_keys=keys,
        )
    except Exception:
        return {}
    finally:
        db.close()


def _pos_day_cash(pos_daily: Dict[date, Dict[str, Any]], day: date) -> Decimal:
    hit = (pos_daily or {}).get(day) or {}
    return _dec(hit.get("cash_eur", 0))


def _pos_day_card(pos_daily: Dict[date, Dict[str, Any]], day: date) -> Decimal:
    hit = (pos_daily or {}).get(day) or {}
    return _dec(hit.get("card_eur", 0))


def _payment_split_from_pos_daily(pos_daily: Dict[date, Dict[str, Any]]) -> dict:
    cash = Decimal("0.00")
    card = Decimal("0.00")
    receipts = 0
    for hit in (pos_daily or {}).values():
        cash += _dec(hit.get("cash_eur", 0))
        card += _dec(hit.get("card_eur", 0))
        receipts += int(hit.get("movimenti") or 0)
    return {
        "receipts": receipts,
        "cash_eur": cash,
        "card_eur": card,
        "amount_eur": _dec(cash + card),
    }


def _empty_peak_slot(today: date) -> dict:
    today_wd = today.weekday()
    now_hr = datetime.now().hour
    return {
        "picco_previsto": {
            "weekday": today_wd,
            "weekday_label": WEEKDAY_LABELS_IT[today_wd],
            "hour": 12,
            "slot_label": _slot_label(12),
            "avg_amount": Decimal("0.00"),
            "avg_movimenti": 0,
            "operatori_consigliati": 1,
            "message": "Picco da stimare quando arriveranno scontrini POS Poste.",
        },
        "fascia_corrente": {
            "hour": now_hr,
            "slot_label": _slot_label(now_hr) if now_hr in BUSINESS_HOURS else f"{now_hr:02d}:00",
            "operatori_consigliati": 1,
        },
    }


def _pos_day_incasso(pos_daily: Dict[date, Dict[str, Any]], day: date) -> Decimal:
    hit = pos_daily.get(day) or {}
    return _dec(hit.get("incasso", 0))


def _pos_day_movimenti(pos_daily: Dict[date, Dict[str, Any]], day: date) -> int:
    hit = pos_daily.get(day) or {}
    return int(hit.get("movimenti") or 0)


def _combined_day_incasso(
    events: List[VneAnalyticsEvent],
    day: date,
    pos_daily: Dict[date, Dict[str, Any]],
    *,
    closings_only: bool = False,
) -> Decimal:
    vne = _day_incasso_chiusure(events, day) if closings_only else _day_incasso(events, day)
    return _dec(vne + _pos_day_incasso(pos_daily, day))


def _combined_day_movimenti(
    events: List[VneAnalyticsEvent],
    day: date,
    pos_daily: Dict[date, Dict[str, Any]],
) -> int:
    return _day_movimenti(events, day) + _pos_day_movimenti(pos_daily, day)


def _revenue_source(model_id: Optional[str], pos_daily: Dict[date, Dict[str, Any]], revenue_mode: str = "combined") -> str:
    if revenue_mode == "pos":
        return "pos"
    if revenue_mode == "vne":
        return "vne"
    if _should_load_pos(model_id, "combined"):
        return "vne+pos"
    return "vne"


def _filter_events_for_model(events: List[VneAnalyticsEvent], model_id: Optional[str]) -> List[VneAnalyticsEvent]:
    mid = _parse_model_id(model_id)
    if not mid:
        return events
    return [e for e in events if e.model_id == mid]


def _snapshot_from_events(
    events: List[VneAnalyticsEvent],
    *,
    model_id: Optional[str],
    lookback_months: int,
    warnings: Optional[List[str]] = None,
    pos_daily: Optional[Dict[date, Dict[str, Any]]] = None,
    revenue_mode: str = "combined",
) -> dict:
    today = date.today()
    scoped = _filter_events_for_model(events, model_id)
    mid = _parse_model_id(model_id)
    use_pos = _should_load_pos(model_id, revenue_mode)
    pos_daily = pos_daily if use_pos else {}

    if revenue_mode == "pos":
        incasso_vne_oggi = Decimal("0.00")
        incasso_pos_oggi = _pos_day_incasso(pos_daily, today)
        incasso_oggi = incasso_pos_oggi
        movimenti_oggi = _pos_day_movimenti(pos_daily, today)
        bucket_amount: Dict[Tuple[int, int], Decimal] = defaultdict(lambda: Decimal("0.00"))
        bucket_count: Dict[Tuple[int, int], int] = defaultdict(int)
        hist_days = min(93, lookback_months * 31)
        date_from_peak = today - timedelta(days=hist_days - 1)
        peak_model = mid if mid in POS_ONLY_MODEL_IDS else POS_REVENUE_MODEL_ID
        pos_buckets = _load_pos_heatmap_buckets(date_from_peak, today, peak_model)
        today_wd_pre = today.weekday()
        for hr in BUSINESS_HOURS:
            hit = _pos_bucket_hit(pos_buckets, peak_model, today_wd_pre, hr)
            if not hit:
                continue
            pos_days = max(1.0, float(hit.get("sample_days") or 1))
            bucket_count[(today_wd_pre, hr)] = int(round(float(hit.get("avg_visits") or 0)))
            bucket_amount[(today_wd_pre, hr)] = _dec(float(hit.get("amount") or 0) / pos_days)
    else:
        incasso_vne_oggi = _day_incasso_chiusure(scoped, today)
        incasso_pos_oggi = _pos_day_incasso(pos_daily, today) if revenue_mode == "combined" else Decimal("0.00")
        incasso_oggi = _dec(incasso_vne_oggi + incasso_pos_oggi)
        movimenti_oggi = (
            _combined_day_movimenti(scoped, today, pos_daily)
            if revenue_mode == "combined"
            else _day_movimenti(scoped, today)
        )
        bucket_amount: Dict[Tuple[int, int], Decimal] = defaultdict(lambda: Decimal("0.00"))
        bucket_count: Dict[Tuple[int, int], int] = defaultdict(int)
        for e in _ops(scoped):
            wd, hr = e.when.weekday(), e.when.hour
            if hr not in BUSINESS_HOURS:
                continue
            bucket_amount[(wd, hr)] += _dec(max(e.amount, 0))
            bucket_count[(wd, hr)] += 1
        if revenue_mode == "combined" and mid == POS_REVENUE_MODEL_ID:
            hist_days = min(93, lookback_months * 31)
            date_from_peak = today - timedelta(days=hist_days - 1)
            _merge_pos_into_peak_buckets(
                bucket_amount,
                bucket_count,
                date_from=date_from_peak,
                date_to=today,
                weekday=today.weekday(),
            )

    today_wd = today.weekday()
    today_buckets = [
        (hr, float(bucket_amount.get((today_wd, hr), 0)), bucket_count.get((today_wd, hr), 0))
        for hr in BUSINESS_HOURS
    ]
    peak_hr, peak_amt, peak_cnt = max(today_buckets, key=lambda x: (x[1], x[2]), default=(12, 0.0, 0))
    max_amt = max((b[1] for b in today_buckets), default=0.0) or 1.0
    operators = _intensity_to_operators(peak_amt, max_amt)
    now_hr = datetime.now().hour
    current_amt = float(bucket_amount.get((today_wd, now_hr), 0))
    current_ops = _intensity_to_operators(current_amt, max_amt)

    machines = sorted({e.model_label for e in scoped})
    if mid == GAZZA_LADRA_MODEL_ID and "Gazza Ladra" not in machines:
        machines = ["Gazza Ladra"]
    label_prefix = (machines[0] if len(machines) == 1 else "oggi")
    pay_split = _payment_split_from_pos_daily(pos_daily) if use_pos else {
        "receipts": 0,
        "cash_eur": Decimal("0.00"),
        "card_eur": Decimal("0.00"),
        "amount_eur": Decimal("0.00"),
    }
    peak_message = (
        f"Picco previsto {label_prefix}: {WEEKDAY_LABELS_IT[today_wd].lower()} "
        f"{_slot_label(peak_hr)} · consigliati {operators} "
        f"operator{'i' if operators != 1 else 'e'}"
    )
    if mid == GAZZA_LADRA_MODEL_ID and peak_amt <= 0 and peak_cnt <= 0:
        peak_message = "Gazza Ladra: in attesa di scontrini POS Poste per stimare picchi e operatori."
    return {
        "date": today.isoformat(),
        "activity": mid or "all",
        "source": _revenue_source(model_id, pos_daily, revenue_mode),
        "revenue_source": _revenue_source(model_id, pos_daily, revenue_mode),
        "lookback_months": lookback_months,
        "incasso_oggi": incasso_oggi,
        "incasso_vne": incasso_vne_oggi,
        "incasso_pos": incasso_pos_oggi,
        "movimenti_oggi": movimenti_oggi,
        "totale_fiscale": Decimal("0.00"),
        "totale_pos": incasso_pos_oggi,
        "totale_non_fiscale": Decimal("0.00"),
        "payment_split": pay_split,
        "machines": machines,
        "warnings": list(warnings or []),
        "data_note": DATA_NOTE,
        "picco_previsto": {
            "weekday": today_wd,
            "weekday_label": WEEKDAY_LABELS_IT[today_wd],
            "hour": peak_hr,
            "slot_label": _slot_label(peak_hr),
            "avg_amount": _dec(peak_amt),
            "avg_movimenti": peak_cnt,
            "operatori_consigliati": operators,
            "message": peak_message,
        },
        "fascia_corrente": {
            "hour": now_hr,
            "slot_label": _slot_label(now_hr) if now_hr in BUSINESS_HOURS else f"{now_hr:02d}:00",
            "operatori_consigliati": current_ops if now_hr in BUSINESS_HOURS else 1,
        },
    }


def _weekly_from_events(
    events: List[VneAnalyticsEvent],
    *,
    weeks: int,
    model_id: Optional[str] = None,
    warnings: Optional[List[str]] = None,
    pos_daily: Optional[Dict[date, Dict[str, Any]]] = None,
    revenue_mode: str = "combined",
) -> dict:
    weeks = max(4, min(26, int(weeks or 12)))
    today = date.today()
    start_monday = today - timedelta(days=today.weekday()) - timedelta(weeks=weeks - 1)
    scoped = _filter_events_for_model(events, model_id)
    use_pos = _should_load_pos(model_id, revenue_mode)
    pos_daily = pos_daily if use_pos else {}
    rows = []
    for w in range(weeks):
        monday = start_monday + timedelta(weeks=w)
        sunday = monday + timedelta(days=6)
        end = min(sunday, today)
        incasso = Decimal("0.00")
        movimenti = 0
        cash = Decimal("0.00")
        card = Decimal("0.00")
        d = monday
        while d <= end:
            if revenue_mode == "pos":
                incasso += _pos_day_incasso(pos_daily, d)
                movimenti += _pos_day_movimenti(pos_daily, d)
            elif revenue_mode == "vne":
                incasso += _day_incasso(scoped, d)
                movimenti += _day_movimenti(scoped, d)
            else:
                incasso += _combined_day_incasso(scoped, d, pos_daily)
                movimenti += _combined_day_movimenti(scoped, d, pos_daily)
            cash += _pos_day_cash(pos_daily, d)
            card += _pos_day_card(pos_daily, d)
            d += timedelta(days=1)
        rows.append(
            {
                "week_start": monday.isoformat(),
                "week_end": end.isoformat(),
                "label": f"{monday.strftime('%d/%m')}–{end.strftime('%d/%m')}",
                "incasso": _dec(incasso),
                "movimenti": movimenti,
                "cash_eur": _dec(cash),
                "card_eur": _dec(card),
            }
        )
    return {
        "activity": _parse_model_id(model_id) or "all",
        "source": _revenue_source(model_id, pos_daily or {}, revenue_mode),
        "weeks": weeks,
        "total_incasso": _dec(sum((r["incasso"] for r in rows), Decimal("0.00"))),
        "payment_split": _payment_split_from_pos_daily(pos_daily or {}),
        "rows": rows,
        "warnings": list(warnings or []),
        "data_note": DATA_NOTE,
    }


def _heatmap_from_events(
    events: List[VneAnalyticsEvent],
    *,
    months: int,
    model_id: Optional[str] = None,
    warnings: Optional[List[str]] = None,
) -> dict:
    months = max(1, min(6, int(months or 3)))
    scoped = _filter_events_for_model(events, model_id)

    amount: Dict[Tuple[int, int], Decimal] = defaultdict(lambda: Decimal("0.00"))
    count: Dict[Tuple[int, int], int] = defaultdict(int)
    day_seen: Dict[Tuple[int, int], set] = defaultdict(set)

    for e in _ops(scoped):
        wd, hr = e.when.weekday(), e.when.hour
        if hr not in BUSINESS_HOURS:
            continue
        amount[(wd, hr)] += _dec(max(e.amount, 0))
        count[(wd, hr)] += 1
        day_seen[(wd, hr)].add(e.when.date().isoformat())

    cells = []
    max_avg = 0.0
    max_avg_visits = 0.0
    for wd in range(7):
        for hr in BUSINESS_HOURS:
            days_n = max(1, len(day_seen[(wd, hr)]))
            tot = float(amount[(wd, hr)])
            avg = tot / days_n
            avg_visits = count[(wd, hr)] / days_n
            max_avg = max(max_avg, avg)
            max_avg_visits = max(max_avg_visits, avg_visits)
            cells.append(
                {
                    "weekday": wd,
                    "weekday_label": WEEKDAY_LABELS_IT[wd],
                    "hour": hr,
                    "slot_label": _slot_label(hr),
                    "total_amount": _dec(tot),
                    "avg_amount": _dec(avg),
                    "movimenti": count[(wd, hr)],
                    "avg_visits": round(avg_visits, 2),
                    "sample_days": len(day_seen[(wd, hr)]),
                }
            )

    for cell in cells:
        avg = float(cell["avg_amount"])
        intensity = 0.0 if max_avg <= 0 else avg / max_avg
        visit_intensity = 0.0 if max_avg_visits <= 0 else float(cell["avg_visits"]) / max_avg_visits
        cell["intensity"] = round(intensity, 3)
        cell["visit_intensity"] = round(visit_intensity, 3)
        cell["operatori_consigliati"] = _intensity_to_operators(avg, max_avg)
        if intensity >= 0.75:
            cell["level"] = "alto"
        elif intensity >= 0.4:
            cell["level"] = "medio"
        elif intensity > 0:
            cell["level"] = "basso"
        else:
            cell["level"] = "nullo"

    ranked = sorted(cells, key=lambda c: float(c["avg_amount"]), reverse=True)
    top = [c for c in ranked if float(c["avg_amount"]) > 0][:12]
    suggestions = [
        {
            "weekday_label": c["weekday_label"],
            "slot_label": c["slot_label"],
            "operatori_consigliati": c["operatori_consigliati"],
            "avg_amount": c["avg_amount"],
            "message": (
                f"Consigliati {c['operatori_consigliati']} operator"
                f"{'i' if c['operatori_consigliati'] != 1 else 'e'} "
                f"{c['weekday_label'].lower()} {c['slot_label']}"
            ),
        }
        for c in top
    ]

    return {
        "activity": _parse_model_id(model_id) or "all",
        "source": "vne",
        "months": months,
        "hours": BUSINESS_HOURS,
        "weekdays": WEEKDAY_LABELS_IT,
        "max_avg_amount": _dec(max_avg),
        "max_avg_visits": round(max_avg_visits, 2),
        "cells": cells,
        "suggestions": suggestions,
        "machines": sorted({e.model_label for e in scoped if e.model_label}),
        "warnings": list(warnings or []),
        "data_note": DATA_NOTE,
    }


def _heatmap_from_pos_receipts(
    *,
    date_from: date,
    date_to: date,
    store_keys: tuple,
    months: int,
    warnings: Optional[List[str]] = None,
    model_id: Optional[str] = None,
    model_label: str = "Mani in Pasta (Via Abba)",
) -> dict:
    """Heatmap traffico/incasso da scontrini POS (Abba / Gazza Ladra)."""
    months = max(1, min(6, int(months or 3)))
    target_mid = _parse_model_id(model_id) or POS_REVENUE_MODEL_ID
    amount: Dict[Tuple[int, int], Decimal] = defaultdict(lambda: Decimal("0.00"))
    count: Dict[Tuple[int, int], int] = defaultdict(int)
    day_seen: Dict[Tuple[int, int], set] = defaultdict(set)

    try:
        from ..database import SessionLocal
        from .pos_receipts_service import load_pos_visit_buckets

        db = SessionLocal()
        try:
            buckets = load_pos_visit_buckets(
                db,
                date_from=date_from,
                date_to=date_to,
                model_id=target_mid,
                store_keys=store_keys,
            )
        finally:
            db.close()
        for (mid, wd, hr), hit in buckets.items():
            if mid == "all" or mid != target_mid:
                continue
            if hr not in BUSINESS_HOURS:
                continue
            visits = int(hit.get("visits") or 0)
            amt = Decimal(str(hit.get("amount") or 0))
            days_n = max(1, int(hit.get("sample_days") or 1))
            amount[(wd, hr)] += _dec(amt)
            count[(wd, hr)] += visits
            day_seen[(wd, hr)].add(f"d{days_n}")
    except Exception:
        buckets = {}

    cells = []
    max_avg = 0.0
    max_avg_visits = 0.0
    for wd in range(7):
        for hr in BUSINESS_HOURS:
            days_n = max(1, len(day_seen[(wd, hr)]))
            tot = float(amount[(wd, hr)])
            avg = tot / days_n
            avg_visits = count[(wd, hr)] / days_n
            max_avg = max(max_avg, avg)
            max_avg_visits = max(max_avg_visits, avg_visits)
            cells.append(
                {
                    "weekday": wd,
                    "weekday_label": WEEKDAY_LABELS_IT[wd],
                    "hour": hr,
                    "slot_label": _slot_label(hr),
                    "total_amount": _dec(tot),
                    "avg_amount": _dec(avg),
                    "movimenti": count[(wd, hr)],
                    "avg_visits": round(avg_visits, 2),
                    "sample_days": len(day_seen[(wd, hr)]),
                }
            )

    for cell in cells:
        avg = float(cell["avg_amount"])
        intensity = 0.0 if max_avg <= 0 else avg / max_avg
        visit_intensity = 0.0 if max_avg_visits <= 0 else float(cell["avg_visits"]) / max_avg_visits
        cell["intensity"] = round(intensity, 3)
        cell["visit_intensity"] = round(visit_intensity, 3)
        cell["operatori_consigliati"] = _intensity_to_operators(avg, max_avg)
        if intensity >= 0.75:
            cell["level"] = "alto"
        elif intensity >= 0.4:
            cell["level"] = "medio"
        elif intensity > 0:
            cell["level"] = "basso"
        else:
            cell["level"] = "nullo"

    ranked = sorted(cells, key=lambda c: float(c["avg_amount"]), reverse=True)
    top = [c for c in ranked if float(c["avg_amount"]) > 0][:12]
    suggestions = [
        {
            "weekday_label": c["weekday_label"],
            "slot_label": c["slot_label"],
            "operatori_consigliati": c["operatori_consigliati"],
            "avg_amount": c["avg_amount"],
            "message": (
                f"Consigliati {c['operatori_consigliati']} operator"
                f"{'i' if c['operatori_consigliati'] != 1 else 'e'} "
                f"{c['weekday_label'].lower()} {c['slot_label']}"
            ),
        }
        for c in top
    ]

    return {
        "activity": target_mid,
        "source": "pos",
        "months": months,
        "hours": BUSINESS_HOURS,
        "weekdays": WEEKDAY_LABELS_IT,
        "max_avg_amount": _dec(max_avg),
        "max_avg_visits": round(max_avg_visits, 2),
        "cells": cells,
        "suggestions": suggestions,
        "machines": [model_label],
        "warnings": list(warnings or []),
        "data_note": DATA_NOTE,
        "visits_source": "pos",
    }


def _build_mani_location_view(
    events: List[VneAnalyticsEvent],
    pos_daily: Dict[date, Dict[str, Any]],
    *,
    location_id: str,
    location_label: str,
    revenue_mode: str,
    revenue_note: str,
    lookback_months: int,
    date_from: date,
    date_to: date,
    warnings: Optional[List[str]] = None,
) -> dict:
    from .pos_store_catalog import POS_REVENUE_STORE_KEYS

    m_events = [e for e in events if e.model_id == POS_REVENUE_MODEL_ID]
    m_warn = list(warnings or [])
    use_pos = pos_daily if revenue_mode in ("combined", "pos") else {}

    m_snap = _snapshot_from_events(
        m_events,
        model_id=POS_REVENUE_MODEL_ID,
        lookback_months=lookback_months,
        warnings=m_warn,
        pos_daily=use_pos,
        revenue_mode=revenue_mode,
    )
    m_snap["machines"] = [location_label]
    m_weekly = _weekly_from_events(
        m_events,
        weeks=8,
        model_id=POS_REVENUE_MODEL_ID,
        warnings=m_warn,
        pos_daily=use_pos,
        revenue_mode=revenue_mode,
    )
    if revenue_mode == "pos":
        m_heat = _heatmap_from_pos_receipts(
            date_from=date_from,
            date_to=date_to,
            store_keys=tuple(POS_REVENUE_STORE_KEYS),
            months=lookback_months,
            warnings=m_warn,
        )
    else:
        m_heat = _heatmap_from_events(
            m_events,
            months=lookback_months,
            model_id=POS_REVENUE_MODEL_ID,
            warnings=m_warn,
        )
        if revenue_mode == "combined":
            m_heat = _apply_pos_visits(
                m_heat,
                date_from=date_from,
                date_to=date_to,
                model_id=POS_REVENUE_MODEL_ID,
                merge=True,
            )

    return {
        "location_id": location_id,
        "location_label": location_label,
        "revenue_source": _revenue_source(POS_REVENUE_MODEL_ID, use_pos, revenue_mode),
        "revenue_note": revenue_note,
        "snapshot": m_snap,
        "weekly": m_weekly,
        "top_slots": m_heat["suggestions"][:5],
        "hours": m_heat["hours"],
        "weekdays": m_heat["weekdays"],
        "cells": m_heat["cells"],
        "visits_source": m_heat.get("visits_source") or ("pos" if revenue_mode == "pos" else "vne"),
    }


def _build_pos_only_machine_entry(
    *,
    locale: dict,
    lookback_months: int,
    date_from: date,
    date_to: date,
    pos_daily: Optional[Dict[date, Dict[str, Any]]] = None,
) -> dict:
    """Scheda analitica per locale (solo scontrini agent/POS, niente VNE)."""
    model_id = locale["model_id"]
    label = locale["model_label"]
    store_keys = tuple(locale.get("store_keys") or ())
    if pos_daily is None:
        pos_daily = _load_pos_daily_totals(
            date_from,
            date_to,
            model_id,
            revenue_mode="pos",
            store_keys=store_keys,
        )
    m_snap = _snapshot_from_events(
        [],
        model_id=model_id,
        lookback_months=lookback_months,
        warnings=[],
        pos_daily=pos_daily,
        revenue_mode="pos",
    )
    m_snap["machines"] = [label]
    m_weekly = _weekly_from_events(
        [],
        weeks=8,
        model_id=model_id,
        warnings=[],
        pos_daily=pos_daily,
        revenue_mode="pos",
    )
    m_heat = _heatmap_from_pos_receipts(
        date_from=date_from,
        date_to=date_to,
        store_keys=store_keys or tuple(GAZZA_LADRA_STORE_KEYS),
        months=lookback_months,
        warnings=[],
        model_id=model_id,
        model_label=label,
    )
    return {
        "model_id": model_id,
        "model_label": label,
        "revenue_source": "pos",
        "pos_provider": locale.get("pos_provider") or "easyretail",
        "revenue_note": locale.get("revenue_note") or "Incasso da scontrini agent cassa",
        "snapshot": m_snap,
        "weekly": m_weekly,
        "top_slots": m_heat["suggestions"][:5],
        "hours": m_heat["hours"],
        "weekdays": m_heat["weekdays"],
        "cells": m_heat["cells"],
        "visits_source": "pos",
        "payment_split": m_snap.get("payment_split") or {},
        "locations": [],
    }


def get_snapshot(*, model_id: Optional[str] = None, months: int = 3, location: Optional[str] = None) -> dict:
    today = date.today()
    lookback_months = max(1, min(6, int(months or 3)))
    hist_days = min(93, lookback_months * 31)
    date_from = today - timedelta(days=hist_days - 1)
    mid = _parse_model_id(model_id)
    revenue_mode = _revenue_mode_for(model_id, location)
    if mid in POS_ONLY_MODEL_IDS:
        events, warnings = [], []
    else:
        events, warnings = _load_events(date_from=date_from, date_to=today, model_id=model_id)
    pos_daily = _load_pos_daily_totals(
        date_from, today, model_id, revenue_mode=revenue_mode, location=location
    )
    return _snapshot_from_events(
        events,
        model_id=model_id,
        lookback_months=lookback_months,
        warnings=warnings,
        pos_daily=pos_daily,
        revenue_mode=revenue_mode,
    )


def get_daily_series(*, days: int = 30, model_id: Optional[str] = None, location: Optional[str] = None) -> dict:
    days = max(7, min(90, int(days or 30)))
    today = date.today()
    start_d = today - timedelta(days=days - 1)
    mid = _parse_model_id(model_id)
    revenue_mode = _revenue_mode_for(model_id, location)
    if mid in POS_ONLY_MODEL_IDS or revenue_mode == "pos":
        events, warnings = [], []
    else:
        events, warnings = _load_events(date_from=start_d, date_to=today, model_id=model_id)
    scoped = _filter_events_for_model(events, model_id)
    pos_daily = _load_pos_daily_totals(
        start_d, today, model_id, revenue_mode=revenue_mode, location=location
    )

    rows = []
    for i in range(days):
        d = start_d + timedelta(days=i)
        if revenue_mode == "pos":
            incasso = _pos_day_incasso(pos_daily, d)
            movimenti = _pos_day_movimenti(pos_daily, d)
        elif revenue_mode == "vne":
            incasso = _day_incasso(scoped, d)
            movimenti = _day_movimenti(scoped, d)
        else:
            incasso = _combined_day_incasso(scoped, d, pos_daily)
            movimenti = _combined_day_movimenti(scoped, d, pos_daily)
        cash = _pos_day_cash(pos_daily, d)
        card = _pos_day_card(pos_daily, d)
        rows.append(
            {
                "date": d.isoformat(),
                "weekday": d.weekday(),
                "weekday_label": WEEKDAY_LABELS_IT[d.weekday()],
                "incasso": incasso,
                "movimenti": movimenti,
                "cash_eur": cash,
                "card_eur": card,
            }
        )
    total = sum((r["incasso"] for r in rows), Decimal("0.00"))
    return {
        "activity": _parse_model_id(model_id) or "all",
        "source": _revenue_source(model_id, pos_daily, revenue_mode),
        "date_from": start_d.isoformat(),
        "date_to": today.isoformat(),
        "total_incasso": _dec(total),
        "payment_split": _payment_split_from_pos_daily(pos_daily),
        "rows": rows,
        "warnings": warnings,
        "data_note": DATA_NOTE,
    }


def get_weekly_series(*, weeks: int = 12, model_id: Optional[str] = None, location: Optional[str] = None) -> dict:
    weeks = max(4, min(26, int(weeks or 12)))
    today = date.today()
    start_monday = today - timedelta(days=today.weekday()) - timedelta(weeks=weeks - 1)
    mid = _parse_model_id(model_id)
    revenue_mode = _revenue_mode_for(model_id, location)
    if mid in POS_ONLY_MODEL_IDS or revenue_mode == "pos":
        events, warnings = [], []
    else:
        events, warnings = _load_events(date_from=start_monday, date_to=today, model_id=model_id)
    pos_daily = _load_pos_daily_totals(
        start_monday, today, model_id, revenue_mode=revenue_mode, location=location
    )
    return _weekly_from_events(
        events,
        weeks=weeks,
        model_id=model_id,
        warnings=warnings,
        pos_daily=pos_daily,
        revenue_mode=revenue_mode,
    )


def get_monthly_series(*, months: int = 6, model_id: Optional[str] = None, location: Optional[str] = None) -> dict:
    months = max(3, min(12, int(months or 6)))
    today = date.today()
    y, m = today.year, today.month
    m -= months - 1
    while m <= 0:
        m += 12
        y -= 1
    start_d = date(y, m, 1)
    mid = _parse_model_id(model_id)
    revenue_mode = _revenue_mode_for(model_id, location)
    if mid in POS_ONLY_MODEL_IDS or revenue_mode == "pos":
        events, warnings = [], []
    else:
        events, warnings = _load_events(
            date_from=start_d,
            date_to=today,
            model_id=model_id,
            max_op_pages=6,
            max_closing_pages=10,
        )

    buckets: Dict[str, Dict[str, Any]] = {}
    cy, cm = start_d.year, start_d.month
    for _ in range(months):
        key = f"{cy:04d}-{cm:02d}"
        buckets[key] = {
            "month_key": key,
            "month_label": f"{MONTH_LABELS_IT[cm - 1]} {cy}",
            "incasso": Decimal("0.00"),
            "movimenti": 0,
            "cash_eur": Decimal("0.00"),
            "card_eur": Decimal("0.00"),
        }
        cm += 1
        if cm > 12:
            cm = 1
            cy += 1

    # Incasso mensile da scontrini EasyRetail (agent cassa)
    scoped = _filter_events_for_model(events, model_id)
    pos_daily = _load_pos_daily_totals(
        start_d, today, model_id, revenue_mode=revenue_mode, location=location
    )
    d = start_d
    while d <= today:
        key = d.strftime("%Y-%m")
        if key in buckets:
            if revenue_mode == "pos":
                inc = _pos_day_incasso(pos_daily, d)
                mov = _pos_day_movimenti(pos_daily, d)
            elif revenue_mode == "vne":
                inc = _day_incasso(scoped, d)
                mov = _day_movimenti(scoped, d)
            else:
                inc = _combined_day_incasso(scoped, d, pos_daily)
                mov = _combined_day_movimenti(scoped, d, pos_daily)
            buckets[key]["incasso"] = _dec(buckets[key]["incasso"] + inc)
            buckets[key]["movimenti"] += mov
            buckets[key]["cash_eur"] = _dec(buckets[key]["cash_eur"] + _pos_day_cash(pos_daily, d))
            buckets[key]["card_eur"] = _dec(buckets[key]["card_eur"] + _pos_day_card(pos_daily, d))
        d += timedelta(days=1)

    rows = list(buckets.values())
    return {
        "activity": _parse_model_id(model_id) or "all",
        "source": _revenue_source(model_id, pos_daily, revenue_mode),
        "months": months,
        "total_incasso": _dec(sum((r["incasso"] for r in rows), Decimal("0.00"))),
        "payment_split": _payment_split_from_pos_daily(pos_daily),
        "rows": rows,
        "warnings": warnings,
        "data_note": DATA_NOTE,
    }


def get_hourly_heatmap(*, months: int = 3, model_id: Optional[str] = None) -> dict:
    from ..routers.vne import _models

    months = max(1, min(6, int(months or 3)))
    today = date.today()
    date_from = today - timedelta(days=min(93, months * 31) - 1)
    events, warnings = _load_events(date_from=date_from, date_to=today, model_id=model_id)
    heat = _heatmap_from_events(events, months=months, model_id=model_id, warnings=warnings)
    if _parse_model_id(model_id) in (None, POS_REVENUE_MODEL_ID):
        heat = _apply_pos_visits(heat, date_from=date_from, date_to=today, model_id=model_id, merge=True)
    else:
        heat = _apply_pos_visits(heat, date_from=date_from, date_to=today, model_id=model_id)

    mid = _parse_model_id(model_id)
    machine_models = _models()
    if mid:
        machine_models = [m for m in machine_models if m.id == mid]

    by_machine = []
    for model in machine_models:
        m_events = [e for e in events if e.model_id == model.id]
        m_warn = [w for w in warnings if model.label in w]
        m_heat = _heatmap_from_events(
            m_events,
            months=months,
            model_id=model.id,
            warnings=m_warn,
        )
        m_heat = _apply_pos_visits(
            m_heat,
            date_from=date_from,
            date_to=today,
            model_id=model.id,
            merge=(model.id == POS_REVENUE_MODEL_ID),
        )
        by_machine.append(
            {
                "model_id": model.id,
                "model_label": model.label,
                "hours": m_heat["hours"],
                "weekdays": m_heat["weekdays"],
                "cells": m_heat["cells"],
                "suggestions": m_heat["suggestions"],
                "max_avg_amount": m_heat["max_avg_amount"],
                "machines": [model.label],
                "warnings": m_warn,
                "visits_source": m_heat.get("visits_source") or "vne",
            }
        )

    heat["by_machine"] = by_machine
    heat["machines"] = [m.label for m in machine_models] or list(heat.get("machines") or [])
    return heat


def get_staffing_plan(*, months: int = 3, model_id: Optional[str] = None) -> dict:
    heat = get_hourly_heatmap(months=months, model_id=model_id)
    by_day: Dict[int, List[dict]] = defaultdict(list)
    for cell in heat["cells"]:
        if cell["level"] == "nullo":
            continue
        if cell["operatori_consigliati"] < 2 and cell["level"] == "basso":
            continue
        by_day[cell["weekday"]].append(
            {
                "slot_label": cell["slot_label"],
                "hour": cell["hour"],
                "operatori_consigliati": cell["operatori_consigliati"],
                "level": cell["level"],
                "avg_amount": cell["avg_amount"],
                "message": (
                    f"Consigliati {cell['operatori_consigliati']} operator"
                    f"{'i' if cell['operatori_consigliati'] != 1 else 'e'} "
                    f"in fascia {cell['slot_label']}"
                ),
            }
        )

    days_out = []
    for wd in range(7):
        slots = sorted(by_day.get(wd, []), key=lambda s: s["hour"])
        days_out.append(
            {
                "weekday": wd,
                "weekday_label": WEEKDAY_LABELS_IT[wd],
                "slots": slots,
                "peak_operators": max((s["operatori_consigliati"] for s in slots), default=1),
            }
        )

    return {
        "activity": heat["activity"],
        "source": "vne",
        "months": heat["months"],
        "days": days_out,
        "suggestions": heat["suggestions"],
        "warnings": heat.get("warnings") or [],
        "note": (
            "Suggerimenti basati sulle operazioni VNE per fascia oraria. "
            "Le chiusure cassa alimentano gli incassi giornalieri. Non sono turni automatici."
        ),
        "data_note": DATA_NOTE,
    }


def _merge_pos_daily(
    target: Dict[date, Dict[str, Any]],
    source: Dict[date, Dict[str, Any]],
) -> Dict[date, Dict[str, Any]]:
    for day, hit in (source or {}).items():
        if day not in target:
            target[day] = {
                "incasso": Decimal("0.00"),
                "movimenti": 0,
                "cash_eur": Decimal("0.00"),
                "card_eur": Decimal("0.00"),
            }
        target[day]["incasso"] = _dec(
            Decimal(str(target[day].get("incasso") or 0)) + Decimal(str(hit.get("incasso") or 0))
        )
        target[day]["movimenti"] = int(target[day].get("movimenti") or 0) + int(
            hit.get("movimenti") or 0
        )
        target[day]["cash_eur"] = _dec(
            Decimal(str(target[day].get("cash_eur") or 0)) + Decimal(str(hit.get("cash_eur") or 0))
        )
        target[day]["card_eur"] = _dec(
            Decimal(str(target[day].get("card_eur") or 0)) + Decimal(str(hit.get("card_eur") or 0))
        )
    return target


def get_overview(*, months: int = 3, model_id: Optional[str] = None) -> dict:
    """Overview analitica: solo scontrini agent/POS (nessuna lettura VNE)."""
    lookback_months = max(1, min(6, int(months or 3)))
    today = date.today()
    month_span = max(3, min(6, lookback_months))
    y, m = today.year, today.month
    m -= month_span - 1
    while m <= 0:
        m += 12
        y -= 1
    date_from = date(y, m, 1)

    mid = _parse_model_id(model_id)
    locales = analytics_dashboard_locales()
    if mid:
        locales = [loc for loc in locales if loc["model_id"] == mid]

    by_machine = []
    pos_daily: Dict[date, Dict[str, Any]] = {}
    locales_today = []

    for locale in locales:
        store_keys = tuple(locale.get("store_keys") or ())
        m_pos = _load_pos_daily_totals(
            date_from,
            today,
            locale["model_id"],
            revenue_mode="pos",
            store_keys=store_keys,
        )
        _merge_pos_daily(pos_daily, m_pos)
        entry = _build_pos_only_machine_entry(
            locale=locale,
            lookback_months=lookback_months,
            date_from=date_from,
            date_to=today,
            pos_daily=m_pos,
        )
        by_machine.append(entry)
        snap_m = entry.get("snapshot") or {}
        locales_today.append(
            {
                "model_id": locale["model_id"],
                "label": locale["model_label"],
                "incasso_oggi": snap_m.get("incasso_oggi") or 0,
                "movimenti_oggi": snap_m.get("movimenti_oggi") or 0,
                "cash_eur": (snap_m.get("payment_split") or {}).get("cash_eur") or 0,
                "card_eur": (snap_m.get("payment_split") or {}).get("card_eur") or 0,
            }
        )

    snap = _snapshot_from_events(
        [],
        model_id=mid,
        lookback_months=lookback_months,
        warnings=[],
        pos_daily=pos_daily,
        revenue_mode="pos",
    )
    snap["machines"] = [loc["model_label"] for loc in locales]
    snap["locales_today"] = locales_today

    weekly = _weekly_from_events(
        [],
        weeks=8,
        model_id=mid,
        warnings=[],
        pos_daily=pos_daily,
        revenue_mode="pos",
    )

    # Heatmap / top slot: solo POS (niente VNE). In totale uniamo i top delle schede.
    heat = {
        "suggestions": [],
        "hours": BUSINESS_HOURS,
        "weekdays": WEEKDAY_LABELS_IT,
        "cells": [],
    }
    if mid and locales:
        heat = _heatmap_from_pos_receipts(
            date_from=date_from,
            date_to=today,
            store_keys=tuple(locales[0].get("store_keys") or ()),
            months=lookback_months,
            warnings=[],
            model_id=locales[0]["model_id"],
            model_label=locales[0]["model_label"],
        )
    elif by_machine:
        merged_slots = []
        for entry in by_machine:
            for slot in entry.get("top_slots") or []:
                merged_slots.append(slot)
        merged_slots.sort(
            key=lambda s: float(s.get("avg_visits") or s.get("score") or 0),
            reverse=True,
        )
        heat["suggestions"] = merged_slots[:5]

    buckets: Dict[str, Dict[str, Any]] = {}
    cy, cm = date_from.year, date_from.month
    for _ in range(month_span):
        key = f"{cy:04d}-{cm:02d}"
        buckets[key] = {
            "month_key": key,
            "month_label": f"{MONTH_LABELS_IT[cm - 1]} {cy}",
            "incasso": Decimal("0.00"),
            "movimenti": 0,
        }
        cm += 1
        if cm > 12:
            cm = 1
            cy += 1
    d = date_from
    while d <= today:
        key = d.strftime("%Y-%m")
        if key in buckets:
            buckets[key]["incasso"] = _dec(
                buckets[key]["incasso"] + _pos_day_incasso(pos_daily, d)
            )
            buckets[key]["movimenti"] += int((pos_daily.get(d) or {}).get("movimenti") or 0)
        d += timedelta(days=1)
    monthly_rows = list(buckets.values())
    monthly = {
        "activity": mid or "all",
        "source": "pos",
        "months": month_span,
        "total_incasso": _dec(sum((r["incasso"] for r in monthly_rows), Decimal("0.00"))),
        "rows": monthly_rows,
        "warnings": [],
        "data_note": DATA_NOTE,
    }

    return {
        "snapshot": snap,
        "weekly": weekly,
        "monthly": monthly,
        "top_slots": heat.get("suggestions") or [],
        "by_machine": by_machine,
        "locales_today": locales_today,
        "source": "pos",
        "data_note": DATA_NOTE,
        "warnings": [],
    }
