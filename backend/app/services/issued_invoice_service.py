"""Upload e elenco fatture emesse (XML / PDF / immagine)."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..constants.sdi_companies import normalize_company_section
from ..models.issued_invoice import IssuedInvoice

UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "uploads" / "fatture_emesse"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_KINDS = {
  "xml": {".xml", ".p7m"},
  "pdf": {".pdf"},
  "image": {".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".bmp"},
}

KIND_MIME_HINTS = {
  "xml": ("xml", "pkcs7"),
  "pdf": ("pdf",),
  "image": ("image/",),
}


def _safe_name(name: str) -> str:
  base = Path(name or "documento").name
  cleaned = re.sub(r"[^\w.\-]+", "_", base, flags=re.UNICODE).strip("._")
  return cleaned[:180] or "documento"


def _detect_kind(filename: str, content_type: Optional[str], forced: Optional[str]) -> str:
  kind = (forced or "").strip().lower()
  if kind in ALLOWED_KINDS:
    return kind
  suffix = Path(filename or "").suffix.lower()
  for k, exts in ALLOWED_KINDS.items():
    if suffix in exts:
      return k
  ct = (content_type or "").lower()
  for k, hints in KIND_MIME_HINTS.items():
    if any(h in ct for h in hints):
      return k
  raise HTTPException(status_code=400, detail="Tipo file non supportato: usa XML, PDF o immagine")


def _parse_optional_date(raw: Optional[str]) -> Optional[datetime]:
  if not raw or not str(raw).strip():
    return None
  s = str(raw).strip()
  try:
    if len(s) == 10:
      return datetime.fromisoformat(f"{s}T00:00:00").replace(tzinfo=timezone.utc)
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
      dt = dt.replace(tzinfo=timezone.utc)
    return dt
  except ValueError as exc:
    raise HTTPException(status_code=400, detail="Data documento non valida") from exc


def _parse_optional_amount(raw: Optional[str]) -> Optional[Decimal]:
  if raw is None or str(raw).strip() == "":
    return None
  try:
    return Decimal(str(raw).replace(",", ".").strip())
  except (InvalidOperation, ValueError) as exc:
    raise HTTPException(status_code=400, detail="Importo non valido") from exc


def _row_out(row: IssuedInvoice) -> Dict[str, Any]:
  return {
    "id": row.id,
    "company": row.company,
    "activity": row.activity,
    "file_kind": row.file_kind,
    "original_filename": row.original_filename,
    "invoice_number": row.invoice_number,
    "invoice_date": row.invoice_date.isoformat() if row.invoice_date else None,
    "total_amount": float(row.total_amount) if row.total_amount is not None else None,
    "status": row.status or "caricata",
    "note": row.note,
    "created_at": row.created_at.isoformat() if row.created_at else None,
    "download_url": f"/invoices/emesse/{row.id}/file",
  }


async def upload_issued_invoice(
  db: Session,
  *,
  file: UploadFile,
  company: str,
  file_kind: Optional[str] = None,
  activity: Optional[str] = None,
  invoice_number: Optional[str] = None,
  invoice_date: Optional[str] = None,
  total_amount: Optional[str] = None,
  note: Optional[str] = None,
) -> Dict[str, Any]:
  company_id = normalize_company_section(company)
  if company_id == "non_classificata":
    raise HTTPException(status_code=400, detail="Seleziona una società valida (es. Mediazione A)")

  raw = await file.read()
  if not raw:
    raise HTTPException(status_code=400, detail="File vuoto")

  kind = _detect_kind(file.filename or "", file.content_type, file_kind)
  suffix = Path(file.filename or "").suffix.lower()
  if suffix and suffix not in ALLOWED_KINDS[kind]:
    # allow missing suffix if mime matched; otherwise enforce
    if Path(file.filename or "").suffix:
      raise HTTPException(
        status_code=400,
        detail=f"Estensione non valida per {kind}: consentite {', '.join(sorted(ALLOWED_KINDS[kind]))}",
      )
    suffix = { "xml": ".xml", "pdf": ".pdf", "image": ".jpg" }[kind]

  company_dir = UPLOAD_ROOT / company_id
  company_dir.mkdir(parents=True, exist_ok=True)
  stored_name = f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}_{_safe_name(file.filename or f'doc{suffix}')}"
  if not Path(stored_name).suffix and suffix:
    stored_name = f"{stored_name}{suffix}"
  dest = company_dir / stored_name
  dest.write_bytes(raw)

  rel = str(dest.relative_to(UPLOAD_ROOT.parent.parent)).replace("\\", "/")
  row = IssuedInvoice(
    company=company_id,
    activity=(activity or "").strip().lower() or None,
    file_kind=kind,
    file_path=rel,
    original_filename=file.filename or stored_name,
    invoice_number=(invoice_number or "").strip() or None,
    invoice_date=_parse_optional_date(invoice_date),
    total_amount=_parse_optional_amount(total_amount),
    status="caricata",
    note=(note or "").strip() or None,
  )
  db.add(row)
  db.commit()
  db.refresh(row)
  return _row_out(row)


def list_issued_invoices(
  db: Session,
  *,
  company: Optional[str] = None,
  limit: int = 200,
) -> List[Dict[str, Any]]:
  q = db.query(IssuedInvoice)
  if company:
    cid = normalize_company_section(company)
    if cid != "non_classificata":
      q = q.filter(IssuedInvoice.company == cid)
  rows = q.order_by(IssuedInvoice.created_at.desc(), IssuedInvoice.id.desc()).limit(max(1, min(limit, 500))).all()
  return [_row_out(r) for r in rows]


def get_issued_invoice(db: Session, invoice_id: int) -> Optional[IssuedInvoice]:
  return db.query(IssuedInvoice).filter(IssuedInvoice.id == invoice_id).first()


def resolve_issued_file(db: Session, invoice_id: int) -> tuple[Path, IssuedInvoice]:
  row = get_issued_invoice(db, invoice_id)
  if not row:
    raise HTTPException(status_code=404, detail="Fattura emessa non trovata")
  path = (UPLOAD_ROOT.parent.parent / str(row.file_path or "").replace("\\", "/")).resolve()
  root = UPLOAD_ROOT.resolve()
  if root not in path.parents and path != root:
    # also accept relative under uploads/
    uploads = UPLOAD_ROOT.parent.resolve()
    if uploads not in path.parents and path != uploads:
      raise HTTPException(status_code=400, detail="Percorso file non valido")
  if not path.is_file():
    raise HTTPException(status_code=404, detail="File non trovato su disco")
  return path, row


def delete_issued_invoice(db: Session, invoice_id: int) -> bool:
  row = get_issued_invoice(db, invoice_id)
  if not row:
    return False
  try:
    path, _ = resolve_issued_file(db, invoice_id)
    path.unlink(missing_ok=True)
  except HTTPException:
    pass
  db.delete(row)
  db.commit()
  return True
