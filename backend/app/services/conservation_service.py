"""Flusso conservazione sostitutiva: selezione documenti, hash, indice, pacchetto ZIP."""
from __future__ import annotations

import hashlib
import json
import logging
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError, SQLAlchemyError
from sqlalchemy.orm import Session

from ..constants.sdi_companies import normalize_company_section
from ..database import engine
from ..models.conservation import ConservationPackage, ConservationPackageItem
from ..models.issued_invoice import IssuedInvoice
from . import invoice_pdf_service, invoice_service, issued_invoice_service

logger = logging.getLogger(__name__)

APP_ROOT = Path(__file__).resolve().parent.parent
CONSERVATION_ROOT = APP_ROOT / "uploads" / "conservazione"
try:
  CONSERVATION_ROOT.mkdir(parents=True, exist_ok=True)
except OSError as exc:
  logger.warning("uploads/conservazione non creabile all'import: %s", exc)

_T = TypeVar("_T")
_table_ready = False

CONSERVATION_ENSURE_HINT = (
  "Tabelle conservazione assenti. Sul server (API in /opt/fornitori-app): "
  "sudo -u postgres psql -d fornitori_db -f /opt/fornitori-app/backend/migrations/20260915_conservation_packages.sql "
  "&& sudo APP_DIR=/opt/fornitori-app bash /opt/fornitori-app/deploy/ensure-conservation-tables.sh "
  "&& sudo systemctl restart fornitori-api"
)

STATUSES = (
  "bozza",
  "pronto",
  "esportato",
  "inviato_conservatore",
  "conservato",
  "errore",
)

STATUS_TRANSITIONS = {
  "bozza": {"pronto", "errore"},
  "pronto": {"esportato", "bozza", "errore"},
  "esportato": {"inviato_conservatore", "pronto", "errore"},
  "inviato_conservatore": {"conservato", "esportato", "errore"},
  "conservato": set(),
  "errore": {"bozza", "pronto"},
}


def _verify_conservation_tables() -> bool:
  try:
    with engine.connect() as conn:
      conn.execute(text("SELECT 1 FROM conservation_packages LIMIT 1"))
      conn.execute(text("SELECT 1 FROM conservation_package_items LIMIT 1"))
    return True
  except SQLAlchemyError as exc:
    logger.warning("Tabelle conservazione non accessibili: %s", exc)
    return False


def ensure_conservation_schema(*, force: bool = False) -> bool:
  """Crea conservation_packages / items se mancano (DDL idempotente)."""
  global _table_ready
  if _table_ready and not force and _verify_conservation_tables():
    return True
  if not force and _verify_conservation_tables():
    _table_ready = True
    return True
  try:
    with engine.begin() as conn:
      conn.execute(
        text(
          """
          CREATE TABLE IF NOT EXISTS conservation_packages (
            id SERIAL PRIMARY KEY,
            company VARCHAR(64) NOT NULL,
            label VARCHAR(255),
            period_from TIMESTAMPTZ,
            period_to TIMESTAMPTZ,
            status VARCHAR(32) NOT NULL DEFAULT 'bozza',
            document_count INTEGER NOT NULL DEFAULT 0,
            package_hash VARCHAR(64),
            package_path VARCHAR(500),
            index_json_path VARCHAR(500),
            note TEXT,
            built_at TIMESTAMPTZ,
            exported_at TIMESTAMPTZ,
            sent_at TIMESTAMPTZ,
            conserved_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
          """
        )
      )
      conn.execute(
        text(
          """
          CREATE TABLE IF NOT EXISTS conservation_package_items (
            id SERIAL PRIMARY KEY,
            package_id INTEGER NOT NULL REFERENCES conservation_packages(id) ON DELETE CASCADE,
            source_kind VARCHAR(32) NOT NULL,
            source_id INTEGER NOT NULL,
            invoice_number VARCHAR(128),
            invoice_date TIMESTAMPTZ,
            supplier_name VARCHAR(512),
            customer_vat VARCHAR(32),
            total_amount NUMERIC(12, 2),
            file_role VARCHAR(16) NOT NULL,
            original_filename VARCHAR(255),
            stored_relpath VARCHAR(500),
            content_sha256 VARCHAR(64),
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
          """
        )
      )
      conn.execute(text("CREATE INDEX IF NOT EXISTS ix_conservation_packages_company ON conservation_packages (company)"))
      conn.execute(text("CREATE INDEX IF NOT EXISTS ix_conservation_packages_status ON conservation_packages (status)"))
      conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_conservation_package_items_package ON conservation_package_items (package_id)")
      )
      conn.execute(
        text(
          "CREATE INDEX IF NOT EXISTS ix_conservation_package_items_source "
          "ON conservation_package_items (source_kind, source_id)"
        )
      )
    _table_ready = _verify_conservation_tables()
    return _table_ready
  except Exception as exc:
    logger.warning("Creazione tabelle conservazione fallita: %s", exc)
    return False


