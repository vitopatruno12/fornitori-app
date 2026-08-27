"""Import e lettura scontrini POS (EasyRetail) per Orari di punta / visite."""

from __future__ import annotations

import csv
import io
import re
from collections import defaultdict
from datetime import date, datetime, time, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy.orm import Session

from ..models.pos_receipt import PosReceipt
from .pos_store_catalog import (  # noqa: F401 — re-export
    POS_STORE_CATALOG,
    SOURCE_EASYRETAIL,
    _norm_header,
    resolve_store,
)

_DATE_HEADERS = (
    "dataora",
    "data_ora",
    "datetime",
    "timestamp",
    "dataeora",
    "receipt_at",
    "quando",
    "data",
    "date",
    "giorno",
)
_TIME_HEADERS = ("ora", "time", "orario", "hour")
_ID_HEADERS = (
    "numeroscontrino",
    "numero_scontrino",
    "scontrino",
    "n_scontrino",
    "nscontrino",
    "ticket",
    "numeroticket",
    "id",
    "external_id",
    "numero",
    "doc",
    "documento",
)
_AMOUNT_HEADERS = (
    "totale",
    "importo",
    "amount",
    "totaleivato",
    "totalenetto",
    "valore",
    "tot",
    "incasso",
)
_STORE_HEADERS = (
    "negozio",
    "locale",
    "cassa",
    "pos",
    "store",
    "punto_vendita",
    "puntovendita",
    "codicepos",
    "codice_pos",
    "postazione",
    "sede",
    "magazzino",
    "model_id",
    "macchina",
)
_VOID_HEADERS = ("annullato", "void", "logicdelete", "cancellato", "storno")


def _pick(row: Dict[str, str], headers: Tuple[str, ...]) -> str:
    for h in headers:
        if h in row and str(row[h] or "").strip():
            return str(row[h]).strip()
    return ""


def _parse_amount(raw: str) -> Optional[Decimal]:
    s = str(raw or "").strip()
    if not s:
        return None
    s = s.replace("€", "").replace(" ", "")
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return Decimal(s).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None


def _parse_boolish(raw: str) -> bool:
    s = str(raw or "").strip().lower()
    return s in ("1", "true", "t", "si", "sì", "yes", "y", "annullato", "void", "-1")


