"""CRUD documenti PDF personale (contratti, buste, documenti anagrafici)."""
from __future__ import annotations

import uuid
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import UploadFile
from sqlalchemy.orm import Session

from ..models.staff_document import StaffDocument
from ..models.staff_member import StaffMember

MAX_DOC_UPLOAD_BYTES = 15 * 1024 * 1024
DOC_UPLOAD_SUBDIR = "staff_documents"

VALID_CATEGORIES = frozenset({"contratto", "busta_paga", "documento_personale"})
VALID_DOC_TYPES = frozenset(
  {
    "carta_identita",
    "codice_fiscale",
    "patente",
    "permesso_soggiorno",
    "contratto",
    "busta_paga",
    "altro",
  }
)


def _doc_out(row: StaffDocument) -> Dict[str, Any]:
  rel = (row.storage_path or "").lstrip("/")
  return {
    "id": row.id,
    "category": row.category,
    "doc_type": row.doc_type,
    "locale_name": row.locale_name,
    "year_month": row.year_month,
    "staff_member_id": row.staff_member_id,
    "first_name": row.first_name,
    "last_name": row.last_name,
    "birth_date": row.birth_date.isoformat() if row.birth_date else None,
    "email": row.email,
    "phone": row.phone,
    "ruolo": row.ruolo,
    "document_number": row.document_number,
    "storage_path": row.storage_path,
    "original_name": row.original_name,
    "mime_type": row.mime_type,
    "notes": row.notes,
    "file_url": f"/uploads/{rel}" if rel else None,
  }


def list_documents(
  db: Session,
  *,
  category: Optional[str] = None,
  locale_name: Optional[str] = None,
  year_month: Optional[str] = None,
) -> List[Dict[str, Any]]:
  q = db.query(StaffDocument)
  if category:
    q = q.filter(StaffDocument.category == category.strip().lower())
  if locale_name:
    q = q.filter(StaffDocument.locale_name == locale_name.strip())
  if year_month:
    q = q.filter(StaffDocument.year_month == year_month.strip())
  rows = q.order_by(StaffDocument.id.desc()).all()
  return [_doc_out(r) for r in rows]


def get_document(db: Session, doc_id: int) -> Optional[StaffDocument]:
  return db.query(StaffDocument).filter(StaffDocument.id == doc_id).first()


def save_document(
  db: Session,
  upload_root: Path,
  file: UploadFile,
  raw_bytes: bytes,
  *,
  category: str,
  doc_type: str = "altro",
  locale_name: Optional[str] = None,
  year_month: Optional[str] = None,
  staff_member_id: Optional[int] = None,
  first_name: Optional[str] = None,
  last_name: Optional[str] = None,
  birth_date: Optional[date] = None,
  email: Optional[str] = None,
  phone: Optional[str] = None,
  ruolo: Optional[str] = None,
  document_number: Optional[str] = None,
  notes: Optional[str] = None,
) -> Dict[str, Any]:
  cat = (category or "").strip().lower()
  if cat not in VALID_CATEGORIES:
    raise ValueError("Categoria non valida")
  dtype = (doc_type or "altro").strip().lower() or "altro"
  if dtype not in VALID_DOC_TYPES:
    dtype = "altro"
  if len(raw_bytes) > MAX_DOC_UPLOAD_BYTES:
    raise ValueError("File troppo grande (massimo 15 MB)")
  mime = (file.content_type or "").lower()
  fname_lower = (file.filename or "").lower()
  if mime != "application/pdf" and not fname_lower.endswith(".pdf"):
    raise ValueError("Formato non supportato: carica un file PDF")

  if staff_member_id is not None:
    member = db.query(StaffMember).filter(StaffMember.id == staff_member_id).first()
    if not member:
      raise ValueError("Dipendente non trovato")
    if not first_name and member.first_name:
      first_name = member.first_name
    if not last_name and member.last_name:
      last_name = member.last_name
    if not first_name and not last_name and member.name:
      parts = str(member.name).strip().split(None, 1)
      first_name = parts[0] if parts else None
      last_name = parts[1] if len(parts) > 1 else None
    if not email and member.email:
      email = member.email
    if not phone and member.phone:
      phone = member.phone
    if not birth_date and member.birth_date:
      birth_date = member.birth_date

  dest_dir = upload_root / DOC_UPLOAD_SUBDIR
  dest_dir.mkdir(parents=True, exist_ok=True)
  stored = f"{uuid.uuid4().hex}.pdf"
  (dest_dir / stored).write_bytes(raw_bytes)
  rel_path = f"{DOC_UPLOAD_SUBDIR}/{stored}"

  ym = (year_month or "").strip() or None
  if ym and len(ym) != 7:
    raise ValueError("Mese non valido (usa YYYY-MM)")

  row = StaffDocument(
    category=cat,
    doc_type=dtype if cat != "contratto" else "contratto",
    locale_name=(locale_name or "").strip() or None,
    year_month=ym if cat == "busta_paga" else (ym if ym else None),
    staff_member_id=staff_member_id,
    first_name=(first_name or "").strip() or None,
    last_name=(last_name or "").strip() or None,
    birth_date=birth_date,
    email=(email or "").strip() or None,
    phone=(phone or "").strip() or None,
    ruolo=(ruolo or "").strip() or None,
    document_number=(document_number or "").strip() or None,
    storage_path=rel_path,
    original_name=(file.filename or None)[:255] if file.filename else None,
    mime_type=mime or "application/pdf",
    notes=(notes or "").strip() or None,
  )
  if cat == "busta_paga":
    row.doc_type = "busta_paga"
  db.add(row)
  db.commit()
  db.refresh(row)
  return _doc_out(row)


def update_document(db: Session, doc_id: int, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
  row = get_document(db, doc_id)
  if not row:
    return None
  for key in (
    "first_name",
    "last_name",
    "email",
    "phone",
    "ruolo",
    "document_number",
    "locale_name",
    "year_month",
    "doc_type",
    "notes",
  ):
    if key in payload and payload[key] is not None:
      val = payload[key]
      if isinstance(val, str):
        val = val.strip() or None
      setattr(row, key, val)
  if "birth_date" in payload:
    row.birth_date = payload.get("birth_date")
  if "staff_member_id" in payload:
    row.staff_member_id = payload.get("staff_member_id")
  db.commit()
  db.refresh(row)
  return _doc_out(row)


def delete_document(db: Session, upload_root: Path, doc_id: int) -> bool:
  row = get_document(db, doc_id)
  if not row:
    return False
  rel = (row.storage_path or "").lstrip("/").replace("\\", "/")
  if rel and ".." not in rel:
    path = upload_root / rel
    if path.is_file():
      try:
        path.unlink()
      except OSError:
        pass
  db.delete(row)
  db.commit()
  return True
