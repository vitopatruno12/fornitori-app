import re
import uuid
from datetime import date
from pathlib import Path
from typing import List, Optional

from fastapi import UploadFile
from sqlalchemy.orm import Session

from ..models.support_technician import SupportTechnician, TechnicianActivity, TechnicianInvoiceFile
from ..schemas import support_technicians as sch


def _digits_phone(raw: str) -> str:
    return re.sub(r"\D", "", (raw or "").strip())


def _normalize_time(raw: Optional[str]) -> Optional[str]:
    t = (raw or "").strip()
    if not t:
        return None
    if not re.match(r"^\d{2}:\d{2}$", t):
        raise ValueError("Orario non valido, usa formato HH:MM")
    hh, mm = t.split(":")
    h = int(hh)
    m = int(mm)
    if h < 0 or h > 23 or m < 0 or m > 59:
        raise ValueError("Orario non valido, usa formato HH:MM")
    return f"{h:02d}:{m:02d}"


DEFAULT_TECHNICIANS: List[tuple[str, str, str]] = [
    ("Maurizio", "3463088943", "Falegname"),
    ("Alessandro Conte", "3475245418", "Fabbro"),
    ("Giuseppe Orlando", "3290698212", ""),
    ("Sergio Serafino", "3285491230", "Elettricista"),
    ("Marco Novaleas", "3351358643", ""),
    ("Marcello", "3287346490", "Idraulico"),
    ("Pariti", "335216863", "Frigoriferi"),
    ("Maurizio Grassi", "3403978354", "frigorista"),
    ("Frigorista Migliaccio", "3476434046", ""),
]


def list_technicians(db: Session) -> List[SupportTechnician]:
    return (
        db.query(SupportTechnician)
        .order_by(SupportTechnician.sort_order.asc(), SupportTechnician.id.asc())
        .all()
    )


def get_technician(db: Session, tid: int) -> Optional[SupportTechnician]:
    return db.query(SupportTechnician).filter(SupportTechnician.id == tid).first()


