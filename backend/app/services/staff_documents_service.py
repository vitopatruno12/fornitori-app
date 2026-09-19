"""CRUD documenti PDF personale (contratti, buste, documenti anagrafici)."""
from __future__ import annotations

import logging
import uuid
from datetime import date
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar

from fastapi import HTTPException, UploadFile
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError, SQLAlchemyError
from sqlalchemy.orm import Session

from ..database import engine
from ..models.staff_document import StaffDocument
from ..models.staff_member import StaffMember

logger = logging.getLogger(__name__)

MAX_DOC_UPLOAD_BYTES = 15 * 1024 * 1024
DOC_UPLOAD_SUBDIR = "staff_documents"
_T = TypeVar("_T")
_table_ready = False

STAFF_DOCUMENTS_ENSURE_HINT = (
  "Tabella staff_documents assente. Sul server esegui: "
  "sudo APP_DIR=/var/www/app-fornitori/fornitori-app bash deploy/ensure-staff-documents-table.sh "
  "poi sudo APP_DIR=/var/www/app-fornitori/fornitori-app RESTART_API=1 bash deploy/aggiorna-tutto.sh"
)

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


def _verify_staff_documents_table() -> bool:
  try:
    with engine.connect() as conn:
      conn.execute(text("SELECT 1 FROM staff_documents LIMIT 1"))
    return True
  except SQLAlchemyError as exc:
    logger.warning("staff_documents non accessibile: %s", exc)
    return False


def ensure_staff_documents_schema(*, force: bool = False) -> bool:
  """Crea staff_documents se manca (DDL idempotente)."""
  global _table_ready
  if _table_ready and not force and _verify_staff_documents_table():
    return True
  if not force and _verify_staff_documents_table():
    _table_ready = True
    return True
  try:
    with engine.begin() as conn:
      conn.execute(
        text(
          """
          CREATE TABLE IF NOT EXISTS staff_documents (
            id SERIAL PRIMARY KEY,
            category VARCHAR(40) NOT NULL,
            doc_type VARCHAR(40) NOT NULL DEFAULT 'altro',
            locale_name VARCHAR(120) NULL,
            year_month VARCHAR(7) NULL,
            staff_member_id INTEGER NULL,
            first_name VARCHAR(120) NULL,
            last_name VARCHAR(120) NULL,
            birth_date DATE NULL,
            email VARCHAR(255) NULL,
            phone VARCHAR(64) NULL,
            ruolo VARCHAR(120) NULL,
            document_number VARCHAR(80) NULL,
            storage_path VARCHAR(512) NOT NULL,
            original_name VARCHAR(255) NULL,
            mime_type VARCHAR(120) NULL,
            notes TEXT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
          """
        )
      )
      conn.execute(text("CREATE INDEX IF NOT EXISTS ix_staff_documents_category ON staff_documents (category)"))
      conn.execute(text("CREATE INDEX IF NOT EXISTS ix_staff_documents_locale ON staff_documents (locale_name)"))
      conn.execute(text("CREATE INDEX IF NOT EXISTS ix_staff_documents_year_month ON staff_documents (year_month)"))
      conn.execute(text("CREATE INDEX IF NOT EXISTS ix_staff_documents_member ON staff_documents (staff_member_id)"))
    _table_ready = _verify_staff_documents_table()
    return _table_ready
  except Exception as exc:
    logger.warning("Creazione staff_documents fallita: %s", exc)
    _table_ready = False
    return False


def _rollback_db(db: Session) -> None:
  try:
    db.rollback()
  except Exception:
    pass


def _with_staff_documents_table(db: Session, fn: Callable[[], _T]) -> _T:
  try:
    return fn()
  except ProgrammingError as exc:
    err = str(exc).lower()
    if "staff_documents" not in err:
      raise
    _rollback_db(db)
    global _table_ready
    _table_ready = False
    if not ensure_staff_documents_schema(force=True):
      raise HTTPException(status_code=503, detail=STAFF_DOCUMENTS_ENSURE_HINT) from exc
    try:
      return fn()
    except ProgrammingError as retry_exc:
      _rollback_db(db)
      raise HTTPException(status_code=503, detail=STAFF_DOCUMENTS_ENSURE_HINT) from retry_exc