def _rollback_db(db: Session) -> None:
  try:
    db.rollback()
  except Exception:
    pass


def _with_conservation_tables(db: Session, fn: Callable[[], _T]) -> _T:
  try:
    return fn()
  except ProgrammingError as exc:
    err = str(exc).lower()
    if "conservation_package" not in err:
      raise
    _rollback_db(db)
    global _table_ready
    _table_ready = False
    if not ensure_conservation_schema(force=True):
      raise HTTPException(status_code=503, detail=CONSERVATION_ENSURE_HINT) from exc
    try:
      return fn()
    except ProgrammingError as retry_exc:
      _rollback_db(db)
      raise HTTPException(status_code=503, detail=CONSERVATION_ENSURE_HINT) from retry_exc


def _sha256_bytes(data: bytes) -> str:
  return hashlib.sha256(data).hexdigest()


def _parse_day(raw: Optional[str]) -> Optional[datetime]:
  if not raw or not str(raw).strip():
    return None
  s = str(raw).strip()[:10]
  d = date.fromisoformat(s)
  return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
  if dt is None:
    return None
  if dt.tzinfo is None:
    return dt.replace(tzinfo=timezone.utc)
  return dt


def _in_period(dt: Optional[datetime], start: Optional[datetime], end: Optional[datetime]) -> bool:
  if not start and not end:
    return True
  if dt is None:
    return False
  d = _aware(dt)
  if start and d < start:
    return False
  if end:
    # inclusive end-of-day
    end_excl = end.replace(hour=23, minute=59, second=59, microsecond=999999)
    if d > end_excl:
      return False
  return True


def _package_out(pkg: ConservationPackage, items: Optional[List[ConservationPackageItem]] = None) -> Dict[str, Any]:
  data = {
    "id": pkg.id,
    "company": pkg.company,
    "label": pkg.label,
    "period_from": pkg.period_from.isoformat() if pkg.period_from else None,
    "period_to": pkg.period_to.isoformat() if pkg.period_to else None,
    "status": pkg.status or "bozza",
    "document_count": int(pkg.document_count or 0),
    "package_hash": pkg.package_hash,
    "package_path": pkg.package_path,
    "note": pkg.note,
    "built_at": pkg.built_at.isoformat() if pkg.built_at else None,
    "exported_at": pkg.exported_at.isoformat() if pkg.exported_at else None,
    "sent_at": pkg.sent_at.isoformat() if pkg.sent_at else None,
    "conserved_at": pkg.conserved_at.isoformat() if pkg.conserved_at else None,
    "created_at": pkg.created_at.isoformat() if pkg.created_at else None,
    "download_url": f"/conservazione/packages/{pkg.id}/download" if pkg.package_path else None,
  }
  if items is not None:
    data["items"] = [_item_out(it) for it in items]
  return data


def _item_out(it: ConservationPackageItem) -> Dict[str, Any]:
  return {
    "id": it.id,
    "source_kind": it.source_kind,
    "source_id": it.source_id,
    "invoice_number": it.invoice_number,
    "invoice_date": it.invoice_date.isoformat() if it.invoice_date else None,
    "supplier_name": it.supplier_name,
    "customer_vat": it.customer_vat,
    "total_amount": float(it.total_amount) if it.total_amount is not None else None,
    "file_role": it.file_role,
    "original_filename": it.original_filename,
    "content_sha256": it.content_sha256,
  }


