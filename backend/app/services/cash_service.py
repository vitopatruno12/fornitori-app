from datetime import datetime, date
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session
from sqlalchemy import and_, func, or_

from ..constants.prima_nota import (
    DEFAULT_PRIMA_NOTA_ACTIVITY,
    LEGACY_ACTIVITY_ALIASES,
    is_valid_activity_slug,
)
from ..models.cash_entry import CashEntry
from ..models.delivery import Delivery
from ..models.invoice import Invoice
from ..models.supplier import Supplier
from ..schemas.cash import CashEntryCreate

NON_FISCALE_CONTO = "NON_FISCALE"
POS_CONTO = "POS"
CONTANTI_CONTO = "CONTANTI"
FATTURE_EMESSE_CONTO = "FATTURE_EMESSE"
REFILL_CONTO = "REFILL"
STACKER_SVUOTAMENTO_CONTO = "SVUOTAMENTO_STACKER"
VERSAMENTO_BANCA_CONTO = "VERSAMENTO_BANCA"
EXTRA_CASSA_CONTI = (POS_CONTO, REFILL_CONTO, FATTURE_EMESSE_CONTO)
CASSA_USCITA_FORCED_CONTI = (STACKER_SVUOTAMENTO_CONTO, VERSAMENTO_BANCA_CONTO)


def normalize_activity(activity: Optional[str]) -> str:
    if not activity:
        return DEFAULT_PRIMA_NOTA_ACTIVITY
    if activity in LEGACY_ACTIVITY_ALIASES:
        activity = LEGACY_ACTIVITY_ALIASES[activity]
    if is_valid_activity_slug(activity):
        return activity
    return DEFAULT_PRIMA_NOTA_ACTIVITY


def validate_activity_param(activity: Optional[str]) -> Optional[str]:
    if activity is None:
        return None
    if activity in LEGACY_ACTIVITY_ALIASES:
        return normalize_activity(activity)
    if is_valid_activity_slug(activity):
        return activity
    raise ValueError("Attività non valida")


def _activity_filter(activity: Optional[str]):
    act = normalize_activity(activity)
    if act == DEFAULT_PRIMA_NOTA_ACTIVITY:
        return or_(CashEntry.activity == act, CashEntry.activity.is_(None))
    if act == "via_abba":
        return or_(CashEntry.activity == act, CashEntry.activity == "mediazione")
    return CashEntry.activity == act

def _is_fiscale_filter():
    return or_(
        CashEntry.conto.is_(None),
        CashEntry.conto.notin_(
            [
                NON_FISCALE_CONTO,
                POS_CONTO,
                FATTURE_EMESSE_CONTO,
                REFILL_CONTO,
                STACKER_SVUOTAMENTO_CONTO,
                VERSAMENTO_BANCA_CONTO,
            ]
        ),
    )


def _is_cassa_contanti_filter():
    """Movimenti che muovono contanti in cassa (fiscale + NC + stacker + versamento, esclusi POS e Refill)."""
    return or_(CashEntry.conto.is_(None), CashEntry.conto.notin_(EXTRA_CASSA_CONTI))


def _is_extra_cassa(conto: Optional[str]) -> bool:
    return conto in EXTRA_CASSA_CONTI


def _is_cassa_uscita_forced(conto: Optional[str]) -> bool:
    return conto in CASSA_USCITA_FORCED_CONTI


def _cash_in_filter():
    return and_(
        CashEntry.type == "entrata",
        _is_cassa_contanti_filter(),
        or_(CashEntry.conto.is_(None), CashEntry.conto.notin_(CASSA_USCITA_FORCED_CONTI)),
    )


def _cash_out_filter():
    return or_(
        and_(CashEntry.type == "uscita", _is_cassa_contanti_filter()),
        CashEntry.conto.in_(CASSA_USCITA_FORCED_CONTI),
    )


