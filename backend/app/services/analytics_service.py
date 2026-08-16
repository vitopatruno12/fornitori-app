"""Analytics / BI: vendite e traffico da macchine VNE (operazioni + chiusure cassa)."""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from ..routers.vne import VneAnalyticsEvent, collect_analytics_events

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
    "Dati da macchine VNE: operazioni (traffico orario) e chiusure cassa (incasso giornaliero). "
    "Orari di punta: preferisce scontrini EasyRetail (POS) se importati."
)


def _apply_pos_visits(
    heat: dict,
    *,
    date_from: date,
    date_to: date,
    model_id: Optional[str] = None,
) -> dict:
    """Sovrascrive avg_visits con scontrini POS EasyRetail quando disponibili."""
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
        hit = buckets.get((scope_key, wd, hr)) or buckets.get(("all", wd, hr))
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
) -> dict:
    today = date.today()
    scoped = _filter_events_for_model(events, model_id)
    mid = _parse_model_id(model_id)

    # Dashboard: incasso oggi solo da chiusure di giornata (non dalle operazioni).
    incasso_oggi = _day_incasso_chiusure(scoped, today)
    movimenti_oggi = _day_movimenti(scoped, today)

    bucket_amount: Dict[Tuple[int, int], Decimal] = defaultdict(lambda: Decimal("0.00"))
    bucket_count: Dict[Tuple[int, int], int] = defaultdict(int)
    for e in _ops(scoped):
        wd, hr = e.when.weekday(), e.when.hour
        if hr not in BUSINESS_HOURS:
            continue
        bucket_amount[(wd, hr)] += _dec(max(e.amount, 0))
        bucket_count[(wd, hr)] += 1

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
    label_prefix = (machines[0] if len(machines) == 1 else "oggi")
    return {
        "date": today.isoformat(),
        "activity": mid or "all",
        "source": "vne",
        "lookback_months": lookback_months,
        "incasso_oggi": incasso_oggi,
        "movimenti_oggi": movimenti_oggi,
        "totale_fiscale": Decimal("0.00"),
        "totale_pos": Decimal("0.00"),
        "totale_non_fiscale": Decimal("0.00"),
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
            "message": (
                f"Picco previsto {label_prefix}: {WEEKDAY_LABELS_IT[today_wd].lower()} "
                f"{_slot_label(peak_hr)} · consigliati {operators} "
                f"operator{'i' if operators != 1 else 'e'}"
            ),
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
) -> dict:
    weeks = max(4, min(26, int(weeks or 12)))
    today = date.today()
    start_monday = today - timedelta(days=today.weekday()) - timedelta(weeks=weeks - 1)
    scoped = _filter_events_for_model(events, model_id)
    rows = []
    for w in range(weeks):
        monday = start_monday + timedelta(weeks=w)
        sunday = monday + timedelta(days=6)
        end = min(sunday, today)
        incasso = Decimal("0.00")
        movimenti = 0
        d = monday
        while d <= end:
            incasso += _day_incasso(scoped, d)
            movimenti += _day_movimenti(scoped, d)
            d += timedelta(days=1)
        rows.append(
            {
                "week_start": monday.isoformat(),
                "week_end": end.isoformat(),
                "label": f"{monday.strftime('%d/%m')}–{end.strftime('%d/%m')}",
                "incasso": _dec(incasso),
                "movimenti": movimenti,
            }
        )
    return {
        "activity": _parse_model_id(model_id) or "all",
        "source": "vne",
        "weeks": weeks,
        "total_incasso": _dec(sum((r["incasso"] for r in rows), Decimal("0.00"))),
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


def get_snapshot(*, model_id: Optional[str] = None, months: int = 3) -> dict:
    today = date.today()
    lookback_months = max(1, min(6, int(months or 3)))
    hist_days = min(93, lookback_months * 31)
    date_from = today - timedelta(days=hist_days - 1)
    events, warnings = _load_events(date_from=date_from, date_to=today, model_id=model_id)
    return _snapshot_from_events(
        events,
        model_id=model_id,
        lookback_months=lookback_months,
        warnings=warnings,
    )


def get_daily_series(*, days: int = 30, model_id: Optional[str] = None) -> dict:
    days = max(7, min(90, int(days or 30)))
    today = date.today()
    start_d = today - timedelta(days=days - 1)
    events, warnings = _load_events(date_from=start_d, date_to=today, model_id=model_id)

    rows = []
    for i in range(days):
        d = start_d + timedelta(days=i)
        rows.append(
            {
                "date": d.isoformat(),
                "weekday": d.weekday(),
                "weekday_label": WEEKDAY_LABELS_IT[d.weekday()],
                "incasso": _day_incasso(events, d),
                "movimenti": _day_movimenti(events, d),
            }
        )
    total = sum((r["incasso"] for r in rows), Decimal("0.00"))
    return {
        "activity": _parse_model_id(model_id) or "all",
        "source": "vne",
        "date_from": start_d.isoformat(),
        "date_to": today.isoformat(),
        "total_incasso": _dec(total),
        "rows": rows,
        "warnings": warnings,
        "data_note": DATA_NOTE,
    }


def get_weekly_series(*, weeks: int = 12, model_id: Optional[str] = None) -> dict:
    weeks = max(4, min(26, int(weeks or 12)))
    today = date.today()
    start_monday = today - timedelta(days=today.weekday()) - timedelta(weeks=weeks - 1)
    events, warnings = _load_events(date_from=start_monday, date_to=today, model_id=model_id)
    return _weekly_from_events(events, weeks=weeks, model_id=model_id, warnings=warnings)


def get_monthly_series(*, months: int = 6, model_id: Optional[str] = None) -> dict:
    months = max(3, min(12, int(months or 6)))
    today = date.today()
    y, m = today.year, today.month
    m -= months - 1
    while m <= 0:
        m += 12
        y -= 1
    start_d = date(y, m, 1)
    # Mensile: più chiusure, meno pagine operazioni
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
        }
        cm += 1
        if cm > 12:
            cm = 1
            cy += 1

    # Incasso mensile da chiusure (o ops se mancano)
    d = start_d
    while d <= today:
        key = d.strftime("%Y-%m")
        if key in buckets:
            buckets[key]["incasso"] = _dec(buckets[key]["incasso"] + _day_incasso(events, d))
            buckets[key]["movimenti"] += _day_movimenti(events, d)
        d += timedelta(days=1)

    rows = list(buckets.values())
    return {
        "activity": _parse_model_id(model_id) or "all",
        "source": "vne",
        "months": months,
        "total_incasso": _dec(sum((r["incasso"] for r in rows), Decimal("0.00"))),
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
        m_heat = _apply_pos_visits(m_heat, date_from=date_from, date_to=today, model_id=model.id)
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


def get_overview(*, months: int = 3, model_id: Optional[str] = None) -> dict:
    """Overview totale + una scheda per macchina VNE (Risacca / Mani / Mucche)."""
    from ..routers.vne import _models

    lookback_months = max(1, min(6, int(months or 3)))
    today = date.today()
    # Range unico: copre snapshot (90g) + weekly (8 sett) + monthly (fino a 6 mesi)
    month_span = max(3, min(6, lookback_months))
    y, m = today.year, today.month
    m -= month_span - 1
    while m <= 0:
        m += 12
        y -= 1
    date_from = date(y, m, 1)

    # Se chiede una sola macchina, resta filtrata; altrimenti carica tutte una volta.
    mid = _parse_model_id(model_id)
    events, warnings = _load_events(
        date_from=date_from,
        date_to=today,
        model_id=mid,
        max_op_pages=4,
        # Più pagine chiusure: l'incasso oggi della dashboard dipende da queste.
        max_closing_pages=10,
    )

    snap = _snapshot_from_events(
        events,
        model_id=mid,
        lookback_months=lookback_months,
        warnings=warnings,
    )
    weekly = _weekly_from_events(events, weeks=8, model_id=mid, warnings=warnings)
    heat = _heatmap_from_events(events, months=lookback_months, model_id=mid, warnings=warnings)

    # Mensile dal medesimo dataset
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
    scoped_all = _filter_events_for_model(events, mid)
    d = date_from
    while d <= today:
        key = d.strftime("%Y-%m")
        if key in buckets:
            buckets[key]["incasso"] = _dec(buckets[key]["incasso"] + _day_incasso(scoped_all, d))
            buckets[key]["movimenti"] += _day_movimenti(scoped_all, d)
        d += timedelta(days=1)
    monthly_rows = list(buckets.values())
    monthly = {
        "activity": mid or "all",
        "source": "vne",
        "months": month_span,
        "total_incasso": _dec(sum((r["incasso"] for r in monthly_rows), Decimal("0.00"))),
        "rows": monthly_rows,
        "warnings": warnings,
        "data_note": DATA_NOTE,
    }

    machine_models = _models()
    if mid:
        machine_models = [m for m in machine_models if m.id == mid]

    by_machine = []
    for model in machine_models:
        m_events = [e for e in events if e.model_id == model.id]
        m_warn = [w for w in warnings if model.label in w]
        m_snap = _snapshot_from_events(
            m_events,
            model_id=model.id,
            lookback_months=lookback_months,
            warnings=m_warn,
        )
        m_snap["machines"] = [model.label]
        m_weekly = _weekly_from_events(m_events, weeks=8, model_id=model.id, warnings=m_warn)
        m_heat = _heatmap_from_events(
            m_events,
            months=lookback_months,
            model_id=model.id,
            warnings=m_warn,
        )
        m_heat = _apply_pos_visits(m_heat, date_from=date_from, date_to=today, model_id=model.id)
        by_machine.append(
            {
                "model_id": model.id,
                "model_label": model.label,
                "snapshot": m_snap,
                "weekly": m_weekly,
                "top_slots": m_heat["suggestions"][:5],
                "hours": m_heat["hours"],
                "weekdays": m_heat["weekdays"],
                "cells": m_heat["cells"],
                "visits_source": m_heat.get("visits_source") or "vne",
            }
        )

    return {
        "snapshot": snap,
        "weekly": weekly,
        "monthly": monthly,
        "top_slots": heat["suggestions"][:5],
        "by_machine": by_machine,
        "source": "vne",
        "data_note": DATA_NOTE,
        "warnings": list(dict.fromkeys(warnings)),
    }