def _as_dict(row: Any) -> Dict[str, Any]:
  if isinstance(row, dict):
    return row
  if hasattr(row, "model_dump"):
    return row.model_dump()
  if hasattr(row, "dict"):
    return row.dict()
  return dict(row)


def _parse_any_dt(raw: Any) -> Optional[datetime]:
  if raw is None:
    return None
  if isinstance(raw, datetime):
    return _aware(raw)
  if isinstance(raw, date) and not isinstance(raw, datetime):
    return datetime(raw.year, raw.month, raw.day, tzinfo=timezone.utc)
  if isinstance(raw, str) and raw.strip():
    try:
      return datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError:
      return None
  return None


def _iso_or_none(raw: Any) -> Optional[str]:
  if raw is None:
    return None
  if isinstance(raw, datetime):
    return raw.isoformat()
  if isinstance(raw, date):
    return raw.isoformat()
  s = str(raw).strip()
  return s or None


def list_candidates(
  db: Session,
  *,
  company: str,
  period_from: Optional[str] = None,
  period_to: Optional[str] = None,
  include_issued: bool = True,
) -> Dict[str, Any]:
  company_id = normalize_company_section(company)
  if company_id == "non_classificata":
    raise HTTPException(status_code=400, detail="Seleziona una società valida")

  start = _parse_day(period_from)
  end = _parse_day(period_to)
  atlas = invoice_service.list_invoices(db, company=company_id, include_ignored=False)
  docs: List[Dict[str, Any]] = []
  for raw_inv in atlas:
    inv = _as_dict(raw_inv)
    inv_date = inv.get("invoice_date")
    dt = _parse_any_dt(inv_date)
    if not _in_period(dt, start, end):
      continue
    inv_id = int(inv["id"])
    has_file = bool(inv.get("file_path"))
    xml_text, pdf_bytes, _err = invoice_pdf_service.load_xml_text_for_atlas_invoice(db, inv_id)
    if not has_file and not xml_text and not pdf_bytes:
      continue
    docs.append(
      {
        "source_kind": "atlas",
        "source_id": inv_id,
        "invoice_number": inv.get("invoice_number"),
        "invoice_date": _iso_or_none(inv_date),
        "supplier_name": inv.get("supplier_name"),
        "total_amount": float(inv["total"]) if inv.get("total") is not None else None,
        "has_xml": bool(xml_text),
        "has_pdf": bool(pdf_bytes) or (str(inv.get("file_path") or "").lower().endswith(".pdf")),
        "selected_key": f"atlas:{inv_id}",
      }
    )

  if include_issued:
    issued = issued_invoice_service.list_issued_invoices(db, company=company_id, limit=500)
    for raw_row in issued:
      row = _as_dict(raw_row)
      inv_date = row.get("invoice_date") or row.get("created_at")
      dt = _parse_any_dt(inv_date)
      if not _in_period(dt, start, end):
        continue
      kind = (row.get("file_kind") or "").lower()
      docs.append(
        {
          "source_kind": "issued",
          "source_id": row["id"],
          "invoice_number": row.get("invoice_number") or row.get("original_filename"),
          "invoice_date": _iso_or_none(inv_date),
          "supplier_name": row.get("customer_name") or "Cliente",
          "total_amount": float(row["total_amount"]) if row.get("total_amount") is not None else None,
          "has_xml": kind == "xml",
          "has_pdf": kind == "pdf",
          "selected_key": f"issued:{row['id']}",
        }
      )

  docs.sort(key=lambda d: (d.get("invoice_date") or "", d.get("invoice_number") or ""))
  return {
    "company": company_id,
    "period_from": period_from,
    "period_to": period_to,
    "count": len(docs),
    "items": docs,
  }