def _net_amount_for_day(
    db: Session,
    start: datetime,
    end: datetime,
    activity: Optional[str],
    *,
    conto: Optional[str] = None,
    fiscale_only: bool = False,
    cassa_contanti_only: bool = False,
) -> Decimal:
    """Saldo netto (entrate − uscite) nel giorno, filtrato per conto o solo fiscale/cassa contanti."""
    act_clause = _activity_filter(activity)
    entrate_q = db.query(func.coalesce(func.sum(CashEntry.amount), 0)).filter(
        CashEntry.entry_date >= start,
        CashEntry.entry_date <= end,
        CashEntry.type == "entrata",
        act_clause,
    )
    uscite_q = db.query(func.coalesce(func.sum(CashEntry.amount), 0)).filter(
        CashEntry.entry_date >= start,
        CashEntry.entry_date <= end,
        CashEntry.type == "uscita",
        act_clause,
    )
    if conto is not None:
        entrate_q = entrate_q.filter(CashEntry.conto == conto)
        uscite_q = uscite_q.filter(CashEntry.conto == conto)
    elif fiscale_only:
        entrate_q = entrate_q.filter(_is_fiscale_filter())
        uscite_q = uscite_q.filter(_is_fiscale_filter())
    elif cassa_contanti_only:
        entrate_q = db.query(func.coalesce(func.sum(CashEntry.amount), 0)).filter(
            CashEntry.entry_date >= start,
            CashEntry.entry_date <= end,
            _cash_in_filter(),
            act_clause,
        )
        uscite_q = db.query(func.coalesce(func.sum(CashEntry.amount), 0)).filter(
            CashEntry.entry_date >= start,
            CashEntry.entry_date <= end,
            _cash_out_filter(),
            act_clause,
        )
    entrate = Decimal(str(entrate_q.scalar() or 0)).quantize(Decimal("0.01"))
    uscite = Decimal(str(uscite_q.scalar() or 0)).quantize(Decimal("0.01"))
    return (entrate - uscite).quantize(Decimal("0.01"))


def _entrata_amount_for_day(
    db: Session,
    start: datetime,
    end: datetime,
    activity: Optional[str],
    *,
    conto: str,
) -> Decimal:
    """Somma solo le entrate nel giorno per un conto (es. POS = pagamenti ricevuti)."""
    act_clause = _activity_filter(activity)
    total = (
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(
            CashEntry.entry_date >= start,
            CashEntry.entry_date <= end,
            CashEntry.type == "entrata",
            CashEntry.conto == conto,
            act_clause,
        )
        .scalar()
    )
    return Decimal(str(total or 0)).quantize(Decimal("0.01"))


def _conto_amount_for_day(
    db: Session,
    start: datetime,
    end: datetime,
    activity: Optional[str],
    *,
    conto: str,
) -> Decimal:
    """Somma gli importi di un conto nel giorno, indipendentemente dal tipo salvato."""
    act_clause = _activity_filter(activity)
    total = (
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(
            CashEntry.entry_date >= start,
            CashEntry.entry_date <= end,
            CashEntry.conto == conto,
            act_clause,
        )
        .scalar()
    )
    return Decimal(str(total or 0)).quantize(Decimal("0.01"))


def _normalize_cash_entry_payload(payload: dict) -> dict:
    """POS solo entrata; svuotamento stacker e versamento banca solo uscita di cassa."""
    conto = payload.get("conto")
    if conto in (POS_CONTO, FATTURE_EMESSE_CONTO):
        payload = {**payload, "type": "entrata"}
    elif conto in CASSA_USCITA_FORCED_CONTI:
        payload = {**payload, "type": "uscita"}
    return payload


def list_entries(
    db: Session,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    activity: Optional[str] = None,
) -> List[CashEntry]:
    q = db.query(CashEntry).filter(_activity_filter(activity))
    if date_from:
        q = q.filter(CashEntry.entry_date >= date_from)
    if date_to:
        q = q.filter(CashEntry.entry_date <= date_to)
    return q.order_by(CashEntry.entry_date.asc(), CashEntry.id.asc()).all()