def list_documents(
  db: Session,
  *,
  category: Optional[str] = None,
  locale_name: Optional[str] = None,
  year_month: Optional[str] = None,
) -> List[Dict[str, Any]]:
  def _run() -> List[Dict[str, Any]]:
    from .tigito_buste_service import locale_name_key, shop_token_from_locale

    q = db.query(StaffDocument)
    cat = (category or "").strip().lower() or None
    if cat:
      q = q.filter(StaffDocument.category == cat)
    if year_month:
      q = q.filter(StaffDocument.year_month == year_month.strip())
    loc = (locale_name or "").strip() or None
    if loc:
      if cat == "busta_paga":
        # Match esatto o stessa sede (abba/zanardelli) — i pack usano grafie diverse
        target_key = locale_name_key(loc)
        shop = shop_token_from_locale(loc)
        rows = q.order_by(StaffDocument.id.desc()).all()
        out = []
        for r in rows:
          rk = locale_name_key(r.locale_name)
          if rk == target_key:
            out.append(_doc_out(r))
            continue
          if shop and shop_token_from_locale(r.locale_name) == shop:
            out.append(_doc_out(r))
        return out
      q = q.filter(StaffDocument.locale_name == loc)
    rows = q.order_by(StaffDocument.id.desc()).all()
    return [_doc_out(r) for r in rows]

  return _with_staff_documents_table(db, _run)


def get_document(db: Session, doc_id: int) -> Optional[StaffDocument]:
  return _with_staff_documents_table(
    db,
    lambda: db.query(StaffDocument).filter(StaffDocument.id == doc_id).first(),
  )


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

  def _persist() -> Dict[str, Any]:
    nonlocal first_name, last_name, email, phone, birth_date, locale_name
    if cat == "busta_paga":
      from .tigito_buste_service import resolve_company_from_filename

      company = resolve_company_from_filename(file.filename if file else None)
      if company and company.get("short_label"):
        locale_name = company["short_label"]
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

  return _with_staff_documents_table(db, _persist)


