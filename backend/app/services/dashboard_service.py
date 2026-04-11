from collections import defaultdict
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Dict, List, Tuple

from sqlalchemy import extract, func, or_, desc, not_
from sqlalchemy.orm import Session

from ..models.cash_entry import CashEntry
from ..models.delivery import Delivery
from ..models.category import Category
from ..models.supplier import Supplier
from ..schemas.dashboard import (
    DashboardBreakdownItem,
    DashboardCashMovement,
    DashboardDeliveryRow,
    DashboardInvoiceSnippet,
    DashboardMonthlyFlow,
    DashboardPendingOrderSnippet,
    DashboardPriceIncrease,
    DashboardSummary,
)
from . import supplier_order_service
from .cash_service import NON_FISCALE_CONTO
from .invoice_service import list_invoices


def _fiscale_filter():
    return or_(CashEntry.conto.is_(None), CashEntry.conto != NON_FISCALE_CONTO)


def _banca_conto_sql():
    """Conti considerati banca (il resto va in saldo cassa)."""
    c = func.lower(func.coalesce(CashEntry.conto, ""))
    return or_(
        c.like("%banca%"),
        c.like("%bonific%"),
        c.like("%conto corrente%"),
        c.like("%cc %"),
        c.like("%iban%"),
        c.like("%intesa%"),
        c.like("%unicredit%"),
    )


def _saldo_bucket(db: Session, banca: bool) -> Decimal:
    """Saldo cumulativo entrate - uscite per cassa (default) o banca."""
    ent_e = db.query(func.coalesce(func.sum(CashEntry.amount), 0)).filter(
        _fiscale_filter(),
        CashEntry.type == "entrata",
    )
    usc_e = db.query(func.coalesce(func.sum(CashEntry.amount), 0)).filter(
        _fiscale_filter(),
        CashEntry.type == "uscita",
    )
    if banca:
        ent_e = ent_e.filter(_banca_conto_sql())
        usc_e = usc_e.filter(_banca_conto_sql())
    else:
        ent_e = ent_e.filter(not_(_banca_conto_sql()))
        usc_e = usc_e.filter(not_(_banca_conto_sql()))

    ent = Decimal(str(ent_e.scalar() or 0))
    usc = Decimal(str(usc_e.scalar() or 0))
    return (ent - usc).quantize(Decimal("0.01"))


def _month_bounds(now: datetime) -> Tuple[datetime, datetime, str]:
    tz = now.tzinfo or timezone.utc
    start = datetime(now.year, now.month, 1, 0, 0, 0, tzinfo=tz)
    if now.month == 12:
        end = datetime(now.year + 1, 1, 1, tzinfo=tz) - timedelta(microseconds=1)
    else:
        end = datetime(now.year, now.month + 1, 1, tzinfo=tz) - timedelta(microseconds=1)
    months_it = (
        "gennaio",
        "febbraio",
        "marzo",
        "aprile",
        "maggio",
        "giugno",
        "luglio",
        "agosto",
        "settembre",
        "ottobre",
        "novembre",
        "dicembre",
    )
    label = f"{months_it[now.month - 1]} {now.year}"
    return start, end, label


def _month_entrate_uscite(db: Session, start: datetime, end: datetime) -> Tuple[Decimal, Decimal]:
    ent = (
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(
            _fiscale_filter(),
            CashEntry.type == "entrata",
            CashEntry.entry_date >= start,
            CashEntry.entry_date <= end,
        )
        .scalar()
    )
    usc = (
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(
            _fiscale_filter(),
            CashEntry.type == "uscita",
            CashEntry.entry_date >= start,
            CashEntry.entry_date <= end,
        )
        .scalar()
    )
    return (
        Decimal(str(ent or 0)).quantize(Decimal("0.01")),
        Decimal(str(usc or 0)).quantize(Decimal("0.01")),
    )


def _iter_months_back(now: datetime, count: int) -> List[Tuple[int, int]]:
    out: List[Tuple[int, int]] = []
    y = now.year
    m = now.month
    for _ in range(count):
        out.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    out.reverse()
    return out


def _month_label_it(year: int, month: int) -> str:
    months_it = (
        "gen",
        "feb",
        "mar",
        "apr",
        "mag",
        "giu",
        "lug",
        "ago",
        "set",
        "ott",
        "nov",
        "dic",
    )
    return f"{months_it[month - 1]} {year}"


