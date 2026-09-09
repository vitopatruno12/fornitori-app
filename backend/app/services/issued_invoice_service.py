"""Upload e elenco fatture emesse (XML / PDF / immagine) con lettura automatica numero/importo."""
from __future__ import annotations

import io
import logging
import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..constants.sdi_companies import normalize_company_section
from ..models.issued_invoice import IssuedInvoice

logger = logging.getLogger(__name__)

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

IMAGE_MIME_BY_SUFFIX = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".bmp": "image/bmp",
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


def _amount_to_decimal(raw: Any) -> Optional[Decimal]:
  if raw is None:
    return None
  if isinstance(raw, Decimal):
    return raw
  s = str(raw).strip()
  if not s:
    return None
  s = s.replace("€", "").replace("EUR", "").replace(" ", "")
  if re.match(r"^\d{1,3}(\.\d{3})+,\d{1,2}$", s):
    s = s.replace(".", "").replace(",", ".")
  elif "," in s and "." not in s:
    s = s.replace(",", ".")
  elif s.count(",") == 1 and s.count(".") >= 1 and s.rfind(",") > s.rfind("."):
    s = s.replace(".", "").replace(",", ".")
  try:
    return Decimal(s)
  except (InvalidOperation, ValueError):
    return None


def _date_to_dt(raw: Any) -> Optional[datetime]:
  if raw is None:
    return None
  if isinstance(raw, datetime):
    return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
  if isinstance(raw, date):
    return datetime(raw.year, raw.month, raw.day, tzinfo=timezone.utc)
  s = str(raw).strip()
  if not s:
    return None
  try:
    if len(s) >= 10 and s[4] == "-":
      return datetime.fromisoformat(s[:10] + "T00:00:00").replace(tzinfo=timezone.utc)
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
      try:
        d = datetime.strptime(s[:10], fmt)
        return d.replace(tzinfo=timezone.utc)
      except ValueError:
        continue
  except Exception:
    return None
  return None


def _extract_meta_from_text(text: str) -> Dict[str, Any]:
  out: Dict[str, Any] = {"warnings": []}
  if not (text or "").strip():
    out["warnings"].append("Nessun testo leggibile nel documento")
    return out

  num_patterns = [
    r"(?:n[°ºo.]?\s*(?:fattura|documento|doc)|fattura\s*n[°ºo.]?|numero\s*(?:fattura|documento|doc)?)\s*[:\s#-]*([A-Za-z0-9][A-Za-z0-9/\-.]{0,30})",
    r"(?:invoice\s*(?:no|number|#)|doc\.?\s*n[°º.]?)\s*[:\s#-]*([A-Za-z0-9][A-Za-z0-9/\-.]{0,30})",
  ]
  for pat in num_patterns:
    m = re.search(pat, text, re.I)
    if m:
      cand = m.group(1).strip(" .;,:")
      if cand.lower() not in {"del", "di", "da", "data", "euro", "eur"}:
        out["invoice_number"] = cand
        break

  total_patterns = [
    r"(?:importo\s*totale\s*(?:documento)?|totale\s*documento|totale\s*fattura|totale\s*a\s*pagare|grand\s*total)\s*[:\s]*[€]?\s*([0-9]{1,3}(?:[.\s][0-9]{3})*(?:[.,][0-9]{1,2})|[0-9]+[.,][0-9]{1,2})",
    r"(?:totale|importo)\s*[:\s]*[€]?\s*([0-9]{1,3}(?:[.\s][0-9]{3})*(?:[.,][0-9]{1,2})|[0-9]+[.,][0-9]{1,2})\s*(?:€|eur)?",
  ]
  for pat in total_patterns:
    matches = list(re.finditer(pat, text, re.I))
    if matches:
      amt = _amount_to_decimal(matches[-1].group(1))
      if amt is not None and amt > 0:
        out["total_amount"] = amt
        break

  m_date = re.search(
    r"(?:data\s*(?:documento|fattura)?|del)\s*[:\s]*([0-3]?\d[/.][0-1]?\d[/.]\d{2,4}|\d{4}-\d{2}-\d{2})",
    text,
    re.I,
  )
  if m_date:
    dt = _date_to_dt(m_date.group(1))
    if dt:
      out["invoice_date"] = dt

  if not out.get("invoice_number"):
    out["warnings"].append("Numero fattura non rilevato automaticamente")
  if out.get("total_amount") is None:
    out["warnings"].append("Importo non rilevato automaticamente")
  return out