def update_document(db: Session, doc_id: int, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
  def _run() -> Optional[Dict[str, Any]]:
    row = db.query(StaffDocument).filter(StaffDocument.id == doc_id).first()
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

  return _with_staff_documents_table(db, _run)


def delete_document(db: Session, upload_root: Path, doc_id: int) -> bool:
  def _run() -> bool:
    row = db.query(StaffDocument).filter(StaffDocument.id == doc_id).first()
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

  return _with_staff_documents_table(db, _run)


MAX_BUSTE_IMPORT_BYTES = 40 * 1024 * 1024


def _pack_member_keys(db: Session, locale_name: str) -> Tuple[str, set]:
  from . import staff_service
  from .tigito_buste_service import person_name_keys

  pack = staff_service._find_locale_pack_by_key(db, locale_name)
  canonical = (pack.locale_name if pack else None) or locale_name
  keys: set = set()
  if pack:
    for m in staff_service._locale_members_from_json(pack.members_json):
      keys |= person_name_keys(m.name, m.first_name, m.last_name)
      keys |= person_name_keys(m.last_name, m.first_name)
  return canonical, keys


def _employee_in_locale(emp: Dict[str, Any], *, shop: Optional[str], pack_keys: set) -> bool:
  from .tigito_buste_service import enrich_shop_token, person_name_keys, shop_token_from_locale

  enrich_shop_token(emp)
  emp_shop = emp.get("shop_token") or shop_token_from_locale(emp.get("suggested_locale"))
  if shop and emp_shop and emp_shop == shop:
    return True
  if pack_keys:
    keys = person_name_keys(emp.get("full_name"), emp.get("first_name"), emp.get("last_name"))
    keys |= person_name_keys(emp.get("last_name"), emp.get("first_name"))
    if keys & pack_keys:
      return True
  if not shop:
    return True
  return False


def _group_employees_by_shop(employees: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
  from .tigito_buste_service import enrich_shop_token, shop_label

  groups: Dict[str, List[Dict[str, Any]]] = {
    "zanardelli": [],
    "abba": [],
    "altro": [],
  }
  for emp in employees:
    enrich_shop_token(emp)
    emp["shop_label"] = shop_label(emp.get("shop_token"))
    token = emp.get("shop_token") or "altro"
    if token not in groups:
      token = "altro"
    groups[token].append(emp)
  return groups


def preview_tigito_buste(
  raw: bytes,
  *,
  password: Optional[str] = None,
  locale_name: Optional[str] = None,
  db: Optional[Session] = None,
) -> Dict[str, Any]:
  """Anteprima: estrae cedolini e li divide per sede (Abba / Zanardelli)."""
  from .tigito_buste_service import (
    extract_employees_from_tigito_pdf,
    shop_label,
    shop_token_from_locale,
  )

  if len(raw) > MAX_BUSTE_IMPORT_BYTES:
    raise ValueError("File troppo grande (massimo 40 MB)")
  employees = extract_employees_from_tigito_pdf(raw, password=password)
  groups = _group_employees_by_shop(employees)

  accedi = (locale_name or "").strip() or None
  pack_canonical = accedi
  filtered = employees
  shop = None
  if accedi and db is not None:
    pack_canonical, pack_keys = _pack_member_keys(db, accedi)
    shop = shop_token_from_locale(pack_canonical)
    filtered = [e for e in employees if _employee_in_locale(e, shop=shop, pack_keys=pack_keys)]

  return {
    "count": len(filtered),
    "total_pages": len(employees),
    "locale_name": pack_canonical,
    "shop_token": shop,
    "shop_label": shop_label(shop) if shop else None,
    "employees": filtered,
    "by_locale": {
      "zanardelli": {
        "label": "Via Zanardelli",
        "count": len(groups["zanardelli"]),
        "employees": groups["zanardelli"],
      },
      "abba": {
        "label": "Via Abba",
        "count": len(groups["abba"]),
        "employees": groups["abba"],
      },
      "altro": {
        "label": "Altra sede",
        "count": len(groups["altro"]),
        "employees": groups["altro"],
      },
    },
  }


def import_tigito_buste(
  db: Session,
  upload_root: Path,
  raw: bytes,
  *,
  password: Optional[str] = None,
  locale_name: Optional[str] = None,
  year_month: Optional[str] = None,
  source_filename: Optional[str] = None,
) -> Dict[str, Any]:
  """
  Estrae cedolini e salva solo quelli del locale Accedi (es. Abba vs Zanardelli).
  Match: indirizzo sul PDF e/o dipendenti del pack locale (stazioni operative).
  """
  from .tigito_buste_service import (
    export_single_page_pdf,
    extract_employees_from_tigito_pdf,
    parse_birth_it,
    resolve_company_from_filename,
    resolve_company_from_vat,
    shop_token_from_locale,
  )

  if len(raw) > MAX_BUSTE_IMPORT_BYTES:
    raise ValueError("File troppo grande (massimo 40 MB)")

  accedi = (locale_name or "").strip() or None
  if not accedi:
    raise ValueError(
      "Apri Accedi sul locale (es. Mediazione via abba o La mediazione via zanardelli) "
      "prima di importare: il PDF Mediazione contiene entrambe le sedi."
    )

  company = resolve_company_from_filename(source_filename)
  if not company and password:
    company = resolve_company_from_vat(password)
  societa = (company or {}).get("short_label") or "Mediazione"

  pwd = (password or "").strip() or (company or {}).get("vat")
  employees = extract_employees_from_tigito_pdf(raw, password=pwd)
  if not employees:
    raise ValueError(
      "Nessun cedolino riconosciuto nel PDF. Verifica password (P.IVA) e formato TeamSystem/Tigito."
    )

  pack_canonical, pack_keys = _pack_member_keys(db, accedi)
  shop = shop_token_from_locale(pack_canonical)
  total_pages = len(employees)
  filtered = [e for e in employees if _employee_in_locale(e, shop=shop, pack_keys=pack_keys)]
  if not filtered:
    raise ValueError(
      f"Nessun cedolino per «{pack_canonical}» tra le {total_pages} pagine del PDF. "
      "Controlla che i dipendenti siano nel pack del locale (Personale / stazione operativa) "
      "oppure che l’indirizzo sul cedolino sia Via Abba / Via Zanardelli."
    )

  ym_fallback = (year_month or "").strip() or None
  if ym_fallback and len(ym_fallback) != 7:
    raise ValueError("Mese non valido (usa YYYY-MM)")

  dest_dir = upload_root / DOC_UPLOAD_SUBDIR
  dest_dir.mkdir(parents=True, exist_ok=True)
  base_name = (source_filename or "buste.pdf").rsplit("/", 1)[-1]
  created: List[Dict[str, Any]] = []

  def _persist() -> Dict[str, Any]:
    for emp in filtered:
      page_idx = int(emp["page_index"])
      page_bytes = export_single_page_pdf(raw, page_idx, password=pwd)
      stored = f"{uuid.uuid4().hex}.pdf"
      (dest_dir / stored).write_bytes(page_bytes)
      rel_path = f"{DOC_UPLOAD_SUBDIR}/{stored}"
      ym = (ym_fallback or emp.get("year_month") or "").strip() or None
      note_parts = [f"Società {societa}", f"Locale {pack_canonical}"]
      if emp.get("address"):
        note_parts.append(emp["address"])
      if (company or {}).get("vat"):
        note_parts.append(f"P.IVA {company['vat']}")
      if emp.get("codice_fiscale"):
        note_parts.append(f"CF {emp['codice_fiscale']}")
      if emp.get("netto") is not None:
        note_parts.append(f"Netto {emp['netto']:.2f}")
      pdf_ym = (emp.get("year_month") or "").strip() or None
      if emp.get("month_label"):
        note_parts.append(f"Cedolino {emp['month_label']}")
      elif pdf_ym:
        note_parts.append(f"Cedolino {pdf_ym}")
      if ym_fallback and pdf_ym and pdf_ym != ym_fallback:
        note_parts.append(f"archiviato come {ym_fallback}")
      if emp.get("employee_code"):
        note_parts.append(f"Matr. {emp['employee_code']}")
      orig = f"{base_name} · p.{emp.get('page')}"
      if emp.get("full_name"):
        orig = f"{emp['full_name']} · {ym or pdf_ym or ''}".strip(" ·")
      row = StaffDocument(
        category="busta_paga",
        doc_type="busta_paga",
        locale_name=pack_canonical,
        year_month=ym,
        first_name=(emp.get("first_name") or "").strip() or None,
        last_name=(emp.get("last_name") or "").strip() or None,
        birth_date=parse_birth_it(emp.get("birth_date")),
        ruolo=(emp.get("qualifica") or "").strip()[:120] or None,
        document_number=(str(emp.get("employee_code") or "").strip() or None),
        storage_path=rel_path,
        original_name=orig[:255],
        mime_type="application/pdf",
        notes="; ".join(note_parts) if note_parts else None,
      )
      db.add(row)
      db.flush()
      created.append(_doc_out(row))
    db.commit()
    return {
      "imported": len(created),
      "skipped": total_pages - len(created),
      "total_pages": total_pages,
      "items": created,
      "locale_name": pack_canonical,
      "societa": societa,
      "company_vat": (company or {}).get("vat"),
      "year_month": ym_fallback or (created[0].get("year_month") if created else None),
    }

  return _with_staff_documents_table(db, _persist)