def get_summary(db: Session) -> DashboardSummary:
    now = datetime.now(timezone.utc)
    start_m, end_m, month_label = _month_bounds(now)

    saldo_cassa = _saldo_bucket(db, banca=False)
    saldo_banca = _saldo_bucket(db, banca=True)
    entrate_mese, uscite_mese = _month_entrate_uscite(db, start_m, end_m)

    all_inv = list_invoices(db)
    da_pagare_residuo = Decimal("0")
    da_pagare_count = 0
    scadute_residuo = Decimal("0")
    scadute_count = 0
    fatture_snip: List[DashboardInvoiceSnippet] = []

    now_aware = now
    today_start = datetime(now_aware.year, now_aware.month, now_aware.day, tzinfo=timezone.utc)

    for inv in all_inv:
        if inv.payment_status == "paid":
            continue
        total = Decimal(str(inv.total))
        paid = Decimal(str(inv.amount_paid or 0))
        res = (total - paid).quantize(Decimal("0.01"))
        if res <= Decimal("0.009"):
            continue
        da_pagare_count += 1
        da_pagare_residuo += res

        dd = inv.due_date
        if dd is not None:
            if dd.tzinfo is None:
                dd = dd.replace(tzinfo=timezone.utc)
            else:
                dd = dd.astimezone(timezone.utc)
            if dd < today_start:
                scadute_count += 1
                scadute_residuo += res
                if len(fatture_snip) < 6:
                    fatture_snip.append(
                        DashboardInvoiceSnippet(
                            id=inv.id,
                            supplier_name=inv.supplier_name,
                            invoice_number=inv.invoice_number,
                            due_date=inv.due_date,
                            residual=res,
                        )
                    )

    da_pagare_residuo = da_pagare_residuo.quantize(Decimal("0.01"))
    scadute_residuo = scadute_residuo.quantize(Decimal("0.01"))

    mov_rows = (
        db.query(CashEntry)
        .filter(_fiscale_filter())
        .order_by(desc(CashEntry.entry_date), desc(CashEntry.id))
        .limit(10)
        .all()
    )
    ultimi = [
        DashboardCashMovement(
            id=e.id,
            entry_date=e.entry_date,
            type=e.type,
            amount=e.amount,
            description=e.description,
            conto=e.conto,
        )
        for e in mov_rows
    ]

    del_rows = (
        db.query(Delivery, Supplier.name)
        .join(Supplier, Delivery.supplier_id == Supplier.id)
        .order_by(desc(Delivery.delivery_date), desc(Delivery.id))
        .limit(8)
        .all()
    )
    consegne = [
        DashboardDeliveryRow(
            id=d.id,
            delivery_date=d.delivery_date,
            supplier_name=name or "",
            product_description=d.product_description,
            unit_price=d.unit_price,
            total=d.total,
            ddt_number=d.ddt_number,
        )
        for d, name in del_rows
    ]

    by_key: Dict[Tuple[int, str], list] = defaultdict(list)
    # Solo consegne recenti: confronto prezzi su tutta la storia scala male con molti record.
    delivery_history_cutoff = now - timedelta(days=800)
    del_all = (
        db.query(Delivery, Supplier.name)
        .join(Supplier, Delivery.supplier_id == Supplier.id)
        .filter(Delivery.product_description.isnot(None))
        .filter(Delivery.delivery_date >= delivery_history_cutoff)
        .all()
    )
    for d, sname in del_all:
        desc_norm = (d.product_description or "").strip().lower()
        if not desc_norm:
            continue
        by_key[(d.supplier_id, desc_norm)].append((d, sname))

    increases: List[DashboardPriceIncrease] = []
    for key, items in by_key.items():
        items.sort(key=lambda x: x[0].delivery_date, reverse=True)
        if len(items) < 2:
            continue
        d_new, name_new = items[0]
        d_old, _ = items[1]
        p_new = Decimal(str(d_new.unit_price))
        p_old = Decimal(str(d_old.unit_price))
        if p_new > p_old:
            increases.append(
                DashboardPriceIncrease(
                    supplier_name=name_new or "",
                    product_description=d_new.product_description or "",
                    previous_unit_price=p_old.quantize(Decimal("0.01")),
                    latest_unit_price=p_new.quantize(Decimal("0.01")),
                    previous_date=d_old.delivery_date,
                    latest_date=d_new.delivery_date,
                )
            )
    increases.sort(key=lambda x: x.latest_date, reverse=True)
    increases = increases[:12]

    month_pairs = _iter_months_back(now, 12)
    month_set = {f"{y:04d}-{m:02d}" for y, m in month_pairs}
    first_y, first_m = month_pairs[0]
    min_chart_date = datetime(first_y, first_m, 1, 0, 0, 0, tzinfo=timezone.utc)
    monthly_rollup: Dict[str, Dict[str, Decimal]] = {
        key: {"entrate": Decimal("0"), "uscite": Decimal("0")} for key in month_set
    }
    yr_expr = extract("year", CashEntry.entry_date)
    mo_expr = extract("month", CashEntry.entry_date)
    cash_monthly = (
        db.query(yr_expr, mo_expr, CashEntry.type, func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(
            _fiscale_filter(),
            CashEntry.entry_date.isnot(None),
            CashEntry.entry_date >= min_chart_date,
        )
        .group_by(yr_expr, mo_expr, CashEntry.type)
        .all()
    )
    for yr, mo, typ, tot in cash_monthly:
        key = f"{int(yr)}-{int(mo):02d}"
        if key not in monthly_rollup:
            continue
        amount = Decimal(str(tot or 0)).quantize(Decimal("0.01"))
        if typ == "entrata":
            monthly_rollup[key]["entrate"] += amount
        elif typ == "uscita":
            monthly_rollup[key]["uscite"] += amount

    flussi_mensili: List[DashboardMonthlyFlow] = []
    for y, m in month_pairs:
        key = f"{y:04d}-{m:02d}"
        vals = monthly_rollup[key]
        flussi_mensili.append(
            DashboardMonthlyFlow(
                month_key=key,
                month_label=_month_label_it(y, m),
                entrate=vals["entrate"].quantize(Decimal("0.01")),
                uscite=vals["uscite"].quantize(Decimal("0.01")),
            )
        )

    category_rows = (
        db.query(Category.name, func.coalesce(func.sum(CashEntry.amount), 0))
        .join(Category, CashEntry.category_id == Category.id)
        .filter(_fiscale_filter(), CashEntry.type == "uscita")
        .group_by(Category.name)
        .order_by(desc(func.sum(CashEntry.amount)))
        .limit(8)
        .all()
    )
    costi_per_categoria = [
        DashboardBreakdownItem(
            label=(name or "Senza categoria"),
            amount=Decimal(str(total or 0)).quantize(Decimal("0.01")),
        )
        for name, total in category_rows
    ]

    supplier_rows = (
        db.query(Supplier.name, func.coalesce(func.sum(CashEntry.amount), 0))
        .join(Supplier, CashEntry.supplier_id == Supplier.id)
        .filter(_fiscale_filter(), CashEntry.type == "uscita")
        .group_by(Supplier.name)
        .order_by(desc(func.sum(CashEntry.amount)))
        .limit(8)
        .all()
    )
    costi_per_fornitore = [
        DashboardBreakdownItem(
            label=(name or "Senza fornitore"),
            amount=Decimal(str(total or 0)).quantize(Decimal("0.01")),
        )
        for name, total in supplier_rows
    ]

    andamento_spese_6_mesi = [
        DashboardBreakdownItem(label=row.month_label, amount=row.uscite)
        for row in flussi_mensili[-6:]
    ]

    overdue_orders = supplier_order_service.list_pending_overdue_expected_delivery(db, limit=10)
    ordini_ritardo = [
        DashboardPendingOrderSnippet(
            id=o.id,
            supplier_name=(o.supplier_name or "").strip() or "Fornitore",
            order_date=o.order_date,
            expected_delivery_date=o.expected_delivery_date,
            merchandise_summary=o.merchandise_summary,
        )
        for o in overdue_orders
    ]

    return DashboardSummary(
        month_label=month_label,
        saldo_cassa=saldo_cassa,
        saldo_banca=saldo_banca,
        entrate_mese=entrate_mese,
        uscite_mese=uscite_mese,
        fatture_da_pagare_count=da_pagare_count,
        fatture_da_pagare_residuo=da_pagare_residuo,
        fatture_scadute_count=scadute_count,
        fatture_scadute_residuo=scadute_residuo,
        ultimi_movimenti=ultimi,
        consegne_recenti=consegne,
        fornitori_prezzi_in_aumento=increases,
        fatture_scadute_elenco=fatture_snip,
        flussi_mensili=flussi_mensili,
        costi_per_categoria=costi_per_categoria,
        costi_per_fornitore=costi_per_fornitore,
        andamento_spese_6_mesi=andamento_spese_6_mesi,
        ordini_consegna_in_ritardo=ordini_ritardo,
    )