def _parse_datetime(date_raw: str, time_raw: str = "") -> Optional[datetime]:
    d = str(date_raw or "").strip()
    t = str(time_raw or "").strip()
    if not d:
        return None
    combined = d
    if t and not re.search(r"\d{1,2}:\d{2}", d):
        combined = f"{d} {t}"
    combined = re.sub(r"\s+", " ", combined)
    combined = combined.replace("T", " ").replace("alle", " ").replace(",", " ")
    candidates = [
        combined,
        combined.replace("/", "-"),
        combined.replace(".", "-"),
    ]
    formats = (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d.%m.%Y %H:%M:%S",
        "%d.%m.%Y %H:%M",
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%d.%m.%Y",
    )
    for cand in candidates:
        for fmt in formats:
            try:
                dt = datetime.strptime(cand.strip(), fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except ValueError:
                continue
    # ISO fallback
    try:
        dt = datetime.fromisoformat(combined.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _decode_text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def parse_receipts_csv(
    raw: bytes,
    *,
    default_model_id: Optional[str] = None,
    filename: str = "",
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Parsa CSV/TSV EasyRetail (o export generico scontrini)."""
    text = _decode_text(raw)
    if not text.strip():
        return [], ["File vuoto"]

    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";" if sample.count(";") >= sample.count(",") else ","

    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        return [], ["Intestazioni CSV mancanti"]

    mapping = {_norm_header(h): h for h in reader.fieldnames if h}
    # Build normalized rows
    warnings: List[str] = []
    out: List[Dict[str, Any]] = []
    skipped = 0

    for idx, original in enumerate(reader, start=2):
        row = {_norm_header(k): ("" if v is None else str(v).strip()) for k, v in original.items() if k}
        date_raw = _pick(row, _DATE_HEADERS)
        time_raw = _pick(row, _TIME_HEADERS)
        # If date header already has time, ignore separate time
        when = _parse_datetime(date_raw, time_raw)
        if not when:
            skipped += 1
            continue
        store_raw = _pick(row, _STORE_HEADERS)
        store_key, model_id, model_label = resolve_store(store_raw, default_model_id)
        external = _pick(row, _ID_HEADERS) or f"{store_key}:{when.isoformat()}:{idx}"
        amount = _parse_amount(_pick(row, _AMOUNT_HEADERS))
        void_raw = _pick(row, _VOID_HEADERS)
        is_void = _parse_boolish(void_raw) if void_raw else False
        out.append(
            {
                "source": SOURCE_EASYRETAIL,
                "store_key": store_key,
                "model_id": model_id,
                "model_label": model_label,
                "external_id": external[:120],
                "receipt_at": when,
                "amount_eur": amount,
                "is_void": 1 if is_void else 0,
                "raw_store": store_raw or None,
            }
        )

    if skipped:
        warnings.append(f"{skipped} righe saltate (data/ora non valida)")
    if not out:
        warnings.append(
            "Nessuno scontrino riconosciuto. Serve almeno una colonna data/ora "
            "(es. DataOra, Data+Ora) e preferibilmente Negozio/Cassa e NumeroScontrino."
        )
    if filename and not any(h in mapping for h in _STORE_HEADERS) and not default_model_id:
        warnings.append(
            "Nessuna colonna negozio/cassa: assegna il locale in import oppure aggiungi la colonna nel CSV."
        )
    return out, warnings


def upsert_receipts(db: Session, rows: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    inserted = 0
    updated = 0
    skipped_void = 0
    for row in rows:
        if int(row.get("is_void") or 0) == 1:
            skipped_void += 1
            # marca void se già presente
            existing = (
                db.query(PosReceipt)
                .filter(
                    PosReceipt.source == row["source"],
                    PosReceipt.store_key == row["store_key"],
                    PosReceipt.external_id == row["external_id"],
                )
                .one_or_none()
            )
            if existing:
                existing.is_void = 1
                updated += 1
            continue

        existing = (
            db.query(PosReceipt)
            .filter(
                PosReceipt.source == row["source"],
                PosReceipt.store_key == row["store_key"],
                PosReceipt.external_id == row["external_id"],
            )
            .one_or_none()
        )
        if existing:
            existing.receipt_at = row["receipt_at"]
            existing.amount_eur = row.get("amount_eur")
            existing.model_id = row.get("model_id")
            existing.model_label = row.get("model_label")
            existing.raw_store = row.get("raw_store")
            existing.is_void = 0
            updated += 1
        else:
            db.add(PosReceipt(**row))
            inserted += 1
    db.commit()
    return {"inserted": inserted, "updated": updated, "skipped_void": skipped_void}


def import_csv_bytes(
    db: Session,
    raw: bytes,
    *,
    default_model_id: Optional[str] = None,
    filename: str = "",
) -> Dict[str, Any]:
    rows, warnings = parse_receipts_csv(raw, default_model_id=default_model_id, filename=filename)
    stats = upsert_receipts(db, rows) if rows else {"inserted": 0, "updated": 0, "skipped_void": 0}
    return {
        "ok": True,
        "filename": filename,
        "parsed": len(rows),
        **stats,
        "warnings": warnings,
        "stores": sorted({r["model_label"] or r["store_key"] for r in rows}),
    }


def pos_receipt_stats(db: Session) -> Dict[str, Any]:
    q = db.query(PosReceipt).filter(PosReceipt.is_void == 0)
    total = q.count()
    by_store: Dict[str, int] = defaultdict(int)
    latest = None
    earliest = None
    for r in q.all():
        label = r.model_label or r.store_key
        by_store[label] += 1
        if r.receipt_at:
            if latest is None or r.receipt_at > latest:
                latest = r.receipt_at
            if earliest is None or r.receipt_at < earliest:
                earliest = r.receipt_at
    return {
        "total": total,
        "by_store": dict(by_store),
        "from": earliest.isoformat() if earliest else None,
        "to": latest.isoformat() if latest else None,
        "catalog": [
            {"model_id": x["model_id"], "model_label": x["model_label"]} for x in POS_STORE_CATALOG
        ],
    }


def purge_receipts_by_model(
    db: Session,
    *,
    model_id: str,
    source: str = SOURCE_EASYRETAIL,
) -> Dict[str, Any]:
    """Elimina scontrini per model_id (es. cleanup import errato)."""
    mid = (model_id or "").strip()
    if mid not in ("model-1", "model-2", "model-3"):
        raise ValueError("model_id deve essere model-1|model-2|model-3")
    q = db.query(PosReceipt).filter(PosReceipt.source == source, PosReceipt.model_id == mid)
    deleted = q.delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted": int(deleted), "model_id": mid, "source": source}


def load_pos_visit_buckets(
    db: Session,
    *,
    date_from: date,
    date_to: date,
    model_id: Optional[str] = None,
) -> Dict[Tuple[str, int, int], Dict[str, float]]:
    """Ritorna {(model_id|all, weekday, hour): {visits, amount}} da scontrini POS."""
    start = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
    end = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
    q = (
        db.query(PosReceipt)
        .filter(PosReceipt.is_void == 0)
        .filter(PosReceipt.receipt_at >= start)
        .filter(PosReceipt.receipt_at <= end)
    )
    if model_id and model_id not in ("all", "*", ""):
        q = q.filter(PosReceipt.model_id == model_id)

    buckets: Dict[Tuple[str, int, int], Dict[str, float]] = defaultdict(
        lambda: {"visits": 0.0, "amount": 0.0, "days": set()}  # type: ignore
    )
    for r in q.all():
        if not r.receipt_at:
            continue
        local = r.receipt_at
        mid = r.model_id or "unknown"
        wd = local.weekday()
        hr = local.hour
        key = (mid, wd, hr)
        buckets[key]["visits"] += 1
        if r.amount_eur is not None:
            buckets[key]["amount"] += float(r.amount_eur)
        buckets[key]["days"].add(local.date().isoformat())  # type: ignore
        # also aggregate all
        all_key = ("all", wd, hr)
        buckets[all_key]["visits"] += 1
        if r.amount_eur is not None:
            buckets[all_key]["amount"] += float(r.amount_eur)
        buckets[all_key]["days"].add(local.date().isoformat())  # type: ignore

    # convert day sets to counts + avg_visits
    out: Dict[Tuple[str, int, int], Dict[str, float]] = {}
    for key, val in buckets.items():
        days_n = max(1, len(val["days"]))  # type: ignore
        visits = float(val["visits"])
        out[key] = {
            "visits": visits,
            "avg_visits": visits / days_n,
            "amount": float(val["amount"]),
            "sample_days": float(days_n),
        }
    return out


def ingest_receipt_dicts(db: Session, items: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """Upsert da lista JSON (agent GDB / integrazioni)."""
    rows: List[Dict[str, Any]] = []
    skipped = 0
    for raw in items:
        if not isinstance(raw, dict):
            skipped += 1
            continue
        when = raw.get("receipt_at")
        if isinstance(when, str):
            when = _parse_datetime(when, "")
        if not isinstance(when, datetime):
            skipped += 1
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        store_raw = str(raw.get("raw_store") or raw.get("store") or raw.get("store_key") or "").strip()
        fallback = str(raw.get("model_id") or "").strip() or None
        store_key, model_id, model_label = resolve_store(store_raw or str(raw.get("store_key") or ""), fallback)
        external = str(raw.get("external_id") or "").strip()
        if not external:
            external = f"{store_key}:{when.isoformat()}"
        amount = raw.get("amount_eur")
        if amount is not None and not isinstance(amount, Decimal):
            amount = _parse_amount(str(amount))
        is_void = 1 if raw.get("is_void") in (1, True, "1", "true") else 0
        rows.append(
            {
                "source": str(raw.get("source") or SOURCE_EASYRETAIL)[:32],
                "store_key": store_key,
                "model_id": model_id,
                "model_label": model_label or raw.get("model_label"),
                "external_id": external[:120],
                "receipt_at": when,
                "amount_eur": amount,
                "is_void": is_void,
                "raw_store": store_raw or None,
            }
        )
    stats = upsert_receipts(db, rows) if rows else {"inserted": 0, "updated": 0, "skipped_void": 0}
    return {"ok": True, "parsed": len(rows), "skipped": skipped, **stats}


def sync_from_easyretail_gdb(
    db: Session,
    *,
    dsn: Optional[str] = None,
    model_id: Optional[str] = None,
    lookback_hours: Optional[int] = None,
) -> Dict[str, Any]:
    """Legge GDB EasyRetail e upsert in pos_receipts."""
    from . import easyretail_gdb_service as gdb

    cfg = gdb.gdb_config_from_env()
    path = (dsn or cfg["dsn"] or "").strip()
    if not path:
        raise ValueError(
            "Percorso/DSN GDB mancante. Imposta EASYRETAIL_GDB_PATH "
            "(es. C:\\\\EasyRetail\\\\DBase\\\\DBRETAIL.GDB) oppure passalo nella richiesta."
        )
    rows, meta = gdb.fetch_receipts_from_gdb(
        dsn=path,
        user=cfg["user"],
        password=cfg["password"],
        fbclient=cfg.get("fbclient"),
        charset=cfg.get("charset") or "WIN1252",
        lookback_hours=int(lookback_hours or cfg["lookback_hours"]),
        default_model_id=(model_id or cfg.get("model_id") or None),
    )
    stats = upsert_receipts(db, rows) if rows else {"inserted": 0, "updated": 0, "skipped_void": 0}
    return {
        "ok": True,
        "parsed": len(rows),
        **stats,
        "gdb": meta,
    }


def csv_template() -> str:
    return (
        "DataOra;Negozio;NumeroScontrino;Totale\n"
        "15/08/2026 12:35;Mani in Pasta;1042;18,50\n"
        "15/08/2026 12:41;La Risacca;2201;9,00\n"
        "15/08/2026 13:02;Le Mucche Volanti;881;22,30\n"
    )
