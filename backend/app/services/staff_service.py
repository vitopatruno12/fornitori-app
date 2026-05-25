import json
from datetime import date, time, timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models.staff_member import StaffMember
from ..models.staff_payroll_month import StaffPayrollMonth
from ..models.staff_shift_entry import StaffShiftEntry
from ..schemas import staff as staff_schema


def list_members(db: Session) -> List[StaffMember]:
    return (
        db.query(StaffMember)
        .order_by(StaffMember.sort_order.asc(), StaffMember.name.asc())
        .all()
    )


def get_member(db: Session, member_id: int) -> Optional[StaffMember]:
    return db.query(StaffMember).filter(StaffMember.id == member_id).first()


def create_member(db: Session, payload: staff_schema.StaffMemberCreate) -> StaffMember:
    row = StaffMember(
        name=payload.name.strip(),
        first_name=payload.first_name,
        last_name=payload.last_name,
        email=payload.email,
        phone=payload.phone,
        city=payload.city,
        birth_date=payload.birth_date,
        sort_order=payload.sort_order,
        hourly_rate=payload.hourly_rate,
        is_active=payload.is_active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_member(db: Session, member_id: int, payload: staff_schema.StaffMemberUpdate) -> Optional[StaffMember]:
    row = db.query(StaffMember).filter(StaffMember.id == member_id).first()
    if not row:
        return None
    data = payload.model_dump(exclude_unset=True)
    if "sort_order" in data:
        row.sort_order = data["sort_order"]
    if "hourly_rate" in data:
        row.hourly_rate = data["hourly_rate"]
    if "is_active" in data:
        row.is_active = data["is_active"]
    if "email" in data:
        row.email = data["email"]
    if "phone" in data:
        row.phone = data["phone"]
    if "city" in data:
        row.city = data["city"]
    if "birth_date" in data:
        row.birth_date = data["birth_date"]
    if "first_name" in data:
        row.first_name = data["first_name"]
    if "last_name" in data:
        row.last_name = data["last_name"]
    if "first_name" in data or "last_name" in data:
        fn = (row.first_name or "").strip() or None
        ln = (row.last_name or "").strip() or None
        row.first_name = fn
        row.last_name = ln
        combined = f"{fn or ''} {ln or ''}".strip()
        if combined:
            row.name = combined[:255]
    elif "name" in data:
        row.name = data["name"].strip()
    db.commit()
    db.refresh(row)
    return row


def delete_member(db: Session, member_id: int) -> bool:
    row = db.query(StaffMember).filter(StaffMember.id == member_id).first()
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def delete_all_members(db: Session) -> int:
    """Elimina tutti i dipendenti; le voci di pianificazione collegate vanno via in CASCADE."""
    n = db.query(StaffMember).delete(synchronize_session=False)
    db.commit()
    return int(n)


def _validate_times(kind: str, t0: Optional[time], t1: Optional[time]) -> None:
    if kind == "shift":
        if t0 is None or t1 is None:
            raise ValueError("Per un turno indicare ora inizio e ora fine")
        return
    if kind == "permission":
        if (t0 is None) ^ (t1 is None):
            raise ValueError("Per il permesso indicare sia inizio sia fine, oppure nessuno (solo note)")


def create_shift(db: Session, payload: staff_schema.StaffShiftCreate) -> StaffShiftEntry:
    m = db.query(StaffMember).filter(StaffMember.id == payload.staff_member_id).first()
    if not m:
        raise ValueError("Dipendente non trovato")
    _validate_times(payload.entry_kind, payload.time_start, payload.time_end)
    row = StaffShiftEntry(
        staff_member_id=payload.staff_member_id,
        work_date=payload.work_date,
        time_start=payload.time_start,
        time_end=payload.time_end,
        entry_kind=payload.entry_kind,
        notes=(payload.notes.strip() if payload.notes else None),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_shift(db: Session, shift_id: int, payload: staff_schema.StaffShiftUpdate) -> Optional[StaffShiftEntry]:
    row = db.query(StaffShiftEntry).filter(StaffShiftEntry.id == shift_id).first()
    if not row:
        return None
    data = payload.model_dump(exclude_unset=True)
    if "staff_member_id" in data:
        m = db.query(StaffMember).filter(StaffMember.id == data["staff_member_id"]).first()
        if not m:
            raise ValueError("Dipendente non trovato")
        row.staff_member_id = data["staff_member_id"]
    if "work_date" in data:
        row.work_date = data["work_date"]
    if "time_start" in data:
        row.time_start = data["time_start"]
    if "time_end" in data:
        row.time_end = data["time_end"]
    if "entry_kind" in data:
        row.entry_kind = data["entry_kind"]
    if "notes" in data:
        row.notes = data["notes"].strip() if data["notes"] else None
    _validate_times(row.entry_kind, row.time_start, row.time_end)
    db.commit()
    db.refresh(row)
    return row


def shift_to_read(db: Session, row: StaffShiftEntry) -> staff_schema.StaffShiftRead:
    name = db.query(StaffMember.name).filter(StaffMember.id == row.staff_member_id).scalar()
    return staff_schema.StaffShiftRead(
        id=row.id,
        staff_member_id=row.staff_member_id,
        staff_member_name=name or "",
        work_date=row.work_date,
        time_start=row.time_start,
        time_end=row.time_end,
        entry_kind=row.entry_kind,
        notes=row.notes,
    )


def delete_shift(db: Session, shift_id: int) -> bool:
    row = db.query(StaffShiftEntry).filter(StaffShiftEntry.id == shift_id).first()
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def delete_shifts_between(db: Session, date_from: date, date_to: date) -> int:
    """Elimina tutte le voci di pianificazione con work_date nell'intervallo inclusivo."""
    if date_to < date_from:
        raise ValueError("Intervallo date non valido")
    n = (
        db.query(StaffShiftEntry)
        .filter(StaffShiftEntry.work_date >= date_from, StaffShiftEntry.work_date <= date_to)
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(n)


def list_shifts_range(db: Session, date_from: date, date_to: date) -> List[staff_schema.StaffShiftRead]:
    rows = (
        db.query(StaffShiftEntry, StaffMember.name)
        .join(StaffMember, StaffMember.id == StaffShiftEntry.staff_member_id)
        .filter(StaffShiftEntry.work_date >= date_from, StaffShiftEntry.work_date <= date_to)
        .order_by(
            StaffShiftEntry.work_date.asc(),
            StaffMember.sort_order.asc(),
            StaffMember.name.asc(),
            StaffShiftEntry.time_start.asc(),
        )
        .all()
    )
    out: List[staff_schema.StaffShiftRead] = []
    for ent, mname in rows:
        out.append(
            staff_schema.StaffShiftRead(
                id=ent.id,
                staff_member_id=ent.staff_member_id,
                staff_member_name=mname,
                work_date=ent.work_date,
                time_start=ent.time_start,
                time_end=ent.time_end,
                entry_kind=ent.entry_kind,
                notes=ent.notes,
            )
        )
    return out


def sunday_start(d: date) -> date:
    """Inizio settimana (domenica) per la data d."""
    wd = d.weekday()  # Mon=0 .. Sun=6
    # Convert: we want Sunday=0 as start. Python Monday=0.
    # Sunday -> 6 in weekday(); we need offset to go back to Sunday.
    if wd == 6:
        return d
    return d - timedelta(days=wd + 1)


def saturday_end(sunday: date) -> date:
    return sunday + timedelta(days=6)


def _lines_to_json(lines: List[staff_schema.StaffPayrollMonthLine]) -> str:
    return json.dumps([ln.model_dump() for ln in lines], ensure_ascii=False)


def _lines_from_json(raw: str) -> List[staff_schema.StaffPayrollMonthLine]:
    try:
        data = json.loads(raw or "[]")
    except json.JSONDecodeError:
        data = []
    out: List[staff_schema.StaffPayrollMonthLine] = []
    if not isinstance(data, list):
        return out
    for item in data:
        if isinstance(item, dict):
            out.append(staff_schema.StaffPayrollMonthLine.model_validate(item))
    return out


def _total_from_lines(lines: List[staff_schema.StaffPayrollMonthLine]) -> float:
    return round(sum(float(ln.amount or 0) for ln in lines), 2)


def payroll_month_to_read(row: StaffPayrollMonth) -> staff_schema.StaffPayrollMonthRead:
    lines = _lines_from_json(row.lines_json)
    return staff_schema.StaffPayrollMonthRead(
        id=row.id,
        year_month=row.year_month,
        period_from=row.period_from,
        period_to=row.period_to,
        lines=lines,
        total_amount=float(row.total_amount or 0),
        notes=row.notes,
    )


def list_payroll_months(db: Session) -> List[staff_schema.StaffPayrollMonthRead]:
    rows = (
        db.query(StaffPayrollMonth)
        .order_by(StaffPayrollMonth.year_month.desc())
        .all()
    )
    return [payroll_month_to_read(r) for r in rows]


def get_payroll_month(db: Session, month_id: int) -> Optional[staff_schema.StaffPayrollMonthRead]:
    row = db.query(StaffPayrollMonth).filter(StaffPayrollMonth.id == month_id).first()
    if not row:
        return None
    return payroll_month_to_read(row)


def get_payroll_month_by_ym(db: Session, year_month: str) -> Optional[staff_schema.StaffPayrollMonthRead]:
    row = db.query(StaffPayrollMonth).filter(StaffPayrollMonth.year_month == year_month).first()
    if not row:
        return None
    return payroll_month_to_read(row)


def create_payroll_month(
    db: Session, payload: staff_schema.StaffPayrollMonthCreate
) -> staff_schema.StaffPayrollMonthRead:
    existing = (
        db.query(StaffPayrollMonth)
        .filter(StaffPayrollMonth.year_month == payload.year_month)
        .first()
    )
    if existing:
        raise ValueError(f"Esiste già un archivio per {payload.year_month}")
    total = _total_from_lines(payload.lines)
    row = StaffPayrollMonth(
        year_month=payload.year_month,
        period_from=payload.period_from,
        period_to=payload.period_to,
        lines_json=_lines_to_json(payload.lines),
        total_amount=total,
        notes=payload.notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return payroll_month_to_read(row)


def update_payroll_month(
    db: Session, month_id: int, payload: staff_schema.StaffPayrollMonthUpdate
) -> Optional[staff_schema.StaffPayrollMonthRead]:
    row = db.query(StaffPayrollMonth).filter(StaffPayrollMonth.id == month_id).first()
    if not row:
        return None
    if payload.period_from is not None:
        row.period_from = payload.period_from
    if payload.period_to is not None:
        row.period_to = payload.period_to
    if payload.period_from and payload.period_to and payload.period_to < payload.period_from:
        raise ValueError("period_to deve essere >= period_from")
    row.lines_json = _lines_to_json(payload.lines)
    row.total_amount = _total_from_lines(payload.lines)
    if payload.notes is not None:
        row.notes = payload.notes.strip() or None
    db.commit()
    db.refresh(row)
    return payroll_month_to_read(row)


def delete_payroll_month(db: Session, month_id: int) -> bool:
    row = db.query(StaffPayrollMonth).filter(StaffPayrollMonth.id == month_id).first()
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