def list_packages(db: Session, *, company: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
  def _run() -> List[Dict[str, Any]]:
    q = db.query(ConservationPackage).order_by(ConservationPackage.id.desc())
    if company:
      cid = normalize_company_section(company)
      if cid != "non_classificata":
        q = q.filter(ConservationPackage.company == cid)
    rows = q.limit(max(1, min(limit, 300))).all()
    return [_package_out(r) for r in rows]

  return _with_conservation_tables(db, _run)


def get_package(db: Session, package_id: int) -> Dict[str, Any]:
  def _run() -> Dict[str, Any]:
    pkg = db.query(ConservationPackage).filter(ConservationPackage.id == package_id).first()
    if not pkg:
      raise HTTPException(status_code=404, detail="Pacchetto non trovato")
    items = (
      db.query(ConservationPackageItem)
      .filter(ConservationPackageItem.package_id == package_id)
      .order_by(ConservationPackageItem.id.asc())
      .all()
    )
    return _package_out(pkg, items)

  return _with_conservation_tables(db, _run)


def create_package(
  db: Session,
  *,
  company: str,
  label: Optional[str] = None,
  period_from: Optional[str] = None,
  period_to: Optional[str] = None,
  document_keys: Optional[List[str]] = None,
  note: Optional[str] = None,
) -> Dict[str, Any]:
  def _run() -> Dict[str, Any]:
    company_id = normalize_company_section(company)
    if company_id == "non_classificata":
      raise HTTPException(status_code=400, detail="Seleziona una società valida")

    keys = [str(k).strip() for k in (document_keys or []) if str(k).strip()]
    if not keys:
      raise HTTPException(status_code=400, detail="Seleziona almeno un documento")

    # Solo i documenti selezionati (niente scan completo del periodo: evita OOM/timeout)
    selected: List[Dict[str, Any]] = []
    for key in keys:
      kind, sep, sid_raw = key.partition(":")
      if not sep or kind not in {"atlas", "issued"}:
        raise HTTPException(status_code=400, detail=f"Chiave documento non valida: {key}")
      try:
        source_id = int(sid_raw)
      except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"ID documento non valido: {key}") from exc
      selected.append(
        {
          "source_kind": kind,
          "source_id": source_id,
          "invoice_number": None,
          "invoice_date": None,
          "supplier_name": None,
          "total_amount": None,
          "selected_key": key,
        }
      )

    start = _parse_day(period_from)
    end = _parse_day(period_to)
    label_raw = (label or "").strip() or (
      f"Conservazione {company_id} {(period_from or '…')}→{(period_to or '…')}"
    )
    try:
      CONSERVATION_ROOT.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
      raise HTTPException(
        status_code=500,
        detail=f"Cartella uploads/conservazione non scrivibile: {exc}",
      ) from exc

    pkg = ConservationPackage(
      company=company_id,
      label=label_raw[:255],
      period_from=start,
      period_to=end,
      status="bozza",
      document_count=0,
      note=((note or "").strip() or None),
    )
    db.add(pkg)
    db.flush()

    errors: List[str] = []
    for doc in selected:
      try:
        _add_document_files(db, pkg, doc)
      except HTTPException as exc:
        errors.append(f"{doc.get('selected_key')}: {exc.detail}")
      except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Conservazione file fallita per %s", doc.get("selected_key"))
        errors.append(f"{doc.get('selected_key')}: {exc}")

    pkg.document_count = (
      db.query(ConservationPackageItem).filter(ConservationPackageItem.package_id == pkg.id).count()
    )
    if pkg.document_count <= 0:
      db.rollback()
      detail = "Nessun file allegabile ai documenti selezionati."
      if errors:
        detail = f"{detail} Dettagli: " + "; ".join(errors[:5])
      raise HTTPException(status_code=400, detail=detail)

    if errors:
      note_extra = "Avvisi: " + "; ".join(errors[:8])
      pkg.note = ((pkg.note + " | ") if pkg.note else "") + note_extra
      if len(pkg.note) > 2000:
        pkg.note = pkg.note[:2000]

    db.commit()
    db.refresh(pkg)
    return get_package(db, pkg.id)

  try:
    return _with_conservation_tables(db, _run)
  except HTTPException:
    raise
  except Exception as exc:  # pylint: disable=broad-except
    logger.exception("create_package fallita")
    _rollback_db(db)
    raise HTTPException(status_code=500, detail=f"Creazione pacchetto fallita: {exc}") from exc


