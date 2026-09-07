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
from .pos_payment_classifier import classify_payment, merge_payment_fields
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
_PAYMENT_TYPE_HEADERS = (
    "tipopagamento",
    "tipo_pagamento",
    "formapagamento",
    "forma_pagamento",
    "modalitapagamento",
    "pagamento",
    "payment_type",
)
_CASH_AMOUNT_HEADERS = (
    "importocontanti",
    "contanti",
    "cash",
    "cash_amount",
    "importo_contanti",
)
_CARD_AMOUNT_HEADERS = (
    "importocarta",
    "carta",
    "bancomat",
    "pos",
    "card",
    "card_amount",
    "importo_carta",
    "pagamento_elettronico",
)
_PAYMENT_LABEL_HEADERS = ("descrizione_pagamento", "payment_label", "nome_pagamento")


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
        cash_raw = _parse_amount(_pick(row, _CASH_AMOUNT_HEADERS))
        card_raw = _parse_amount(_pick(row, _CARD_AMOUNT_HEADERS))
        payment_label = _pick(row, _PAYMENT_LABEL_HEADERS) or _pick(row, _PAYMENT_TYPE_HEADERS) or None
        ptype, cash_amt, card_amt = classify_payment(
            cash_amount=cash_raw,
            card_amount=card_raw,
            total_amount=amount,
            label=payment_label,
        )
        out.append(
            {
                "source": SOURCE_EASYRETAIL,
                "store_key": store_key,
                "model_id": model_id,
                "model_label": model_label,
                "external_id": external[:120],
                "receipt_at": when,
                "amount_eur": amount,
                "payment_type": ptype,
                "cash_amount_eur": cash_amt,
                "card_amount_eur": card_amt,
                "payment_label": payment_label[:120] if payment_label else None,
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


def _apply_payment_fields(existing: PosReceipt, row: Dict[str, Any]) -> None:
    merged = merge_payment_fields(row)
    existing.payment_type = merged.get("payment_type")
    existing.cash_amount_eur = merged.get("cash_amount_eur")
    existing.card_amount_eur = merged.get("card_amount_eur")
    existing.payment_label = merged.get("payment_label")
    existing.payment_raw = merged.get("payment_raw")


def upsert_receipts(db: Session, rows: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    """Upsert per (source, model_id, external_id).

    Prima la chiave era (source, store_key, external_id): se lo store_key cambiava
    (es. model-2 → via_abba) lo stesso scontrino veniva inserito due volte.
    """
    from .pos_store_catalog import POS_REVENUE_MODEL_ID, ZANARDELLI_MODEL_ID, _catalog_by_model_id

    inserted = 0
    updated = 0
    skipped_void = 0
    skipped_overlap = 0
    zan_external_ids: Optional[set] = None
    for row in rows:
        mid = (row.get("model_id") or "").strip() or None
        # Normalizza store_key canonico del locale (evita duplicati su alias)
        if mid:
            hit = _catalog_by_model_id(mid)
            if hit and hit.get("store_key"):
                row = {**row, "store_key": hit["store_key"], "model_label": hit.get("model_label") or row.get("model_label")}

        # Abba (model-2) non deve re-importare scontrini già syncati come Zanardelli
        if mid == POS_REVENUE_MODEL_ID:
            if zan_external_ids is None:
                zan_external_ids = _external_ids_for_model(db, model_id=ZANARDELLI_MODEL_ID, source=row.get("source") or SOURCE_EASYRETAIL)
            ext = str(row.get("external_id") or "").strip()
            if ext and ext in zan_external_ids:
                skipped_overlap += 1
                continue

        if int(row.get("is_void") or 0) == 1:
            skipped_void += 1
            existing = (
                db.query(PosReceipt)
                .filter(
                    PosReceipt.source == row["source"],
                    PosReceipt.model_id == mid,
                    PosReceipt.external_id == row["external_id"],
                )
                .order_by(PosReceipt.id.asc())
                .first()
            )
            if existing is None:
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
                existing.store_key = row["store_key"]
                existing.model_id = mid
                updated += 1
            continue

        existing = (
            db.query(PosReceipt)
            .filter(
                PosReceipt.source == row["source"],
                PosReceipt.model_id == mid,
                PosReceipt.external_id == row["external_id"],
            )
            .order_by(PosReceipt.id.asc())
            .first()
        )
        if existing is None:
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
            existing.model_id = mid
            existing.model_label = row.get("model_label")
            existing.store_key = row["store_key"]
            existing.raw_store = row.get("raw_store")
            existing.is_void = 0
            _apply_payment_fields(existing, row)
            updated += 1
            # Elimina cloni dello stesso scontrino (stesso external_id / model)
            clones = (
                db.query(PosReceipt)
                .filter(
                    PosReceipt.source == row["source"],
                    PosReceipt.external_id == row["external_id"],
                    PosReceipt.id != existing.id,
                )
                .filter(
                    (PosReceipt.model_id == mid) | (PosReceipt.store_key == row["store_key"])
                )
                .all()
            )
            for clone in clones:
                db.delete(clone)
        else:
            merged = merge_payment_fields(row)
            db.add(PosReceipt(**merged))
            inserted += 1
    db.commit()
    return {
        "inserted": inserted,
        "updated": updated,
        "skipped_void": skipped_void,
        "skipped_overlap": skipped_overlap,
    }


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
    by_payment: Dict[str, int] = defaultdict(int)
    cash_total = 0.0
    card_total = 0.0
    with_payment = 0
    latest = None
    earliest = None
    for r in q.all():
        label = r.model_label or r.store_key
        by_store[label] += 1
        ptype = (r.payment_type or "unknown").strip() or "unknown"
        by_payment[ptype] += 1
        if ptype != "unknown":
            with_payment += 1
        if r.cash_amount_eur is not None:
            cash_total += float(r.cash_amount_eur)
        elif ptype == "cash" and r.amount_eur is not None:
            cash_total += float(r.amount_eur)
        if r.card_amount_eur is not None:
            card_total += float(r.card_amount_eur)
        elif ptype == "card" and r.amount_eur is not None:
            card_total += float(r.amount_eur)
        if r.receipt_at:
            if latest is None or r.receipt_at > latest:
                latest = r.receipt_at
            if earliest is None or r.receipt_at < earliest:
                earliest = r.receipt_at
    return {
        "total": total,
        "by_store": dict(by_store),
        "by_payment_type": dict(by_payment),
        "cash_total_eur": round(cash_total, 2),
        "card_total_eur": round(card_total, 2),
        "with_payment_type": with_payment,
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
    if mid not in ("model-1", "model-2", "model-3", "model-4", "model-5"):
        raise ValueError("model_id deve essere model-1|model-2|model-3|model-4|model-5")
    q = db.query(PosReceipt).filter(PosReceipt.source == source, PosReceipt.model_id == mid)
    deleted = q.delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted": int(deleted), "model_id": mid, "source": source}


def purge_model2_overlap_with_model4(
    db: Session,
    *,
    source: str = SOURCE_EASYRETAIL,
) -> Dict[str, Any]:
    """Rimuove da model-2 (Abba) gli scontrini già presenti su model-4 (Zanardelli).

    Il GDB Abba a volte è un DB condiviso/replica e contiene anche i VEN di Zanardelli
    con lo stesso NUMEROMOVIMENTO → senza questo step Abba somma entrambe le casse.
    """
    from .pos_store_catalog import POS_REVENUE_MODEL_ID, ZANARDELLI_MODEL_ID

    zan_ids = {
        str(x[0]).strip()
        for x in db.query(PosReceipt.external_id)
        .filter(
            PosReceipt.source == source,
            PosReceipt.model_id == ZANARDELLI_MODEL_ID,
            PosReceipt.external_id.isnot(None),
        )
        .all()
        if x[0] is not None and str(x[0]).strip()
    }
    if not zan_ids:
        return {
            "ok": True,
            "deleted": 0,
            "zanardelli_ids": 0,
            "note": "nessun scontrino model-4 da confrontare",
        }

    deleted = 0
    q = (
        db.query(PosReceipt)
        .filter(PosReceipt.source == source, PosReceipt.model_id == POS_REVENUE_MODEL_ID)
        .all()
    )
    for r in q:
        ext = (r.external_id or "").strip()
        if ext and ext in zan_ids:
            db.delete(r)
            deleted += 1
    db.commit()
    return {
        "ok": True,
        "deleted": deleted,
        "zanardelli_ids": len(zan_ids),
        "model_id": POS_REVENUE_MODEL_ID,
        "overlap_with": ZANARDELLI_MODEL_ID,
    }


def _external_ids_for_model(
    db: Session,
    *,
    model_id: str,
    source: str = SOURCE_EASYRETAIL,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> set:
    q = db.query(PosReceipt.external_id).filter(
        PosReceipt.source == source,
        PosReceipt.model_id == model_id,
        PosReceipt.is_void == 0,
        PosReceipt.external_id.isnot(None),
    )
    if date_from is not None:
        q = q.filter(
            PosReceipt.receipt_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        )
    if date_to is not None:
        q = q.filter(
            PosReceipt.receipt_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        )
    return {str(x[0]).strip() for x in q.all() if x[0] is not None and str(x[0]).strip()}


def load_pos_visit_buckets(
    db: Session,
    *,
    date_from: date,
    date_to: date,
    model_id: Optional[str] = None,
    store_keys: Optional[Iterable[str]] = None,
) -> Dict[Tuple[str, int, int], Dict[str, float]]:
    """Ritorna {(model_id|all, weekday, hour): {visits, amount}} da scontrini POS."""
    from .pos_store_catalog import POS_REVENUE_MODEL_ID, POS_REVENUE_STORE_KEYS

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
    allowed_store_keys = frozenset(store_keys) if store_keys else None

    buckets: Dict[Tuple[str, int, int], Dict[str, float]] = defaultdict(
        lambda: {"visits": 0.0, "amount": 0.0, "days": set()}  # type: ignore
    )
    seen_external: set = set()
    for r in q.all():
        if not r.receipt_at:
            continue
        ext = (r.external_id or "").strip()
        mid_r = r.model_id or "unknown"
        dedupe_key = (mid_r, ext) if ext else (mid_r, r.id)
        if dedupe_key in seen_external:
            continue
        seen_external.add(dedupe_key)
        sk = (r.store_key or "").strip()
        if allowed_store_keys is not None:
            if sk not in allowed_store_keys:
                continue
        elif model_id == POS_REVENUE_MODEL_ID and sk and sk not in POS_REVENUE_STORE_KEYS:
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


def _zanardelli_near_keys(
    db: Session,
    *,
    date_from: date,
    date_to: date,
    window_sec: int = 3,
) -> set:
    """Chiavi (giorno, importo, slot_tempo) degli scontrini Zanardelli per escludere
    copie replicate nel GDB Abba quando NUMEROPOS non le distingue (sab/dom)."""
    from .pos_store_catalog import SOURCE_EASYRETAIL, ZANARDELLI_MODEL_ID

    start = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
    end = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
    rows = (
        db.query(PosReceipt.receipt_at, PosReceipt.amount_eur)
        .filter(PosReceipt.source == SOURCE_EASYRETAIL)
        .filter(PosReceipt.model_id == ZANARDELLI_MODEL_ID)
        .filter(PosReceipt.is_void == 0)
        .filter(PosReceipt.receipt_at >= start)
        .filter(PosReceipt.receipt_at <= end)
        .all()
    )
    keys: set = set()
    for when, amount in rows:
        if when is None or amount is None:
            continue
        amt = Decimal(str(amount)).quantize(Decimal("0.01"))
        # slot di 3s per tollerare piccoli scarti di timestamp tra GDB
        slot = int(when.timestamp()) // max(1, window_sec)
        keys.add((when.date().isoformat(), str(amt), slot))
    return keys


def load_pos_daily_incasso(
    db: Session,
    *,
    date_from: date,
    date_to: date,
    model_id: Optional[str] = None,
    store_keys: Optional[Iterable[str]] = None,
) -> Dict[date, Dict[str, Any]]:
    """Incasso e movimenti giornalieri da scontrini POS (Abba / Gazza Ladra / …)."""
    from .pos_store_catalog import (
        GAZZA_LADRA_MODEL_ID,
        GAZZA_LADRA_STORE_KEYS,
        POS_ONLY_MODEL_IDS,
        POS_REVENUE_MODEL_ID,
        POS_REVENUE_STORE_KEYS,
        ZANARDELLI_MODEL_ID,
        ZANARDELLI_STORE_KEYS,
    )

    mid = (model_id or "").strip() or POS_REVENUE_MODEL_ID
    if mid in ("all", "*"):
        mid = POS_REVENUE_MODEL_ID
    allowed_models = {POS_REVENUE_MODEL_ID, "model-1", "model-3"} | set(POS_ONLY_MODEL_IDS)
    if mid not in allowed_models:
        return {}

    if store_keys is not None:
        allowed_store_keys = frozenset(store_keys)
    elif mid == GAZZA_LADRA_MODEL_ID:
        allowed_store_keys = GAZZA_LADRA_STORE_KEYS
    elif mid == ZANARDELLI_MODEL_ID:
        allowed_store_keys = ZANARDELLI_STORE_KEYS
    elif mid == "model-1":
        allowed_store_keys = frozenset({"model-1", "risacca"})
    elif mid == "model-3":
        allowed_store_keys = frozenset({"model-3", "via_lattea", "lattea", "mucche"})
    else:
        allowed_store_keys = POS_REVENUE_STORE_KEYS

    start = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
    end = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
    q = (
        db.query(PosReceipt)
        .filter(PosReceipt.is_void == 0)
        .filter(PosReceipt.model_id == mid)
        .filter(PosReceipt.receipt_at >= start)
        .filter(PosReceipt.receipt_at <= end)
    )

    # Abba: escludi copie Zanardelli (stesso importo/orario) ancora presenti sotto NUMEROPOS=1
    zan_near: set = set()
    if mid == POS_REVENUE_MODEL_ID:
        zan_near = _zanardelli_near_keys(db, date_from=date_from, date_to=date_to)

    by_day: Dict[date, Dict[str, Any]] = defaultdict(
        lambda: {
            "incasso": Decimal("0.00"),
            "movimenti": 0,
            "cash_eur": Decimal("0.00"),
            "card_eur": Decimal("0.00"),
        }
    )
    seen_external: set = set()
    for r in q.all():
        if not r.receipt_at:
            continue
        # Evita doppi conteggi se lo stesso scontrino esiste con store_key diversi
        ext = (r.external_id or "").strip()
        dedupe_key = (mid, ext) if ext else (mid, r.id)
        if dedupe_key in seen_external:
            continue
        seen_external.add(dedupe_key)
        sk = (r.store_key or "").strip()
        if allowed_store_keys and sk and sk not in allowed_store_keys:
            continue
        if not sk and mid == GAZZA_LADRA_MODEL_ID:
            pass
        elif not sk and mid in ("model-1", "model-3"):
            pass
        elif not sk and allowed_store_keys and mid == POS_REVENUE_MODEL_ID:
            # Accetta scontrini Mani senza store_key se filtrati solo per model_id
            pass
        if zan_near and r.amount_eur is not None:
            amt = Decimal(str(r.amount_eur)).quantize(Decimal("0.01"))
            slot = int(r.receipt_at.timestamp()) // 3
            if (r.receipt_at.date().isoformat(), str(amt), slot) in zan_near:
                continue
        day = r.receipt_at.date()
        by_day[day]["movimenti"] += 1
        amount = Decimal(str(r.amount_eur or 0)).quantize(Decimal("0.01"))
        if r.amount_eur is not None:
            by_day[day]["incasso"] = (by_day[day]["incasso"] + amount).quantize(Decimal("0.01"))
        ptype = (r.payment_type or "unknown").strip() or "unknown"
        cash = Decimal(str(r.cash_amount_eur)) if r.cash_amount_eur is not None else Decimal("0.00")
        card = Decimal(str(r.card_amount_eur)) if r.card_amount_eur is not None else Decimal("0.00")
        if ptype == "cash" and cash <= 0 and amount > 0:
            cash = amount
        elif ptype == "card" and card <= 0 and amount > 0:
            card = amount
        by_day[day]["cash_eur"] = (by_day[day]["cash_eur"] + cash).quantize(Decimal("0.01"))
        by_day[day]["card_eur"] = (by_day[day]["card_eur"] + card).quantize(Decimal("0.01"))

    return dict(by_day)


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
        cash_amount = raw.get("cash_amount_eur")
        if cash_amount is not None and not isinstance(cash_amount, Decimal):
            cash_amount = _parse_amount(str(cash_amount))
        card_amount = raw.get("card_amount_eur")
        if card_amount is not None and not isinstance(card_amount, Decimal):
            card_amount = _parse_amount(str(card_amount))
        payment_label = str(raw.get("payment_label") or "").strip() or None
        payment_type = str(raw.get("payment_type") or "").strip() or None
        if not payment_type:
            payment_type, cash_amount, card_amount = classify_payment(
                cash_amount=cash_amount,
                card_amount=card_amount,
                total_amount=amount,
                label=payment_label,
                type_code=raw.get("payment_raw"),
            )
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
                "payment_type": payment_type,
                "cash_amount_eur": cash_amount,
                "card_amount_eur": card_amount,
                "payment_label": payment_label,
                "payment_raw": str(raw.get("payment_raw") or "")[:255] or None,
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


def payment_summary(
    db: Session,
    *,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    model_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Riepilogo incassi contanti vs carta/POS da scontrini."""
    q = db.query(PosReceipt).filter(PosReceipt.is_void == 0)
    if date_from:
        start = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        q = q.filter(PosReceipt.receipt_at >= start)
    if date_to:
        end = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        q = q.filter(PosReceipt.receipt_at <= end)
    if model_id and model_id not in ("all", "*", ""):
        q = q.filter(PosReceipt.model_id == model_id)

    totals = {
        "receipts": 0,
        "amount_eur": 0.0,
        "cash_eur": 0.0,
        "card_eur": 0.0,
        "mixed_eur": 0.0,
        "unknown_eur": 0.0,
        "other_eur": 0.0,
    }
    by_type: Dict[str, int] = defaultdict(int)
    by_store: Dict[str, Dict[str, float]] = defaultdict(
        lambda: {"receipts": 0.0, "cash_eur": 0.0, "card_eur": 0.0, "amount_eur": 0.0}
    )
    by_day: Dict[str, Dict[str, float]] = defaultdict(
        lambda: {"receipts": 0.0, "cash_eur": 0.0, "card_eur": 0.0, "amount_eur": 0.0}
    )
    by_hour: Dict[int, Dict[str, float]] = defaultdict(
        lambda: {"receipts": 0.0, "cash_eur": 0.0, "card_eur": 0.0, "amount_eur": 0.0, "movimenti": 0.0}
    )

    for r in q.all():
        totals["receipts"] += 1
        amount = float(r.amount_eur or 0)
        totals["amount_eur"] += amount
        ptype = (r.payment_type or "unknown").strip() or "unknown"
        by_type[ptype] += 1

        cash = float(r.cash_amount_eur) if r.cash_amount_eur is not None else 0.0
        card = float(r.card_amount_eur) if r.card_amount_eur is not None else 0.0
        if ptype == "cash" and cash <= 0 and amount > 0:
            cash = amount
        elif ptype == "card" and card <= 0 and amount > 0:
            card = amount
        elif ptype == "mixed" and cash <= 0 and card <= 0 and amount > 0:
            cash = amount / 2
            card = amount / 2

        totals["cash_eur"] += cash
        totals["card_eur"] += card
        if ptype == "mixed":
            totals["mixed_eur"] += amount
        elif ptype == "unknown":
            totals["unknown_eur"] += amount
        elif ptype == "other":
            totals["other_eur"] += amount

        store_label = r.model_label or r.store_key or "unknown"
        day_key = r.receipt_at.date().isoformat() if r.receipt_at else "unknown"
        for bucket in (by_store[store_label], by_day[day_key]):
            bucket["receipts"] += 1
            bucket["amount_eur"] += amount
            bucket["cash_eur"] += cash
            bucket["card_eur"] += card
        if r.receipt_at:
            hr = int(r.receipt_at.hour)
            hb = by_hour[hr]
            hb["receipts"] += 1
            hb["movimenti"] += 1
            hb["amount_eur"] += amount
            hb["cash_eur"] += cash
            hb["card_eur"] += card

    for key in totals:
        if isinstance(totals[key], float):
            totals[key] = round(totals[key], 2)

    by_hour_rows = []
    for hr in range(8, 23):
        hit = by_hour.get(hr) or {}
        by_hour_rows.append(
            {
                "hour": hr,
                "slot_label": f"{hr:02d}:00–{(hr + 1) % 24:02d}:00",
                "receipts": int(hit.get("receipts") or 0),
                "movimenti": int(hit.get("movimenti") or 0),
                "amount_eur": round(float(hit.get("amount_eur") or 0), 2),
                "cash_eur": round(float(hit.get("cash_eur") or 0), 2),
                "card_eur": round(float(hit.get("card_eur") or 0), 2),
            }
        )

    return {
        "ok": True,
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "model_id": model_id,
        "totals": totals,
        "by_payment_type": dict(by_type),
        "by_store": {k: {kk: round(vv, 2) for kk, vv in v.items()} for k, v in by_store.items()},
        "by_day": {k: {kk: round(vv, 2) for kk, vv in v.items()} for k, v in sorted(by_day.items())},
        "by_hour": by_hour_rows,
    }


def csv_template() -> str:
    return (
        "DataOra;Negozio;NumeroScontrino;Totale;TipoPagamento;ImportoContanti;ImportoCarta\n"
        "15/08/2026 12:35;Mani in Pasta;1042;18,50;Contanti;18,50;\n"
        "15/08/2026 12:41;La Risacca;2201;9,00;Bancomat;;9,00\n"
        "15/08/2026 13:02;Le Mucche Volanti;881;22,30;Misto;10,00;12,30\n"
        "15/08/2026 13:15;Gazza Ladra;501;14,00;Contanti;14,00;\n"
        "15/08/2026 13:22;Gazza Ladra;502;21,50;Pagamento elettronico;;21,50\n"
    )
