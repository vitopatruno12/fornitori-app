from datetime import datetime, date
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from ..models.cash_entry import CashEntry
from ..models.delivery import Delivery
from ..models.invoice import Invoice
from ..models.supplier import Supplier
from ..schemas.cash import CashEntryCreate

NON_FISCALE_CONTO = "NON_FISCALE"

def _is_fiscale_filter():
    return or_(CashEntry.conto.is_(None), CashEntry.conto != NON_FISCALE_CONTO)


def list_entries(
    db: Session,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
) -> List[CashEntry]:
    q = db.query(CashEntry)
    if date_from:
        q = q.filter(CashEntry.entry_date >= date_from)
    if date_to:
        q = q.filter(CashEntry.entry_date <= date_to)
    return q.order_by(CashEntry.entry_date.asc(), CashEntry.id.asc()).all()


def list_entries_with_balance(
    db: Session,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
) -> List[dict]:
    """Ritorna i movimenti con saldo progressivo calcolato."""
    entries = list_entries(db, date_from, date_to)
    if not entries:
        return []

    # Saldo iniziale = somma di (entrate - uscite) prima di date_from
    start = date_from
    opening = Decimal("0")
    if start:
        entrate_before = (
            db.query(func.coalesce(func.sum(CashEntry.amount), 0))
            .filter(CashEntry.entry_date < start, CashEntry.type == "entrata", _is_fiscale_filter())
            .scalar()
        )
        uscite_before = (
            db.query(func.coalesce(func.sum(CashEntry.amount), 0))
            .filter(CashEntry.entry_date < start, CashEntry.type == "uscita", _is_fiscale_filter())
            .scalar()
        )
        opening = (
            Decimal(str(entrate_before or 0)) - Decimal(str(uscite_before or 0))
        ).quantize(Decimal("0.01"))

    result = []
    saldo = opening
    for e in entries:
        if e.conto != NON_FISCALE_CONTO:
            delta = Decimal(str(e.amount)) if e.type == "entrata" else -Decimal(str(e.amount))
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
            "created_at": e.created_at,
            "saldo_progressivo": saldo,
        })
    return result


def create_entry(db: Session, data: CashEntryCreate) -> CashEntry:
    payload = data.model_dump()
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

    payload = data.model_dump()
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


def delete_entries_for_day(db: Session, target_date: date) -> int:
    start = datetime.combine(target_date, datetime.min.time())
    end = datetime.combine(target_date, datetime.max.time())
    n = (
        db.query(CashEntry)
        .filter(CashEntry.entry_date >= start, CashEntry.entry_date <= end)
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(n)


def delete_entries_for_range(db: Session, date_from: date, date_to: date) -> int:
    start = datetime.combine(date_from, datetime.min.time())
    end = datetime.combine(date_to, datetime.max.time())
    n = (
        db.query(CashEntry)
        .filter(CashEntry.entry_date >= start, CashEntry.entry_date <= end)
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(n)


def get_daily_summary(db: Session, target_date: date) -> dict:
    """Ritorna totale entrate, uscite, saldo giornaliero e cumulativo per una data."""
    start = datetime.combine(target_date, datetime.min.time())
    end = datetime.combine(target_date, datetime.max.time())

    entrate = (
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(CashEntry.entry_date >= start, CashEntry.entry_date <= end, CashEntry.type == "entrata", _is_fiscale_filter())
        .scalar()
    )
    uscite = (
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(CashEntry.entry_date >= start, CashEntry.entry_date <= end, CashEntry.type == "uscita", _is_fiscale_filter())
        .scalar()
    )

    entrate = Decimal(str(entrate or 0)).quantize(Decimal("0.01"))
    uscite = Decimal(str(uscite or 0)).quantize(Decimal("0.01"))
    saldo_giorno = (entrate - uscite).quantize(Decimal("0.01"))

    # Saldo cumulativo = somma di (entrate - uscite) fino a fine giornata
    entrate_cum = (
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(CashEntry.entry_date <= end, CashEntry.type == "entrata", _is_fiscale_filter())
        .scalar()
    )
    uscite_cum = (
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(CashEntry.entry_date <= end, CashEntry.type == "uscita", _is_fiscale_filter())
        .scalar()
    )
    saldo_cum = (
        Decimal(str(entrate_cum or 0)) - Decimal(str(uscite_cum or 0))
    ).quantize(Decimal("0.01"))

    return {
        "date": target_date.isoformat(),
        "totale_entrate": entrate,
        "totale_uscite": uscite,
        "saldo_giornaliero": saldo_giorno,
        "saldo_cumulativo": saldo_cum,
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
) -> List[dict]:
    entries = [e for e in list_entries(db, date_from, date_to) if e.conto != NON_FISCALE_CONTO]
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
        }
        for e in entries
    ]