def _add_document_files(db: Session, pkg: ConservationPackage, doc: Dict[str, Any]) -> None:
  kind = doc["source_kind"]
  source_id = int(doc["source_id"])
  pkg_dir = CONSERVATION_ROOT / str(pkg.id) / "docs"
  try:
    pkg_dir.mkdir(parents=True, exist_ok=True)
  except OSError as exc:
    raise HTTPException(
      status_code=500,
      detail=f"Impossibile creare cartella pacchetto (permessi uploads): {exc}",
    ) from exc

  if kind == "atlas":
    xml_text, pdf_bytes, err = invoice_pdf_service.load_xml_text_for_atlas_invoice(db, source_id)
    meta_number = doc.get("invoice_number")
    meta_date = doc.get("invoice_date")
    meta_supplier = doc.get("supplier_name")
    meta_total = doc.get("total_amount")
    # Arricchisci metadati da DB se mancanti (query singola, non list_invoices)
    if meta_number is None or meta_supplier is None or meta_total is None:
      try:
        from ..models.invoice import Invoice
        from ..models.supplier import Supplier

        row = (
          db.query(Invoice, Supplier.name)
          .join(Supplier, Invoice.supplier_id == Supplier.id)
          .filter(Invoice.id == source_id)
          .first()
        )
        if row:
          inv, supplier_name = row
          meta_number = meta_number or inv.invoice_number
          meta_date = meta_date or _iso_or_none(inv.invoice_date)
          meta_supplier = meta_supplier or supplier_name
          if meta_total is None and inv.total is not None:
            meta_total = float(inv.total)
      except Exception:  # pylint: disable=broad-except
        pass
    if xml_text:
      raw = xml_text.encode("utf-8")
      name = f"atlas_{source_id}.xml"
      dest = pkg_dir / name
      try:
        dest.write_bytes(raw)
      except OSError as exc:
        raise HTTPException(
          status_code=500,
          detail=f"Scrittura XML fallita (permessi uploads): {exc}",
        ) from exc
      db.add(
        ConservationPackageItem(
          package_id=pkg.id,
          source_kind="atlas",
          source_id=source_id,
          invoice_number=(str(meta_number)[:128] if meta_number else None),
          invoice_date=_parse_iso(meta_date),
          supplier_name=(str(meta_supplier)[:512] if meta_supplier else None),
          total_amount=_dec(meta_total),
          file_role="xml",
          original_filename=name,
          stored_relpath=_rel(dest)[:500],
          content_sha256=_sha256_bytes(raw),
        )
      )
    pdf_out = pdf_bytes
    if not pdf_out and xml_text:
      try:
        from .fatturapa_pdf import build_fatturapa_pdf_bytes

        pdf_out = build_fatturapa_pdf_bytes(xml_text)
      except Exception as exc:  # pylint: disable=broad-except
        logger.warning("PDF generazione atlas %s: %s", source_id, exc)
    if pdf_out:
      name = f"atlas_{source_id}.pdf"
      dest = pkg_dir / name
      try:
        dest.write_bytes(pdf_out)
      except OSError as exc:
        raise HTTPException(
          status_code=500,
          detail=f"Scrittura PDF fallita (permessi uploads): {exc}",
        ) from exc
      db.add(
        ConservationPackageItem(
          package_id=pkg.id,
          source_kind="atlas",
          source_id=source_id,
          invoice_number=(str(meta_number)[:128] if meta_number else None),
          invoice_date=_parse_iso(meta_date),
          supplier_name=(str(meta_supplier)[:512] if meta_supplier else None),
          total_amount=_dec(meta_total),
          file_role="pdf",
          original_filename=name,
          stored_relpath=_rel(dest)[:500],
          content_sha256=_sha256_bytes(pdf_out),
        )
      )
    if not xml_text and not pdf_out:
      raise HTTPException(
        status_code=400,
        detail=f"Documento atlas {source_id} senza XML/PDF ({err or 'file assente'})",
      )
    return

  if kind == "issued":
    try:
      path, row = issued_invoice_service.resolve_issued_file(db, source_id)
      raw = path.read_bytes()
      role = (row.file_kind or "other").lower()
      if role not in {"xml", "pdf", "image"}:
        role = "other"
      if role == "image":
        role = "other"
      safe_base = (path.name or f"file_{source_id}")[-180:]
      name = f"issued_{source_id}_{safe_base}"
      dest = pkg_dir / name
      try:
        dest.write_bytes(raw)
      except OSError as exc:
        raise HTTPException(
          status_code=500,
          detail=f"Scrittura issued fallita (permessi uploads): {exc}",
        ) from exc
      orig_name = (row.original_filename or path.name or name)[:255]
      db.add(
        ConservationPackageItem(
          package_id=pkg.id,
          source_kind="issued",
          source_id=source_id,
          invoice_number=(row.invoice_number or row.original_filename or "")[:128] or None,
          invoice_date=row.invoice_date or row.created_at,
          supplier_name=(row.customer_name or "Cliente")[:512],
          customer_vat=(row.customer_vat or None),
          total_amount=row.total_amount,
          file_role="xml" if role == "xml" else ("pdf" if role == "pdf" else "other"),
          original_filename=orig_name,
          stored_relpath=_rel(dest)[:500],
          content_sha256=_sha256_bytes(raw),
        )
      )
    except HTTPException:
      raise
    except Exception as exc:  # pylint: disable=broad-except
      raise HTTPException(
        status_code=400,
        detail=f"Issued {source_id} non disponibile: {exc}",
      ) from exc
    return

  raise HTTPException(status_code=400, detail=f"Tipo documento non supportato: {kind}")


