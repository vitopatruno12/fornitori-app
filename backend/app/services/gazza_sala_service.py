"""Sala Gazza Ladra condivisa: un foglio per data e fascia, aggiornabile per tavolo."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.gazza_sala_sheet import GazzaSalaSheet

TABLE_COUNT = 15
FASCE = {"pranzo", "cena"}
STATUSES = {"libero", "occupato", "conto", "pagato", "chiuso"}
PAYMENTS = {"", "contanti", "carta", "misto", "altro"}
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_HISTORY_CAP = 500


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _num(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    try:
        n = float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return 0.0
    if n < 0:
        return 0.0
    return round(n, 2)


def _clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def empty_row(table_id: int, paid_total: Any = "") -> Dict[str, Any]:
    total = _num(paid_total)
    return {
        "table_id": table_id,
        "status": "libero",
        "clients": "",
        "reservation_name": "",
        "invoice_number": "",
        "payment_type": "",
        "paid": "",
        "waiter": "",
        "paid_total": str(total) if total > 0 else "",
    }


def normalize_row(raw: Any, table_id: int) -> Dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    status = _clip(src.get("status"), 16).lower()
    if status not in STATUSES:
        status = "libero"
    payment = _clip(src.get("payment_type"), 16).lower()
    if payment not in PAYMENTS:
        payment = ""
    clients_n = _num(src.get("clients"))
    paid_n = _num(src.get("paid"))
    total_n = _num(src.get("paid_total"))
    clients = str(int(clients_n)) if src.get("clients") not in (None, "") and clients_n > 0 else ""
    return {
        "table_id": table_id,
        "status": status,
        "clients": clients,
        "reservation_name": _clip(src.get("reservation_name") or src.get("menu"), 120),
        "invoice_number": _clip(src.get("invoice_number") or src.get("bill"), 40),
        "payment_type": payment,
        "paid": str(paid_n) if src.get("paid") not in (None, "") else "",
        "waiter": _clip(src.get("waiter"), 80),
        "paid_total": str(total_n) if total_n > 0 else "",
    }


def normalize_tables(saved: Any) -> List[Dict[str, Any]]:
    by_id: Dict[int, Dict[str, Any]] = {}
    if isinstance(saved, list):
        for row in saved:
            if not isinstance(row, dict):
                continue
            try:
                table_id = int(row.get("table_id"))
            except (TypeError, ValueError):
                continue
            if table_id < 1 or table_id > TABLE_COUNT:
                continue
            by_id[table_id] = normalize_row(row, table_id)
    return [by_id.get(i) or empty_row(i) for i in range(1, TABLE_COUNT + 1)]


def normalize_history(saved: Any) -> List[Dict[str, Any]]:
    if not isinstance(saved, list):
        return []
    out: List[Dict[str, Any]] = []
    for entry in saved[-_HISTORY_CAP:]:
        if not isinstance(entry, dict):
            continue
        try:
            table_id = int(entry.get("table_id"))
        except (TypeError, ValueError):
            continue
        if table_id < 1 or table_id > TABLE_COUNT:
            continue
        paid_n = _num(entry.get("paid"))
        clients_n = _num(entry.get("clients"))
        payment = _clip(entry.get("payment_type"), 16).lower()
        if payment not in PAYMENTS:
            payment = ""
        out.append(
            {
                "id": _clip(entry.get("id"), 80) or f"{_now_iso()}-{table_id}",
                "table_id": table_id,
                "reservation_name": _clip(entry.get("reservation_name"), 120),
                "clients": str(int(clients_n)) if entry.get("clients") not in (None, "") and clients_n > 0 else "",
                "invoice_number": _clip(entry.get("invoice_number"), 40),
                "waiter": _clip(entry.get("waiter"), 80),
                "paid": str(paid_n) if entry.get("paid") not in (None, "") else "",
                "payment_type": payment,
                "paidAt": _clip(entry.get("paidAt"), 40),
            }
        )
    return out


def sheet_has_service_data(tables: List[Dict[str, Any]], history: List[Dict[str, Any]]) -> bool:
    if history:
        return True
    for row in tables:
        if row.get("status") not in (None, "", "libero"):
            return True
        if _num(row.get("paid_total")) > 0:
            return True
        for key in ("clients", "reservation_name", "invoice_number", "payment_type", "paid", "waiter"):
            if str(row.get(key) or "").strip():
                return True
    return False


def replace_table(tables: List[Dict[str, Any]], row: Dict[str, Any]) -> List[Dict[str, Any]]:
    table_id = int(row["table_id"])
    next_rows = list(tables)
    next_rows[table_id - 1] = normalize_row(row, table_id)
    return next_rows


def apply_paid(
    tables: List[Dict[str, Any]],
    history: List[Dict[str, Any]],
    table_id: int,
    source: Optional[Dict[str, Any]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    stored = tables[table_id - 1]
    if isinstance(source, dict):
        current = normalize_row({**source, "table_id": table_id}, table_id)
        current["paid_total"] = stored.get("paid_total") or ""
    else:
        current = stored
    paid_at = _now_iso()
    paid_n = _num(current.get("paid"))
    total_n = round(_num(current.get("paid_total")) + paid_n, 2)
    entry = {
        "id": f"{paid_at}-{table_id}",
        "table_id": table_id,
        "reservation_name": current.get("reservation_name") or "",
        "clients": current.get("clients") or "",
        "invoice_number": current.get("invoice_number") or "",
        "waiter": current.get("waiter") or "",
        "paid": current.get("paid") or "",
        "payment_type": current.get("payment_type") or "",
        "paidAt": paid_at,
    }
    kept = normalize_row(
        {
            **current,
            "status": "pagato",
            "paid_total": str(total_n) if total_n > 0 else "",
        },
        table_id,
    )
    next_history = normalize_history([*history, entry])
    next_tables = replace_table(tables, kept)
    return next_tables, next_history, entry


def _loads(raw: Optional[str], kind: str) -> Any:
    try:
        return json.loads(raw or ("[]" if kind else "[]"))
    except json.JSONDecodeError:
        return []


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def parse_slot(service_date: str, fascia: str) -> Tuple[str, str]:
    day = str(service_date or "").strip()
    band = str(fascia or "").strip().lower()
    if not _DATE_RE.match(day):
        raise ValueError("Data non valida")
    if band not in FASCE:
        raise ValueError("Fascia non valida")
    return day, band


def _lock_query(db: Session, day: str, band: str):
    query = db.query(GazzaSalaSheet).filter(
        GazzaSalaSheet.service_date == day,
        GazzaSalaSheet.fascia == band,
    )
    bind = db.get_bind()
    if bind is not None and bind.dialect.name != "sqlite":
        query = query.with_for_update()
    return query


def _read_sheet(row: GazzaSalaSheet) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    return normalize_tables(_loads(row.tables_json, "tables")), normalize_history(_loads(row.history_json, "history"))


def _write_sheet(row: GazzaSalaSheet, tables: List[Dict[str, Any]], history: List[Dict[str, Any]]) -> None:
    row.tables_json = _dump(tables)
    row.history_json = _dump(history)
    row.updated_at = datetime.now(timezone.utc)


def _payload(day: str, band: str, tables: List[Dict[str, Any]], history: List[Dict[str, Any]], saved_at: Optional[datetime], fresh: bool) -> Dict[str, Any]:
    stamp = saved_at.isoformat() if saved_at is not None else ""
    return {
        "date": day,
        "fascia": band,
        "tables": tables,
        "history": history,
        "savedAt": stamp,
        "fresh": fresh,
    }


def get_sheet(db: Session, service_date: str, fascia: str) -> Dict[str, Any]:
    day, band = parse_slot(service_date, fascia)
    row = (
        db.query(GazzaSalaSheet)
        .filter(GazzaSalaSheet.service_date == day, GazzaSalaSheet.fascia == band)
        .one_or_none()
    )
    if row is None:
        row = GazzaSalaSheet(
            service_date=day,
            fascia=band,
            tables_json=_dump(normalize_tables([])),
            history_json="[]",
        )
        db.add(row)
        try:
            db.commit()
            db.refresh(row)
            tables, history = _read_sheet(row)
            return _payload(day, band, tables, history, row.updated_at, True)
        except IntegrityError:
            db.rollback()
            row = (
                db.query(GazzaSalaSheet)
                .filter(GazzaSalaSheet.service_date == day, GazzaSalaSheet.fascia == band)
                .one()
            )
    tables, history = _read_sheet(row)
    return _payload(day, band, tables, history, row.updated_at, False)


def save_table(db: Session, service_date: str, fascia: str, row_in: Dict[str, Any]) -> Dict[str, Any]:
    day, band = parse_slot(service_date, fascia)
    try:
        table_id = int(row_in.get("table_id"))
    except (TypeError, ValueError):
        raise ValueError("Tavolo non valido")
    if table_id < 1 or table_id > TABLE_COUNT:
        raise ValueError("Tavolo non valido")
    get_sheet(db, day, band)
    row = _lock_query(db, day, band).one()
    tables, history = _read_sheet(row)
    stored = tables[table_id - 1]
    merged = {**row_in, "table_id": table_id}
    if row_in.get("clear_counter"):
        merged["paid_total"] = ""
    elif _num(row_in.get("paid_total")) <= 0:
        merged["paid_total"] = stored.get("paid_total") or ""
    tables = replace_table(tables, merged)
    _write_sheet(row, tables, history)
    db.commit()
    db.refresh(row)
    return _payload(day, band, tables, history, row.updated_at, False)


def mark_table_paid(
    db: Session,
    service_date: str,
    fascia: str,
    table_id: int,
    source: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    day, band = parse_slot(service_date, fascia)
    if table_id < 1 or table_id > TABLE_COUNT:
        raise ValueError("Tavolo non valido")
    get_sheet(db, day, band)
    row = _lock_query(db, day, band).one()
    tables, history = _read_sheet(row)
    tables, history, entry = apply_paid(tables, history, table_id, source)
    _write_sheet(row, tables, history)
    db.commit()
    db.refresh(row)
    payload = _payload(day, band, tables, history, row.updated_at, False)
    payload["entry"] = entry
    payload["row"] = tables[table_id - 1]
    return payload


def reset_sheet(db: Session, service_date: str, fascia: str) -> Dict[str, Any]:
    day, band = parse_slot(service_date, fascia)
    get_sheet(db, day, band)
    row = _lock_query(db, day, band).one()
    _tables, history = _read_sheet(row)
    tables = normalize_tables([])
    _write_sheet(row, tables, history)
    db.commit()
    db.refresh(row)
    return _payload(day, band, tables, history, row.updated_at, False)


def import_if_empty(
    db: Session,
    service_date: str,
    fascia: str,
    tables_in: Any,
    history_in: Any,
) -> Dict[str, Any]:
    day, band = parse_slot(service_date, fascia)
    current = get_sheet(db, day, band)
    if sheet_has_service_data(current["tables"], current["history"]):
        current["fresh"] = False
        current["imported"] = False
        return current
    incoming_tables = normalize_tables(tables_in)
    incoming_history = normalize_history(history_in)
    if not sheet_has_service_data(incoming_tables, incoming_history):
        current["imported"] = False
        return current
    row = _lock_query(db, day, band).one()
    tables, history = _read_sheet(row)
    if sheet_has_service_data(tables, history):
        payload = _payload(day, band, tables, history, row.updated_at, False)
        payload["imported"] = False
        return payload
    _write_sheet(row, incoming_tables, incoming_history)
    db.commit()
    db.refresh(row)
    payload = _payload(day, band, incoming_tables, incoming_history, row.updated_at, False)
    payload["imported"] = True
    return payload