def _extract_from_xml(content: bytes) -> Dict[str, Any]:
  text = content.decode("utf-8", errors="replace")
  if "FatturaElettronica" not in text:
    m = re.search(rb"<\?xml[\s\S]*?<FatturaElettronica[\s\S]*?</[\w:]*FatturaElettronica>", content)
    if m:
      text = m.group(0).decode("utf-8", errors="replace")
  from ..integrations.sdi.invoice_document_parser import parse_fatturapa_document

  parsed = parse_fatturapa_document(text)
  doc = parsed.get("document") or {}
  out: Dict[str, Any] = {"source": "xml", "warnings": []}
  if doc.get("number"):
    out["invoice_number"] = str(doc["number"]).strip()
  if doc.get("total") is not None:
    out["total_amount"] = _amount_to_decimal(doc["total"])
  elif parsed.get("taxableAmount") is not None or parsed.get("vatAmount") is not None:
    try:
      tot = (parsed.get("taxableAmount") or Decimal("0")) + (parsed.get("vatAmount") or Decimal("0"))
      out["total_amount"] = tot
    except Exception:
      pass
  if doc.get("date"):
    out["invoice_date"] = _date_to_dt(doc["date"])
  if not out.get("invoice_number"):
    out["warnings"].append("Numero assente nell'XML")
  if out.get("total_amount") is None:
    out["warnings"].append("ImportoTotaleDocumento assente nell'XML")
  return out


def _extract_pdf_text(content: bytes) -> str:
  try:
    from pypdf import PdfReader
  except ImportError:
    return ""
  try:
    reader = PdfReader(io.BytesIO(content))
  except Exception:
    return ""
  chunks: List[str] = []
  for page in reader.pages:
    try:
      t = page.extract_text() or ""
    except Exception:
      t = ""
    if t.strip():
      chunks.append(t.strip())
  return "\n".join(chunks).strip()


def _ocr_image_text(content: bytes) -> str:
  try:
    from rapidocr_onnxruntime import RapidOCR
  except ImportError:
    return ""
  try:
    engine = RapidOCR()
    result, _ = engine(content)
    if not result:
      return ""
    lines = []
    for row in result:
      if isinstance(row, (list, tuple)) and len(row) >= 2:
        lines.append(str(row[1]))
      else:
        lines.append(str(row))
    return "\n".join(lines).strip()
  except Exception as exc:
    logger.warning("OCR immagine fallito: %s", exc)
    return ""


def _extract_from_image_gemini(content: bytes, filename: str) -> Dict[str, Any]:
  out: Dict[str, Any] = {"source": "gemini_vision", "warnings": []}
  try:
    from ..ai.gemini_client import _get_model, is_configured
    from ..ai.json_utils import parse_json_response
  except Exception:
    out["warnings"].append("Lettura foto non disponibile")
    return out
  if not is_configured():
    out["warnings"].append("Per leggere le foto configura GEMINI_API_KEY (oppure carica XML/PDF)")
    return out
  model = _get_model()
  if not model:
    out["warnings"].append("Modello Gemini non disponibile")
    return out
  suffix = Path(filename or "").suffix.lower()
  mime = IMAGE_MIME_BY_SUFFIX.get(suffix, "image/jpeg")
  prompt = (
    "Sei un assistente contabile. Dalla foto di una fattura italiana estrai JSON con chiavi: "
    "invoice_number (stringa, numero documento), total_amount (numero, importo totale documento), "
    "invoice_date (YYYY-MM-DD o null). Se non trovi un campo usa null. Solo JSON."
  )
  try:
    resp = model.generate_content(
      [prompt, {"mime_type": mime, "data": content}],
      generation_config={"response_mime_type": "application/json", "temperature": 0.1},
    )
    data = parse_json_response(resp.text or "") or {}
    if data.get("invoice_number"):
      out["invoice_number"] = str(data["invoice_number"]).strip()
    amt = _amount_to_decimal(data.get("total_amount"))
    if amt is not None:
      out["total_amount"] = amt
    dt = _date_to_dt(data.get("invoice_date"))
    if dt:
      out["invoice_date"] = dt
    if not out.get("invoice_number"):
      out["warnings"].append("Numero non letto dalla foto")
    if out.get("total_amount") is None:
      out["warnings"].append("Importo non letto dalla foto")
  except Exception as exc:
    logger.warning("Gemini vision emesse: %s", exc)
    out["warnings"].append("Lettura foto fallita")
  return out