def create_technician(db: Session, payload: sch.SupportTechnicianCreate) -> SupportTechnician:
    phone = _digits_phone(payload.phone)
    row = SupportTechnician(
        full_name=payload.full_name.strip(),
        phone=phone,
        specialty=(payload.specialty or "").strip() or None,
        sort_order=payload.sort_order,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_technician(db: Session, tid: int, payload: sch.SupportTechnicianUpdate) -> Optional[SupportTechnician]:
    row = get_technician(db, tid)
    if not row:
        return None
    if payload.full_name is not None:
        row.full_name = payload.full_name.strip()
    if payload.phone is not None:
        row.phone = _digits_phone(payload.phone)
    if payload.specialty is not None:
        row.specialty = payload.specialty.strip() or None
    if payload.sort_order is not None:
        row.sort_order = payload.sort_order
    db.commit()
    db.refresh(row)
    return row


def delete_technician(db: Session, tid: int) -> bool:
    row = get_technician(db, tid)
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def delete_all_technicians(db: Session) -> int:
    """Elimina tutti i tecnici (CASCADE sulle attività collegate)."""
    n = db.query(SupportTechnician).delete(synchronize_session=False)
    db.commit()
    return int(n or 0)


def seed_defaults(db: Session) -> int:
    n_existing = db.query(SupportTechnician).count()
    if n_existing > 0:
        return 0
    inserted = 0
    for i, (name, phone, spec) in enumerate(DEFAULT_TECHNICIANS):
        db.add(
            SupportTechnician(
                full_name=name,
                phone=_digits_phone(phone),
                specialty=spec or None,
                sort_order=i,
            )
        )
        inserted += 1
    db.commit()
    return inserted


def list_activities(
    db: Session,
    date_from: date,
    date_to: date,
    technician_id: Optional[int] = None,
) -> List[sch.TechnicianActivityRead]:
    if date_to < date_from:
        return []
    q = (
        db.query(TechnicianActivity, SupportTechnician.full_name)
        .join(SupportTechnician, SupportTechnician.id == TechnicianActivity.technician_id)
        .filter(TechnicianActivity.activity_date >= date_from)
        .filter(TechnicianActivity.activity_date <= date_to)
    )
    if technician_id is not None:
        q = q.filter(TechnicianActivity.technician_id == technician_id)
    rows = q.order_by(TechnicianActivity.activity_date.desc(), TechnicianActivity.id.desc()).all()
    out: List[sch.TechnicianActivityRead] = []
    for act, tech_name in rows:
        out.append(
            sch.TechnicianActivityRead(
                id=act.id,
                technician_id=act.technician_id,
                technician_name=tech_name,
                activity_date=act.activity_date,
                time_start=act.time_start,
                time_end=act.time_end,
                location=act.location,
                notes=act.notes,
                kind=act.kind,
            )
        )
    return out


def create_activity(db: Session, payload: sch.TechnicianActivityCreate) -> TechnicianActivity:
    if not get_technician(db, payload.technician_id):
        raise ValueError("Tecnico non trovato")
    row = TechnicianActivity(
        technician_id=payload.technician_id,
        activity_date=payload.activity_date,
        time_start=_normalize_time(payload.time_start),
        time_end=_normalize_time(payload.time_end),
        location=(payload.location or "").strip() or None,
        notes=(payload.notes or "").strip() or None,
        kind=payload.kind,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_activity(db: Session, aid: int, payload: sch.TechnicianActivityUpdate) -> Optional[TechnicianActivity]:
    row = db.query(TechnicianActivity).filter(TechnicianActivity.id == aid).first()
    if not row:
        return None
    if payload.technician_id is not None:
        if not get_technician(db, payload.technician_id):
            raise ValueError("Tecnico non trovato")
        row.technician_id = payload.technician_id
    if payload.activity_date is not None:
        row.activity_date = payload.activity_date
    if payload.time_start is not None:
        row.time_start = _normalize_time(payload.time_start)
    if payload.time_end is not None:
        row.time_end = _normalize_time(payload.time_end)
    if payload.location is not None:
        row.location = payload.location.strip() or None
    if payload.notes is not None:
        row.notes = payload.notes.strip() or None
    if payload.kind is not None:
        row.kind = payload.kind
    db.commit()
    db.refresh(row)
    return row


def delete_activity(db: Session, aid: int) -> bool:
    row = db.query(TechnicianActivity).filter(TechnicianActivity.id == aid).first()
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


MAX_INVOICE_UPLOAD_BYTES = 15 * 1024 * 1024
INVOICE_UPLOAD_SUBDIR = "support_tech_invoices"


def save_technician_invoice_file(
    db: Session,
    upload_root: Path,
    file: UploadFile,
    period_from: date,
    period_to: date,
    technician_id: Optional[int],
    invoice_number: Optional[str],
    raw_bytes: bytes,
) -> TechnicianInvoiceFile:
    if period_to < period_from:
        raise ValueError("Intervallo date non valido")
    if technician_id is not None and not get_technician(db, technician_id):
        raise ValueError("Tecnico non trovato")
    if len(raw_bytes) > MAX_INVOICE_UPLOAD_BYTES:
        raise ValueError("File troppo grande (massimo 15 MB)")
    mime = (file.content_type or "").lower()
    fname_lower = (file.filename or "").lower()
    if mime != "application/pdf" and not fname_lower.endswith(".pdf"):
        raise ValueError("Formato non supportato: carica un file PDF")
    dest_dir = upload_root / INVOICE_UPLOAD_SUBDIR
    dest_dir.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}.pdf"
    dest_path = dest_dir / stored
    dest_path.write_bytes(raw_bytes)
    rel_path = f"{INVOICE_UPLOAD_SUBDIR}/{stored}"
    inv_num = (invoice_number or "").strip() or None
    row = TechnicianInvoiceFile(
        technician_id=technician_id,
        period_from=period_from,
        period_to=period_to,
        invoice_number=inv_num,
        storage_path=rel_path,
        original_name=(file.filename or None)[:255] if file.filename else None,
        mime_type=mime or "application/pdf",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