def _parse_iso(raw: Any) -> Optional[datetime]:
  if not raw:
    return None
  if isinstance(raw, datetime):
    return _aware(raw)
  try:
    return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
  except ValueError:
    return None


def _dec(raw: Any) -> Optional[Decimal]:
  if raw is None or raw == "":
    return None
  try:
    return Decimal(str(raw))
  except Exception:
    return None


def _rel(path: Path) -> str:
  try:
    return str(path.relative_to(APP_ROOT)).replace("\\", "/")
  except ValueError:
    return str(path).replace("\\", "/")


def build_package(db: Session, package_id: int) -> Dict[str, Any]:
  ensure_conservation_schema()
  pkg = db.query(ConservationPackage).filter(ConservationPackage.id == package_id).first()
  if not pkg:
    raise HTTPException(status_code=404, detail="Pacchetto non trovato")
  items = (
    db.query(ConservationPackageItem)
    .filter(ConservationPackageItem.package_id == package_id)
    .order_by(ConservationPackageItem.id.asc())
    .all()
  )
  if not items:
    raise HTTPException(status_code=400, detail="Pacchetto vuoto: nessun documento")

  pkg_dir = CONSERVATION_ROOT / str(pkg.id)
  pkg_dir.mkdir(parents=True, exist_ok=True)

  index = {
    "schema": "atlas-conservazione-v1",
    "package_id": pkg.id,
    "company": pkg.company,
    "label": pkg.label,
    "period_from": pkg.period_from.isoformat() if pkg.period_from else None,
    "period_to": pkg.period_to.isoformat() if pkg.period_to else None,
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "documents": [_item_out(it) for it in items],
    "legal_note": (
      "Pacchetto preparato da Atlas per conservazione sostitutiva. "
      "L'invio a un conservatore accreditato e la firma qualificata restano obbligatori "
      "per la conformità normativa completa."
    ),
  }
  index_path = pkg_dir / "indice.json"
  index_bytes = json.dumps(index, ensure_ascii=False, indent=2).encode("utf-8")
  index_path.write_bytes(index_bytes)

  manifest_lines = ["filename;sha256;role;source_kind;source_id;invoice_number"]
  for it in items:
    fname = Path(it.stored_relpath or "").name or it.original_filename or f"item_{it.id}"
    manifest_lines.append(
      f"{fname};{it.content_sha256 or ''};{it.file_role};{it.source_kind};{it.source_id};{it.invoice_number or ''}"
    )
  manifest_path = pkg_dir / "manifest.csv"
  manifest_path.write_text("\n".join(manifest_lines) + "\n", encoding="utf-8")

  zip_path = pkg_dir / f"pacchetto_conservazione_{pkg.id}.zip"
  if zip_path.exists():
    zip_path.unlink()
  with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("indice.json", index_bytes)
    zf.writestr("manifest.csv", manifest_path.read_bytes())
    for it in items:
      if not it.stored_relpath:
        continue
      src = APP_ROOT / str(it.stored_relpath).replace("\\", "/")
      if not src.is_file():
        continue
      arc = f"docs/{src.name}"
      zf.write(src, arcname=arc)

  zip_bytes = zip_path.read_bytes()
  pkg.package_hash = _sha256_bytes(zip_bytes)
  pkg.package_path = _rel(zip_path)
  pkg.index_json_path = _rel(index_path)
  pkg.status = "pronto"
  pkg.built_at = datetime.now(timezone.utc)
  pkg.document_count = len(items)
  db.commit()
  db.refresh(pkg)
  return get_package(db, pkg.id)