def list_entries_with_balance(
    db: Session,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    activity: Optional[str] = None,
) -> List[dict]:
    """Ritorna i movimenti con saldo progressivo calcolato."""
    entries = list_entries(db, date_from, date_to, activity=activity)
    if not entries:
        return []

    # Saldo iniziale = somma di (entrate - uscite) prima di date_from
    start = date_from
    opening = Decimal("0")
    if start:
        entrate_before = (
            db.query(func.coalesce(func.sum(CashEntry.amount), 0))
            .filter(
                CashEntry.entry_date < start,
                _cash_in_filter(),
                _activity_filter(activity),
            )
            .scalar()
        )
        uscite_before = (
            db.query(func.coalesce(func.sum(CashEntry.amount), 0))
            .filter(
                CashEntry.entry_date < start,
                _cash_out_filter(),
                _activity_filter(activity),
            )
            .scalar()
        )
        opening = (
            Decimal(str(entrate_before or 0)) - Decimal(str(uscite_before or 0))
        ).quantize(Decimal("0.01"))

    result = []
    saldo = opening
    for e in entries:
        if _is_extra_cassa(e.conto):
            delta = Decimal("0")
        elif _is_cassa_uscita_forced(e.conto):
            delta = -abs(Decimal(str(e.amount)))
        else:
            delta = Decimal(str(e.amount)) if e.type == "entrata" else -Decimal(str(e.amount))
        if delta:
            saldo = (saldo + delta).quantize(Decimal("0.01"))
        result.append({
            "id": e.id,
            "entry_date": e.entry_date,
            "type": e.type,
            "amount": e.amount,
            "description": e.description,
            "note": e.note,
            "conto": e.conto,
            "riferimento_documento": e.riferimento_documento,
            "supplier_id": e.supplier_id,
            "invoice_id": getattr(e, "invoice_id", None),
            "delivery_id": getattr(e, "delivery_id", None),
            "customer_id": getattr(e, "customer_id", None),
            "account_id": getattr(e, "account_id", None),
            "payment_method_id": getattr(e, "payment_method_id", None),
            "category_id": getattr(e, "category_id", None),
            "activity": getattr(e, "activity", None) or DEFAULT_PRIMA_NOTA_ACTIVITY,
            "created_at": e.created_at,
            "saldo_progressivo": saldo,
        })
    return result