def extract_issued_invoice_fields(
  content: bytes,
  *,
  filename: str = "",
  file_kind: str = "",
) -> Dict[str, Any]:
  kind = (file_kind or "").strip().lower()
  if not kind:
    try:
      kind = _detect_kind(filename, None, None)
    except HTTPException:
      kind = "pdf"

  if kind == "xml" or (filename or "").lower().endswith((".xml", ".p7m")) or b"<FatturaElettronica" in content[:20000]:
    try:
      return _extract_from_xml(content)
    except Exception as exc:
      logger.warning("Parse XML emessa: %s", exc)
      return {"source": "xml", "warnings": [f"XML non parsabile: {exc}"]}

  if kind == "pdf" or (filename or "").lower().endswith(".pdf") or content[:4] == b"%PDF":
    text = _extract_pdf_text(content)
    meta = _extract_meta_from_text(text)
    meta["source"] = "pdf"
    if not text:
      meta["warnings"] = list(meta.get("warnings") or [])
      meta["warnings"].insert(0, "PDF senza testo (scansione): prova XML o foto con AI")
    return meta

  text = _ocr_image_text(content)
  if text:
    meta = _extract_meta_from_text(text)
    meta["source"] = "image_ocr"
    return meta
  return _extract_from_image_gemini(content, filename)


def _row_out(row: IssuedInvoice, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
  data = {
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
  if extra:
    data.update(extra)
  return data


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
    if Path(file.filename or "").suffix:
      raise HTTPException(
        status_code=400,
        detail=f"Estensione non valida per {kind}: consentite {', '.join(sorted(ALLOWED_KINDS[kind]))}",
      )
    suffix = {"xml": ".xml", "pdf": ".pdf", "image": ".jpg"}[kind]

  extracted = extract_issued_invoice_fields(raw, filename=file.filename or "", file_kind=kind)
  warnings = list(extracted.get("warnings") or [])

  final_number = (invoice_number or "").strip() or (extracted.get("invoice_number") or None)
  if total_amount not in (None, ""):
    final_amount = _parse_optional_amount(total_amount)
  else:
    final_amount = extracted.get("total_amount")
    if final_amount is not None and not isinstance(final_amount, Decimal):
      final_amount = _amount_to_decimal(final_amount)

  if invoice_date not in (None, ""):
    final_date = _parse_optional_date(invoice_date)
  else:
    final_date = extracted.get("invoice_date")
    if isinstance(final_date, date) and not isinstance(final_date, datetime):
      final_date = datetime(final_date.year, final_date.month, final_date.day, tzinfo=timezone.utc)

  company_dir = UPLOAD_ROOT / company_id
  company_dir.mkdir(parents=True, exist_ok=True)
  stored_name = (
    f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_"
    f"{uuid.uuid4().hex[:8]}_{_safe_name(file.filename or f'doc{suffix}')}"
  )
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
    invoice_number=final_number,
    invoice_date=final_date,
    total_amount=final_amount,
    status="caricata",
    note=(note or "").strip() or None,
  )
  db.add(row)
  db.commit()
  db.refresh(row)

  extracted_amount = extracted.get("total_amount")
  return _row_out(
    row,
    extra={
      "extracted": {
        "invoice_number": extracted.get("invoice_number"),
        "total_amount": float(extracted_amount) if extracted_amount is not None else None,
        "invoice_date": extracted["invoice_date"].isoformat()
        if isinstance(extracted.get("invoice_date"), (datetime, date))
        else extracted.get("invoice_date"),
        "source": extracted.get("source"),
        "warnings": warnings,
      }
    },
  )


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


def resolve_issued_file(db: Session, invoice_id: int) -> Tuple[Path, IssuedInvoice]:
  row = get_issued_invoice(db, invoice_id)
  if not row:
    raise HTTPException(status_code=404, detail="Fattura emessa non trovata")
  path = (UPLOAD_ROOT.parent.parent / str(row.file_path or "").replace("\\", "/")).resolve()
  root = UPLOAD_ROOT.resolve()
  if root not in path.parents and path != root:
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