def resolve_package_zip(db: Session, package_id: int) -> Tuple[Path, ConservationPackage]:
  ensure_conservation_schema()
  pkg = db.query(ConservationPackage).filter(ConservationPackage.id == package_id).first()
  if not pkg:
    raise HTTPException(status_code=404, detail="Pacchetto non trovato")
  if not pkg.package_path:
    raise HTTPException(status_code=400, detail="Pacchetto non ancora costruito: usa Genera pacchetto")
  path = APP_ROOT / str(pkg.package_path).replace("\\", "/")
  if not path.is_file():
    raise HTTPException(status_code=404, detail="File ZIP non trovato sul server")
  if pkg.status == "pronto":
    pkg.status = "esportato"
    pkg.exported_at = datetime.now(timezone.utc)
    db.commit()
  return path, pkg


def set_package_status(
  db: Session,
  package_id: int,
  *,
  status: str,
  note: Optional[str] = None,
) -> Dict[str, Any]:
  ensure_conservation_schema()
  pkg = db.query(ConservationPackage).filter(ConservationPackage.id == package_id).first()
  if not pkg:
    raise HTTPException(status_code=404, detail="Pacchetto non trovato")
  next_status = (status or "").strip().lower()
  if next_status not in STATUSES:
    raise HTTPException(status_code=400, detail=f"Stato non valido: {status}")
  current = (pkg.status or "bozza").lower()
  allowed = STATUS_TRANSITIONS.get(current, set())
  if next_status != current and next_status not in allowed:
    raise HTTPException(
      status_code=400,
      detail=f"Transizione non consentita: {current} → {next_status}",
    )
  pkg.status = next_status
  if note is not None:
    pkg.note = note.strip() or None
  now = datetime.now(timezone.utc)
  if next_status == "esportato" and not pkg.exported_at:
    pkg.exported_at = now
  if next_status == "inviato_conservatore":
    pkg.sent_at = now
  if next_status == "conservato":
    pkg.conserved_at = now
  db.commit()
  db.refresh(pkg)
  return get_package(db, pkg.id)


def delete_package(db: Session, package_id: int) -> bool:
  ensure_conservation_schema()
  pkg = db.query(ConservationPackage).filter(ConservationPackage.id == package_id).first()
  if not pkg:
    return False
  if (pkg.status or "") == "conservato":
    raise HTTPException(status_code=400, detail="Non si può eliminare un pacchetto già conservato")
  db.query(ConservationPackageItem).filter(ConservationPackageItem.package_id == package_id).delete()
  db.delete(pkg)
  db.commit()
  # best-effort cleanup files
  pkg_dir = CONSERVATION_ROOT / str(package_id)
  try:
    if pkg_dir.is_dir():
      import shutil

      shutil.rmtree(pkg_dir, ignore_errors=True)
  except Exception:
    pass
  return True