def create_entry(db: Session, data: CashEntryCreate) -> CashEntry:
    payload = _normalize_cash_entry_payload(data.model_dump())
    e = CashEntry(
        entry_date=payload["entry_date"],
        type=payload["type"],
        amount=payload["amount"],
        description=payload.get("description"),
        note=payload.get("note"),
        conto=payload.get("conto"),
        riferimento_documento=payload.get("riferimento_documento"),
        supplier_id=payload.get("supplier_id"),
        invoice_id=payload.get("invoice_id"),
        delivery_id=payload.get("delivery_id"),
        customer_id=payload.get("customer_id"),
        account_id=payload.get("account_id"),
        payment_method_id=payload.get("payment_method_id"),
        category_id=payload.get("category_id"),
        activity=normalize_activity(payload.get("activity")),
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


def get_entry(db: Session, entry_id: int) -> Optional[CashEntry]:
    return db.query(CashEntry).filter(CashEntry.id == entry_id).first()


def update_entry(db: Session, entry_id: int, data: CashEntryCreate) -> Optional[CashEntry]:
    entry = get_entry(db, entry_id)
    if not entry:
        return None

    payload = _normalize_cash_entry_payload(data.model_dump())
    entry.entry_date = payload["entry_date"]
    entry.type = payload["type"]
    entry.amount = payload["amount"]
    entry.description = payload.get("description")
    entry.note = payload.get("note")
    entry.conto = payload.get("conto")
    entry.riferimento_documento = payload.get("riferimento_documento")
    entry.supplier_id = payload.get("supplier_id")
    entry.invoice_id = payload.get("invoice_id")
    entry.delivery_id = payload.get("delivery_id")
    entry.customer_id = payload.get("customer_id")
    entry.account_id = payload.get("account_id")
    entry.payment_method_id = payload.get("payment_method_id")
    entry.category_id = payload.get("category_id")
    if payload.get("activity") is not None:
        entry.activity = normalize_activity(payload.get("activity"))
    db.commit()
    db.refresh(entry)
    return entry


def delete_entry(db: Session, entry_id: int) -> bool:
    entry = get_entry(db, entry_id)
    if not entry:
        return False
    db.delete(entry)
    db.commit()
    return True


def delete_entries_for_day(db: Session, target_date: date, activity: Optional[str] = None) -> int:
    start = datetime.combine(target_date, datetime.min.time())
    end = datetime.combine(target_date, datetime.max.time())
    n = (
        db.query(CashEntry)
        .filter(
            CashEntry.entry_date >= start,
            CashEntry.entry_date <= end,
            _activity_filter(activity),
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(n)


def delete_entries_for_range(
    db: Session, date_from: date, date_to: date, activity: Optional[str] = None
) -> int:
    start = datetime.combine(date_from, datetime.min.time())
    end = datetime.combine(date_to, datetime.max.time())
    n = (
        db.query(CashEntry)
        .filter(
            CashEntry.entry_date >= start,
            CashEntry.entry_date <= end,
            _activity_filter(activity),
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(n)


def _get_period_summary_metrics(
    db: Session,
    start: datetime,
    end: datetime,
    activity: Optional[str] = None,
) -> dict:
    act_clause = _activity_filter(activity)

    totale_fiscale = _net_amount_for_day(db, start, end, activity, fiscale_only=True)
    totale_non_fiscale = _net_amount_for_day(db, start, end, activity, conto=NON_FISCALE_CONTO)
    totale_pos = _entrata_amount_for_day(db, start, end, activity, conto=POS_CONTO)
    totale_contanti = _entrata_amount_for_day(db, start, end, activity, conto=CONTANTI_CONTO)
    totale_fatture_emesse = _entrata_amount_for_day(db, start, end, activity, conto=FATTURE_EMESSE_CONTO)
    totale_refill = _net_amount_for_day(db, start, end, activity, conto=REFILL_CONTO)
    totale_stacker_svuotamento = _conto_amount_for_day(
        db, start, end, activity, conto=STACKER_SVUOTAMENTO_CONTO
    )
    totale_vendita = (
        totale_fiscale
        + totale_non_fiscale
        + totale_pos
        + totale_refill
    ).quantize(Decimal("0.01"))

    entrate = (
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(
            CashEntry.entry_date >= start,
            CashEntry.entry_date <= end,
            _cash_in_filter(),
            act_clause,
        )
        .scalar()
    )
    uscite = (
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(
            CashEntry.entry_date >= start,
            CashEntry.entry_date <= end,
            _cash_out_filter(),
            act_clause,
        )
        .scalar()
    )

    entrate = Decimal(str(entrate or 0)).quantize(Decimal("0.01"))
    uscite = Decimal(str(uscite or 0)).quantize(Decimal("0.01"))
    saldo_giorno = _net_amount_for_day(db, start, end, activity, cassa_contanti_only=True)

    entrate_cum = (
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(CashEntry.entry_date <= end, _cash_in_filter(), act_clause)
        .scalar()
    )
    uscite_cum = (
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(CashEntry.entry_date <= end, _cash_out_filter(), act_clause)
        .scalar()
    )
    saldo_cum = (
        Decimal(str(entrate_cum or 0)) - Decimal(str(uscite_cum or 0))
    ).quantize(Decimal("0.01"))

    return {
        "totale_entrate": entrate,
        "totale_uscite": uscite,
        "saldo_giornaliero": saldo_giorno,
        "saldo_cumulativo": saldo_cum,
        "totale_fiscale": totale_fiscale,
        "totale_non_fiscale": totale_non_fiscale,
        "totale_pos": totale_pos,
        "totale_contanti": totale_contanti,
        "totale_fatture_emesse": totale_fatture_emesse,
        "totale_refill": totale_refill,
        "totale_stacker_svuotamento": totale_stacker_svuotamento,
        "totale_vendita": totale_vendita,
    }


def get_daily_summary(db: Session, target_date: date, activity: Optional[str] = None) -> dict:
    """Ritorna totale entrate, uscite, saldo giornaliero e cumulativo per una data."""
    start = datetime.combine(target_date, datetime.min.time())
    end = datetime.combine(target_date, datetime.max.time())
    return {
        "date": target_date.isoformat(),
        **_get_period_summary_metrics(db, start, end, activity),
    }


def get_range_summary(
    db: Session, date_from: date, date_to: date, activity: Optional[str] = None
) -> dict:
    """Ritorna totali aggregati su un intervallo di date (inclusivo)."""
    if date_from > date_to:
        date_from, date_to = date_to, date_from
    start = datetime.combine(date_from, datetime.min.time())
    end = datetime.combine(date_to, datetime.max.time())
    return {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        **_get_period_summary_metrics(db, start, end, activity),
    }


def get_link_options(db: Session) -> dict:
    """Elenco compatto fatture e consegne per collegamento Prima Nota.

    Include le ultime 150 per data e, in più, ogni fattura/consegna già
    collegata a un movimento di cassa (così le etichette in Prima Nota
    risolvono sempre i documenti usati).
    """
    inv_rows = (
        db.query(Invoice, Supplier.name)
        .join(Supplier, Invoice.supplier_id == Supplier.id)
        .order_by(Invoice.invoice_date.desc())
        .limit(150)
        .all()
    )
    invoices_by_id = {
        inv.id: {
            "id": inv.id,
            "invoice_number": inv.invoice_number,
            "supplier_name": name or "",
            "total": float(inv.total) if inv.total is not None else 0.0,
        }
        for inv, name in inv_rows
    }
    cash_invoice_ids = [
        row[0]
        for row in db.query(CashEntry.invoice_id)
        .filter(CashEntry.invoice_id.isnot(None))
        .distinct()
        .all()
    ]
    missing_inv = [i for i in cash_invoice_ids if i not in invoices_by_id]
    if missing_inv:
        extra_inv = (
            db.query(Invoice, Supplier.name)
            .join(Supplier, Invoice.supplier_id == Supplier.id)
            .filter(Invoice.id.in_(missing_inv))
            .all()
        )
        for inv, name in extra_inv:
            invoices_by_id[inv.id] = {
                "id": inv.id,
                "invoice_number": inv.invoice_number,
                "supplier_name": name or "",
                "total": float(inv.total) if inv.total is not None else 0.0,
            }
    invoices = list(invoices_by_id.values())

    del_rows = (
        db.query(Delivery, Supplier.name)
        .join(Supplier, Delivery.supplier_id == Supplier.id)
        .order_by(Delivery.delivery_date.desc())
        .limit(150)
        .all()
    )
    deliveries_by_id = {
        d.id: {
            "id": d.id,
            "product_description": d.product_description,
            "supplier_name": name or "",
            "delivery_date": d.delivery_date,
        }
        for d, name in del_rows
    }
    cash_delivery_ids = [
        row[0]
        for row in db.query(CashEntry.delivery_id)
        .filter(CashEntry.delivery_id.isnot(None))
        .distinct()
        .all()
    ]
    missing_del = [i for i in cash_delivery_ids if i not in deliveries_by_id]
    if missing_del:
        extra_del = (
            db.query(Delivery, Supplier.name)
            .join(Supplier, Delivery.supplier_id == Supplier.id)
            .filter(Delivery.id.in_(missing_del))
            .all()
        )
        for d, name in extra_del:
            deliveries_by_id[d.id] = {
                "id": d.id,
                "product_description": d.product_description,
                "supplier_name": name or "",
                "delivery_date": d.delivery_date,
            }
    deliveries = list(deliveries_by_id.values())
    return {"invoices": invoices, "deliveries": deliveries}


def get_entries_for_export(
    db: Session,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    activity: Optional[str] = None,
) -> List[dict]:
    entries = [e for e in list_entries(db, date_from, date_to, activity=activity) if not _is_extra_cassa(e.conto)]
    return [
        {
            "id": e.id,
            "data": e.entry_date.isoformat() if e.entry_date else "",
            "tipo": e.type,
            "importo": float(e.amount),
            "descrizione": e.description or "",
            "conto": e.conto or "",
            "riferimento_documento": e.riferimento_documento or "",
            "note": e.note or "",
            "activity": getattr(e, "activity", None) or DEFAULT_PRIMA_NOTA_ACTIVITY,
        }
        for e in entries
    ]
