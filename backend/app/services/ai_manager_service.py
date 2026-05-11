"""AI Manager: monitora trasversalmente lo stato dell'app e produce 'insight'.

Ogni insight è un breve avviso/azione suggerita che il frontend mostra come pop-up.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from ..models.cash_entry import CashEntry
from ..models.delivery import Delivery
from ..models.invoice import Invoice
from ..models.staff_member import StaffMember
from ..models.staff_shift_entry import StaffShiftEntry
from ..models.supplier import Supplier
from ..models.supplier_order import SupplierOrder


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _insight(
    *,
    key: str,
    severity: str,
    category: str,
    title: str,
    message: str,
    target_page: str | None = None,
    count: int | None = None,
    payload: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    return {
        "id": key,
        "severity": severity,  # info | warning | critical
        "category": category,  # orders | deliveries | invoices | suppliers | staff | prima_nota | sistema
        "title": title,
        "message": message,
        "target_page": target_page,
        "count": count,
        "payload": payload or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _orders_insights(db: Session) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    today = _today()

    overdue = (
        db.query(SupplierOrder)
        .filter(SupplierOrder.status == "pending")
        .filter(SupplierOrder.expected_delivery_date.isnot(None))
        .filter(SupplierOrder.expected_delivery_date < today)
        .all()
    )
    if overdue:
        examples = ", ".join(
            f"#{o.sequence_number or o.id} ({o.supplier_name_snapshot or 'Fornitore'})"
            for o in overdue[:3]
        )
        more = f" e altri {len(overdue) - 3}" if len(overdue) > 3 else ""
        out.append(
            _insight(
                key=f"orders_overdue:{today.isoformat()}:{len(overdue)}",
                severity="warning",
                category="orders",
                title="Ordini in sospeso oltre la data prevista",
                message=f"Ci sono {len(overdue)} ordini ancora in sospeso con consegna prevista già passata: {examples}{more}.",
                target_page="new-order",
                count=len(overdue),
                payload={"order_ids": [o.id for o in overdue[:10]]},
            )
        )

    week_ago = today - timedelta(days=7)
    pending_old = (
        db.query(SupplierOrder)
        .filter(SupplierOrder.status == "pending")
        .filter(SupplierOrder.order_date <= week_ago)
        .filter(SupplierOrder.expected_delivery_date.is_(None))
        .all()
    )
    if pending_old:
        out.append(
            _insight(
                key=f"orders_old_pending:{today.isoformat()}:{len(pending_old)}",
                severity="info",
                category="orders",
                title="Ordini in sospeso da oltre 7 giorni",
                message=f"{len(pending_old)} ordini sono in sospeso da più di una settimana e non hanno data consegna prevista. Considera di sollecitare o aggiornare lo stato.",
                target_page="new-order",
                count=len(pending_old),
            )
        )
    return out


def _deliveries_insights(db: Session) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    today = _today()
    month_start = today.replace(day=1)
    anomalies = (
        db.query(Delivery)
        .filter(Delivery.delivery_date >= month_start)
        .filter(Delivery.anomaly_note.isnot(None))
        .all()
    )
    real_anom = [d for d in anomalies if (d.anomaly_note or "").strip()]
    if real_anom:
        out.append(
            _insight(
                key=f"deliveries_anomalies_month:{month_start.isoformat()}:{len(real_anom)}",
                severity="warning",
                category="deliveries",
                title="Consegne con anomalie nel mese",
                message=f"Questo mese hai {len(real_anom)} consegne con note anomalia. Controllali nello Storico.",
                target_page="history",
                count=len(real_anom),
            )
        )

    ddt_counts = defaultdict(list)
    recent = (
        db.query(Delivery)
        .filter(Delivery.ddt_number.isnot(None))
        .filter(Delivery.delivery_date >= today - timedelta(days=120))
        .all()
    )
    for d in recent:
        ddt = (d.ddt_number or "").strip().lower()
        if not ddt:
            continue
        ddt_counts[(d.supplier_id, ddt)].append(d)
    dups = [(k, v) for k, v in ddt_counts.items() if len(v) > 1]
    if dups:
        out.append(
            _insight(
                key=f"deliveries_ddt_dups:{today.isoformat()}:{len(dups)}",
                severity="critical",
                category="deliveries",
                title="DDT duplicati per stesso fornitore",
                message=f"Trovati {len(dups)} casi di numero DDT ripetuto per lo stesso fornitore (ultimi 120 giorni). Verifica subito in Storico.",
                target_page="history",
                count=len(dups),
            )
        )
    return out


def _invoices_insights(db: Session) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    today = _today()
    overdue_q = (
        db.query(Invoice)
        .filter(Invoice.ignored.is_(False))
        .filter(Invoice.is_paid.is_(False))
        .filter(Invoice.due_date.isnot(None))
        .filter(Invoice.due_date < datetime(today.year, today.month, today.day, tzinfo=timezone.utc))
        .all()
    )
    if overdue_q:
        total = sum(float((inv.total or 0) - (inv.amount_paid or 0)) for inv in overdue_q)
        out.append(
            _insight(
                key=f"invoices_overdue:{today.isoformat()}:{len(overdue_q)}",
                severity="warning",
                category="invoices",
                title="Fatture scadute non pagate",
                message=f"Hai {len(overdue_q)} fatture scadute non saldate per un totale di € {total:,.2f}.",
                target_page="invoices",
                count=len(overdue_q),
            )
        )

    in7 = today + timedelta(days=7)
    soon = (
        db.query(Invoice)
        .filter(Invoice.ignored.is_(False))
        .filter(Invoice.is_paid.is_(False))
        .filter(Invoice.due_date.isnot(None))
        .filter(Invoice.due_date >= datetime(today.year, today.month, today.day, tzinfo=timezone.utc))
        .filter(Invoice.due_date <= datetime(in7.year, in7.month, in7.day, tzinfo=timezone.utc))
        .all()
    )
    if soon:
        total = sum(float((inv.total or 0) - (inv.amount_paid or 0)) for inv in soon)
        out.append(
            _insight(
                key=f"invoices_soon:{today.isoformat()}:{len(soon)}",
                severity="info",
                category="invoices",
                title="Fatture in scadenza nei prossimi 7 giorni",
                message=f"{len(soon)} fatture per € {total:,.2f} scadono entro 7 giorni.",
                target_page="invoices",
                count=len(soon),
            )
        )
    return out


def _suppliers_insights(db: Session) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    today = _today()
    expired = db.query(Supplier).filter(Supplier.is_expired.is_(True)).all()
    if expired:
        names = ", ".join(s.name for s in expired[:3])
        more = f" e altri {len(expired) - 3}" if len(expired) > 3 else ""
        out.append(
            _insight(
                key=f"suppliers_expired:{today.isoformat()}:{len(expired)}",
                severity="warning",
                category="suppliers",
                title="Fornitori con rapporto/documenti scaduti",
                message=f"{len(expired)} fornitori risultano scaduti: {names}{more}. Aggiorna i contratti o disattivali.",
                target_page="suppliers",
                count=len(expired),
            )
        )

    incomplete = (
        db.query(Supplier)
        .filter(Supplier.is_active.is_(True))
        .filter((Supplier.vat_number.is_(None)) | (Supplier.vat_number == ""))
        .all()
    )
    if incomplete:
        out.append(
            _insight(
                key=f"suppliers_no_vat:{today.isoformat()}:{len(incomplete)}",
                severity="info",
                category="suppliers",
                title="Fornitori attivi senza Partita IVA",
                message=f"{len(incomplete)} fornitori attivi non hanno la P.IVA. Completa l'anagrafica.",
                target_page="suppliers",
                count=len(incomplete),
            )
        )
    return out


def _staff_insights(db: Session) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    today = _today()
    horizon = today + timedelta(days=7)
    shifts = (
        db.query(StaffShiftEntry.work_date)
        .filter(StaffShiftEntry.work_date >= today)
        .filter(StaffShiftEntry.work_date <= horizon)
        .filter(StaffShiftEntry.entry_kind == "shift")
        .all()
    )
    days_covered = {row[0] for row in shifts}
    uncovered = []
    cur = today
    while cur <= horizon:
        if cur not in days_covered:
            uncovered.append(cur)
        cur += timedelta(days=1)
    if uncovered:
        ex = ", ".join(d.strftime("%d/%m") for d in uncovered[:3])
        more = f" e altri {len(uncovered) - 3}" if len(uncovered) > 3 else ""
        out.append(
            _insight(
                key=f"staff_uncovered:{today.isoformat()}:{len(uncovered)}",
                severity="warning",
                category="staff",
                title="Giorni senza turni pianificati",
                message=f"Prossimi 7 giorni: {len(uncovered)} giorni senza turni assegnati ({ex}{more}). Vai in Personale per coprirli.",
                target_page="staff",
                count=len(uncovered),
            )
        )

    sick_today = (
        db.query(StaffShiftEntry)
        .filter(StaffShiftEntry.work_date == today)
        .filter(StaffShiftEntry.entry_kind == "sick")
        .all()
    )
    if sick_today:
        out.append(
            _insight(
                key=f"staff_sick_today:{today.isoformat()}:{len(sick_today)}",
                severity="info",
                category="staff",
                title="Malattie registrate oggi",
                message=f"{len(sick_today)} dipendenti in malattia oggi. Verifica che i turni siano coperti.",
                target_page="staff",
                count=len(sick_today),
            )
        )

    members = db.query(StaffMember).filter(StaffMember.is_active.is_(True)).count()
    if members == 0:
        out.append(
            _insight(
                key=f"staff_no_members:{today.isoformat()}",
                severity="info",
                category="staff",
                title="Nessun dipendente attivo",
                message="Non hai dipendenti attivi in elenco. Aggiungili nella sezione Personale.",
                target_page="staff",
            )
        )
    return out


def _prima_nota_insights(db: Session) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    today = _today()
    no_cat = (
        db.query(CashEntry)
        .filter(CashEntry.entry_date >= datetime(today.year, today.month, 1, tzinfo=timezone.utc))
        .filter(CashEntry.category_id.is_(None))
        .all()
    )
    if no_cat:
        out.append(
            _insight(
                key=f"prima_nota_no_cat:{today.isoformat()}:{len(no_cat)}",
                severity="info",
                category="prima_nota",
                title="Movimenti senza categoria",
                message=f"{len(no_cat)} movimenti del mese non hanno categoria. Assegna le categorie per migliori report.",
                target_page="prima-nota",
                count=len(no_cat),
            )
        )
    return out


def gather_insights(db: Session) -> Dict[str, Any]:
    insights: List[Dict[str, Any]] = []
    try:
        insights += _orders_insights(db)
    except Exception:
        pass
    try:
        insights += _deliveries_insights(db)
    except Exception:
        pass
    try:
        insights += _invoices_insights(db)
    except Exception:
        pass
    try:
        insights += _suppliers_insights(db)
    except Exception:
        pass
    try:
        insights += _staff_insights(db)
    except Exception:
        pass
    try:
        insights += _prima_nota_insights(db)
    except Exception:
        pass

    severity_order = {"critical": 0, "warning": 1, "info": 2}
    insights.sort(key=lambda x: (severity_order.get(x.get("severity"), 9), x.get("category", ""), x.get("title", "")))

    counts_by_severity: Dict[str, int] = defaultdict(int)
    counts_by_category: Dict[str, int] = defaultdict(int)
    for it in insights:
        counts_by_severity[it.get("severity", "info")] += 1
        counts_by_category[it.get("category", "altro")] += 1

    return {
        "insights": insights,
        "summary": {
            "total": len(insights),
            "by_severity": dict(counts_by_severity),
            "by_category": dict(counts_by_category),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
