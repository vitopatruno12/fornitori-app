import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..models.supplier_payments_workbook import SupplierPaymentsWorkbook
from ..schemas.supplier_payments import (
    SupplierPaymentsSheet,
    SupplierPaymentsWorkbookPayload,
    SupplierPaymentsWorkbookRead,
    SupplierPaymentsWorkbookUpsert,
)

DEFAULT_WORKBOOK_KEY = "risacca_2026"
_DEFAULT_PATH = Path(__file__).resolve().parent.parent / "data" / "fornitori_risacca_2026_default.json"


def _load_default_payload() -> Dict[str, Any]:
  if _DEFAULT_PATH.is_file():
    with _DEFAULT_PATH.open(encoding="utf-8") as handle:
      return json.load(handle)
  return {"title": "FILE FORNITORI_RISACCA_2026", "sheets": []}


def _normalize_workbook_key(workbook_key: str) -> str:
  key = (workbook_key or DEFAULT_WORKBOOK_KEY).strip()
  return key or DEFAULT_WORKBOOK_KEY


def _payload_from_row(row: SupplierPaymentsWorkbook) -> SupplierPaymentsWorkbookPayload:
  try:
    raw = json.loads(row.payload_json or "{}")
  except json.JSONDecodeError:
    raw = {}
  sheets_raw = raw.get("sheets") if isinstance(raw, dict) else []
  sheets: List[SupplierPaymentsSheet] = []
  if isinstance(sheets_raw, list):
    for item in sheets_raw:
      if not isinstance(item, dict):
        continue
      name = str(item.get("name") or "").strip()
      rows = item.get("rows")
      if not name or not isinstance(rows, list):
        continue
      sheets.append(SupplierPaymentsSheet(name=name, rows=rows))
  title = str(raw.get("title") or row.title or "").strip()
  highlights = raw.get("highlights") if isinstance(raw.get("highlights"), dict) else {}
  return SupplierPaymentsWorkbookPayload(title=title or row.title or "", sheets=sheets, highlights=highlights)


def workbook_to_read(row: SupplierPaymentsWorkbook, *, seeded: bool = False) -> SupplierPaymentsWorkbookRead:
  payload = _payload_from_row(row)
  return SupplierPaymentsWorkbookRead(
      workbook_key=row.workbook_key,
      title=payload.title,
      sheets=payload.sheets,
      highlights=payload.highlights,
      updated_at=row.updated_at,
      seeded=seeded,
  )


def get_workbook(db: Session, workbook_key: str = DEFAULT_WORKBOOK_KEY) -> SupplierPaymentsWorkbookRead:
  key = _normalize_workbook_key(workbook_key)
  row = db.query(SupplierPaymentsWorkbook).filter(SupplierPaymentsWorkbook.workbook_key == key).first()
  if row:
    return workbook_to_read(row)

  default_payload = _load_default_payload()
  title = str(default_payload.get("title") or "FILE FORNITORI_RISACCA_2026")
  payload_json = json.dumps(default_payload, ensure_ascii=False)
  row = SupplierPaymentsWorkbook(workbook_key=key, title=title, payload_json=payload_json)
  db.add(row)
  db.commit()
  db.refresh(row)
  return workbook_to_read(row, seeded=True)


def upsert_workbook(db: Session, payload: SupplierPaymentsWorkbookUpsert) -> SupplierPaymentsWorkbookRead:
  key = _normalize_workbook_key(payload.workbook_key)
  body = {
      "title": (payload.title or "FILE FORNITORI_RISACCA_2026").strip(),
      "sheets": [sheet.model_dump() for sheet in payload.sheets],
  }
  if isinstance(payload.highlights, dict):
    body["highlights"] = payload.highlights
  payload_json = json.dumps(body, ensure_ascii=False)
  row = db.query(SupplierPaymentsWorkbook).filter(SupplierPaymentsWorkbook.workbook_key == key).first()
  if row:
    row.title = body["title"]
    row.payload_json = payload_json
  else:
    row = SupplierPaymentsWorkbook(workbook_key=key, title=body["title"], payload_json=payload_json)
    db.add(row)
  db.commit()
  db.refresh(row)
  return workbook_to_read(row)
