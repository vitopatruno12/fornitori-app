import json
import re
import secrets
from datetime import date, time, timedelta
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.staff_backup import StaffBackup
from ..models.staff_locale_pack import StaffLocalePack
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


def _next_member_sort_order(db: Session) -> int:
    current_max = db.query(func.coalesce(func.max(StaffMember.sort_order), -1)).scalar()
    return int(current_max) + 1


def create_member(db: Session, payload: staff_schema.StaffMemberCreate) -> StaffMember:
    row = StaffMember(
        name=payload.name.strip(),
        first_name=payload.first_name,
        last_name=payload.last_name,
        email=payload.email,
        phone=payload.phone,
        city=payload.city,
        birth_date=payload.birth_date,
        sort_order=_next_member_sort_order(db),
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


def _normalize_locale_name(name: str) -> str:
    return (name or "").strip()


def _locale_name_key(name: str) -> str:
    return re.sub(r"[\s_\-]+", "", _normalize_locale_name(name).casefold())


def _members_fingerprint(members: List[staff_schema.StaffLocaleMemberSnapshot]) -> str:
    keys: List[str] = []
    for m in members:
        label = (m.name or "").strip().casefold()
        if not label:
            parts = [(m.first_name or "").strip().casefold(), (m.last_name or "").strip().casefold()]
            label = " ".join(p for p in parts if p).strip()
        if label:
            keys.append(label)
    return "\n".join(sorted(keys))


def _find_locale_pack_by_key(db: Session, locale_name: str) -> Optional[StaffLocalePack]:
    key = _locale_name_key(locale_name)
    if not key:
        return None
    rows = db.query(StaffLocalePack).all()
    for row in rows:
        if _locale_name_key(row.locale_name) == key:
            return row
    return None


def _locale_members_to_json(members: List[staff_schema.StaffLocaleMemberSnapshot]) -> str:
    return json.dumps([m.model_dump(mode="json") for m in members], ensure_ascii=False)


def _locale_members_from_json(raw: str) -> List[staff_schema.StaffLocaleMemberSnapshot]:
    try:
        data = json.loads(raw or "[]")
        if not isinstance(data, list):
            return []
        out: List[staff_schema.StaffLocaleMemberSnapshot] = []
        for item in data:
            if isinstance(item, dict) and item.get("name"):
                out.append(staff_schema.StaffLocaleMemberSnapshot.model_validate(item))
        return out
    except (json.JSONDecodeError, ValueError):
        return []


def _normalize_access_code(code: Optional[str]) -> str:
    digits = re.sub(r"\D", "", str(code or ""))
    return digits if len(digits) == 6 else ""


def _generate_access_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _resolve_locale_access_code(
    payload: staff_schema.StaffLocalePackUpsert,
    existing: Optional[str],
) -> str:
    if payload.regenerate_access_code:
        return _generate_access_code()
    if payload.access_code:
        normalized = _normalize_access_code(payload.access_code)
        if not normalized:
            raise ValueError("Codice locale non valido: servono 6 cifre numeriche.")
        return normalized
    if existing:
        normalized = _normalize_access_code(existing)
        if normalized:
            return normalized
    return _generate_access_code()


def locale_pack_to_summary(row: StaffLocalePack) -> staff_schema.StaffLocalePackSummary:
    members = _locale_members_from_json(row.members_json)
    saved_at = row.updated_at.isoformat() if row.updated_at else None
    return staff_schema.StaffLocalePackSummary(
        locale_name=row.locale_name,
        saved_at=saved_at,
        member_count=len(members),
        requires_access_code=bool(_normalize_access_code(row.access_code)),
    )


def locale_pack_to_read(
    row: StaffLocalePack,
    *,
    include_access_code: bool = False,
) -> staff_schema.StaffLocalePackRead:
    members = _locale_members_from_json(row.members_json)
    saved_at = row.updated_at.isoformat() if row.updated_at else None
    code = _normalize_access_code(row.access_code) or None
    return staff_schema.StaffLocalePackRead(
        locale_name=row.locale_name,
        saved_at=saved_at,
        members=members,
        access_code=code if include_access_code else None,
    )


def list_locale_packs(db: Session) -> List[staff_schema.StaffLocalePackSummary]:
    rows = (
        db.query(StaffLocalePack)
        .order_by(StaffLocalePack.locale_name.asc())
        .all()
    )
    return [locale_pack_to_summary(r) for r in rows]


def get_locale_pack(
    db: Session,
    locale_name: str,
    access_code: Optional[str] = None,
) -> Optional[staff_schema.StaffLocalePackRead]:
    row = _find_locale_pack_by_key(db, locale_name)
    if not row:
        return None
    stored_code = _normalize_access_code(row.access_code)
    if stored_code:
        provided = _normalize_access_code(access_code)
        if provided != stored_code:
            raise ValueError("Codice locale non valido.")
    return locale_pack_to_read(row)


def upsert_locale_pack(
    db: Session, payload: staff_schema.StaffLocalePackUpsert
) -> staff_schema.StaffLocalePackRead:
    key = _normalize_locale_name(payload.locale_name)
    if not key:
        raise ValueError("Nome locale non valido")
    if not payload.members:
        raise ValueError("Aggiungi almeno un dipendente prima di salvare il locale.")

    new_fp = _members_fingerprint(payload.members)
    rows = db.query(StaffLocalePack).all()
    target = None
    for row in rows:
        row_key = _locale_name_key(row.locale_name)
        if row_key == _locale_name_key(key):
            target = row
            continue
        if new_fp:
            existing_fp = _members_fingerprint(_locale_members_from_json(row.members_json))
            if existing_fp == new_fp:
                raise ValueError(
                    f'Questa lista dipendenti è già salvata come "{row.locale_name}". '
                    f'Usa quel nome oppure modifica l\'elenco prima di associarlo a "{key}".'
                )

    members_json = _locale_members_to_json(payload.members)
    access_code = _resolve_locale_access_code(payload, target.access_code if target else None)
    if target:
        target.members_json = members_json
        target.access_code = access_code
        row = target
    else:
        row = StaffLocalePack(
            locale_name=key,
            members_json=members_json,
            access_code=access_code,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return locale_pack_to_read(row, include_access_code=True)


def delete_locale_pack(
    db: Session,
    locale_name: str,
    access_code: Optional[str] = None,
) -> bool:
    key = _normalize_locale_name(locale_name)
    if not key:
        raise ValueError("Nome locale non valido")
    row = _find_locale_pack_by_key(db, locale_name)
    if not row:
        return False
    stored_code = _normalize_access_code(row.access_code)
    if stored_code:
        provided = _normalize_access_code(access_code)
        if provided != stored_code:
            raise ValueError("Codice locale non valido.")
    db.delete(row)
    db.commit()
    return True


def _normalize_backup_section(section: str) -> str:
    sec = (section or "").strip().lower()
    if sec not in ("planning", "payroll"):
        raise ValueError("Sezione backup non valida")
    return sec


def _backup_key(section: str, backup_key: str) -> tuple[str, str]:
    sec = _normalize_backup_section(section)
    key = (backup_key or "").strip()
    if not key:
        raise ValueError("Chiave backup non valida")
    return sec, key


def backup_to_read(row: StaffBackup) -> staff_schema.StaffBackupRead:
    try:
        payload = json.loads(row.payload_json or "{}")
        if not isinstance(payload, dict):
            payload = {}
    except json.JSONDecodeError:
        payload = {}
    saved_at = row.updated_at.isoformat() if row.updated_at else None
    return staff_schema.StaffBackupRead(
        section=row.section,
        backup_key=row.backup_key,
        saved_at=saved_at,
        payload=payload,
    )


def list_backups(db: Session, section: str) -> List[staff_schema.StaffBackupSummary]:
    sec = _normalize_backup_section(section)
    rows = (
        db.query(StaffBackup)
        .filter(StaffBackup.section == sec)
        .order_by(StaffBackup.backup_key.asc())
        .all()
    )
    out: List[staff_schema.StaffBackupSummary] = []
    for row in rows:
        saved_at = row.updated_at.isoformat() if row.updated_at else None
        out.append(
            staff_schema.StaffBackupSummary(
                section=row.section,
                backup_key=row.backup_key,
                saved_at=saved_at,
            )
        )
    return out


def get_backup(db: Session, section: str, backup_key: str) -> Optional[staff_schema.StaffBackupRead]:
    sec, key = _backup_key(section, backup_key)
    row = (
        db.query(StaffBackup)
        .filter(StaffBackup.section == sec, StaffBackup.backup_key == key)
        .first()
    )
    if not row:
        return None
    return backup_to_read(row)


def upsert_backup(db: Session, payload: staff_schema.StaffBackupUpsert) -> staff_schema.StaffBackupRead:
    sec, key = _backup_key(payload.section, payload.backup_key)
    body = payload.payload if isinstance(payload.payload, dict) else {}
    row = (
        db.query(StaffBackup)
        .filter(StaffBackup.section == sec, StaffBackup.backup_key == key)
        .first()
    )
    payload_json = json.dumps(body, ensure_ascii=False)
    if row:
        row.payload_json = payload_json
    else:
        row = StaffBackup(section=sec, backup_key=key, payload_json=payload_json)
        db.add(row)
    db.commit()
    db.refresh(row)
    return backup_to_read(row)
