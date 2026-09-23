import json
import re
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

DEFAULT_WORKBOOK_KEY = "mediazione_2026"
LEGACY_RISACCA_KEY = "risacca_2026"
_DEFAULT_PATH = Path(__file__).resolve().parent.parent / "data" / "fornitori_risacca_2026_default.json"

# Un file Excel/registro per società (Mediazione A+Z condividono lo stesso file).
WORKBOOK_CATALOG: List[Dict[str, Any]] = [
  {
    "key": "mediazione_2026",
    "label": "File fornitori Mediazione",
    "title": "FILE FORNITORI_MEDIAZIONE_2026",
    "companies": ["mediazione_a", "mediazione_z", "mediazione"],
  },
  {
    "key": "via_lattea_2026",
    "label": "File fornitori Via Lattea",
    "title": "FILE FORNITORI_VIA_LATTEA_2026",
    "companies": ["via_lattea"],
  },
  {
    "key": "risacca_2026",
    "label": "File fornitori Risacca",
    "title": "FILE FORNITORI_RISACCA_2026",
    "companies": ["risacca"],
  },
  {
    "key": "pg_2026",
    "label": "File fornitori PG",
    "title": "FILE FORNITORI_PG_2026",
    "companies": ["pg"],
  },
]

_WORKBOOK_BY_KEY = {str(item["key"]): item for item in WORKBOOK_CATALOG}
_COMPANY_TO_WORKBOOK = {
  str(company): str(item["key"])
  for item in WORKBOOK_CATALOG
  for company in (item.get("companies") or [])
}


def list_workbook_catalog(db: Optional[Session] = None) -> List[Dict[str, Any]]:
  """Elenco file fornitori disponibili (menu a tendina Pagamenti)."""
  if db is not None:
    migrate_legacy_risacca_workbook_to_mediazione(db)
  existing: Dict[str, Any] = {}
  if db is not None:
    for row in db.query(SupplierPaymentsWorkbook).all():
      existing[str(row.workbook_key)] = row
  out: List[Dict[str, Any]] = []
  for item in WORKBOOK_CATALOG:
    key = str(item["key"])
    row = existing.get(key)
    out.append(
      {
        "key": key,
        "label": item["label"],
        "title": (row.title if row and row.title else item["title"]),
        "companies": list(item.get("companies") or []),
        "exists": row is not None,
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
      }
    )
  return out


def workbook_key_for_company(company_id: Optional[str]) -> str:
  raw = str(company_id or "").strip().lower()
  if not raw:
    return DEFAULT_WORKBOOK_KEY
  return _COMPANY_TO_WORKBOOK.get(raw, DEFAULT_WORKBOOK_KEY)


def catalog_entry_for_key(workbook_key: str) -> Dict[str, Any]:
  key = _normalize_workbook_key(workbook_key)
  return _WORKBOOK_BY_KEY.get(key) or {
    "key": key,
    "label": key,
    "title": f"FILE FORNITORI_{key.upper()}",
    "companies": [],
  }


def _load_default_payload() -> Dict[str, Any]:
  if _DEFAULT_PATH.is_file():
    with _DEFAULT_PATH.open(encoding="utf-8") as handle:
      payload = json.load(handle)
    if isinstance(payload, dict):
      payload["title"] = "FILE FORNITORI_MEDIAZIONE_2026"
      return payload
  return {"title": "FILE FORNITORI_MEDIAZIONE_2026", "sheets": []}


def _invoice_row_count(row: Optional[SupplierPaymentsWorkbook]) -> int:
  if row is None:
    return 0
  try:
    raw = json.loads(row.payload_json or "{}")
  except json.JSONDecodeError:
    return 0
  sheets = raw.get("sheets") if isinstance(raw, dict) else None
  if not isinstance(sheets, list):
    return 0
  special = {"TOTALI", "DELEGHE F24", "VERSAMENTO CONTANTI"}
  count = 0
  for sheet in sheets:
    if not isinstance(sheet, dict):
      continue
    name = str(sheet.get("name") or "").strip().upper()
    if not name or name in special:
      continue
    rows = sheet.get("rows")
    if not isinstance(rows, list):
      continue
    for idx, line in enumerate(rows):
      if idx == 0 or not isinstance(line, list):
        continue
      num = str(line[1] if len(line) > 1 else "" or "").strip().strip("'")
      name_cell = str(line[4] if len(line) > 4 else "" or "").strip().strip("'")
      if num or name_cell:
        count += 1
  return count


def _workbook_has_invoice_rows(row: Optional[SupplierPaymentsWorkbook]) -> bool:
  return _invoice_row_count(row) > 0


def _apply_payload_to_row(row: SupplierPaymentsWorkbook, payload: Dict[str, Any], *, title: str) -> None:
  body = dict(payload) if isinstance(payload, dict) else {}
  body["title"] = title
  row.title = title
  row.payload_json = json.dumps(body, ensure_ascii=False)


def migrate_legacy_risacca_workbook_to_mediazione(db: Session) -> bool:
  """Sposta il registro storico da risacca_2026 a mediazione_2026.

  Il file unico era salvato come Risacca: i dati vanno sotto Mediazione.
  Se entrambi hanno righe, vince quello con più documenti (di solito Risacca live).
  """
  med_key = "mediazione_2026"
  ris_key = LEGACY_RISACCA_KEY
  med = (
    db.query(SupplierPaymentsWorkbook)
    .filter(SupplierPaymentsWorkbook.workbook_key == med_key)
    .first()
  )
  ris = (
    db.query(SupplierPaymentsWorkbook)
    .filter(SupplierPaymentsWorkbook.workbook_key == ris_key)
    .first()
  )
  if ris is None:
    # Solo rinomina titolo se Mediazione ha ancora "RISACCA" nel titolo
    if med is not None and "RISACCA" in str(med.title or "").upper():
      try:
        raw = json.loads(med.payload_json or "{}")
      except json.JSONDecodeError:
        raw = {}
      if not isinstance(raw, dict):
        raw = {}
      title = "FILE FORNITORI_MEDIAZIONE_2026"
      _apply_payload_to_row(med, raw, title=title)
      db.add(med)
      db.commit()
      return True
    return False

  title = "FILE FORNITORI_MEDIAZIONE_2026"
  ris_count = _invoice_row_count(ris)
  med_count = _invoice_row_count(med)

  try:
    ris_raw = json.loads(ris.payload_json or "{}")
  except json.JSONDecodeError:
    ris_raw = {}
  if not isinstance(ris_raw, dict):
    ris_raw = {}

  # Caso 1: solo Risacca → rinomina in Mediazione + Risacca vuota
  if med is None:
    ris.workbook_key = med_key
    _apply_payload_to_row(ris, ris_raw, title=title)
    db.add(ris)
    empty = _empty_workbook_payload("FILE FORNITORI_RISACCA_2026")
    db.add(
      SupplierPaymentsWorkbook(
        workbook_key=ris_key,
        title=str(empty.get("title") or "FILE FORNITORI_RISACCA_2026"),
        payload_json=json.dumps(empty, ensure_ascii=False),
      )
    )
    db.commit()
    return True

  # Caso 2: Risacca ha dati (e non meno di Mediazione) → sposta su Mediazione
  # Copre anche Mediazione già seedata dal template JSON (stesso contenuto o meno righe).
  if ris_count > 0 and ris_count >= med_count:
    _apply_payload_to_row(med, ris_raw, title=title)
    empty = _empty_workbook_payload("FILE FORNITORI_RISACCA_2026")
    _apply_payload_to_row(ris, empty, title=str(empty.get("title") or "FILE FORNITORI_RISACCA_2026"))
    db.add(med)
    db.add(ris)
    db.commit()
    return True

  # Caso 3: Mediazione ha i dati ma titolo ancora RISACCA
  if med is not None and "RISACCA" in str(med.title or "").upper():
    try:
      raw = json.loads(med.payload_json or "{}")
    except json.JSONDecodeError:
      raw = {}
    if not isinstance(raw, dict):
      raw = {}
    _apply_payload_to_row(med, raw, title=title)
    db.add(med)
    db.commit()
    return True

  return False


_MONTHLY_HEADERS = [
  "Tipo documento",
  "Numero fattura / Documento",
  "Data emissione",
  "Identificativo fornitore",
  "Denominazione",
  "Imponibile",
  "Imposta ",
  "PAGARE (AVERE)",
  " PAGATO (DARE)",
  "TOTALE FORNITORE",
  "DATA PAGAMENTO",
  "acquisto attrezzature",
]

_EMPTY_MONTH_SHEETS = (
  "GENNAIO",
  "FEBBRAIO",
  "MARZO",
  "APRILE",
  "MAGGIO",
  "GIUGNO",
)


def _empty_monthly_sheet(name: str) -> Dict[str, Any]:
  footer = [None] * len(_MONTHLY_HEADERS)
  footer[6] = "TOTALE"
  return {
    "name": name,
    "rows": [
      list(_MONTHLY_HEADERS),
      [None] * len(_MONTHLY_HEADERS),
      [None] * len(_MONTHLY_HEADERS),
      [None] * len(_MONTHLY_HEADERS),
      footer,
    ],
  }


def _empty_workbook_payload(title: Optional[str] = None) -> Dict[str, Any]:
  """Registro pulito: fogli mese vuoti + fogli speciali con sola struttura."""
  default = _load_default_payload()
  sheets: List[Dict[str, Any]] = []
  for name in _EMPTY_MONTH_SHEETS:
    sheets.append(_empty_monthly_sheet(name))
  for item in default.get("sheets") or []:
    if not isinstance(item, dict):
      continue
    name = str(item.get("name") or "").strip().upper()
    if name in {"TOTALI", "DELEGHE F24", "VERSAMENTO CONTANTI"}:
      rows = item.get("rows") if isinstance(item.get("rows"), list) else []
      if name == "TOTALI":
        header = list(rows[0]) if rows and isinstance(rows[0], list) else []
        width = max(9, len(header))
        empty_rows = [header if header else [None] * width]
        empty_rows.extend([[None] * width for _ in range(6)])
        sheets.append({"name": name, "rows": empty_rows})
      else:
        top = [list(r) if isinstance(r, list) else [] for r in rows[:4]]
        while len(top) < 4:
          top.append([])
        sheets.append({"name": name, "rows": top})
  default_title = str(default.get("title") or "FILE FORNITORI_MEDIAZIONE_2026")
  return {
    "title": str(title or default_title).strip() or default_title,
    "sheets": sheets,
    "highlights": {},
  }


def _seed_payload_for_key(workbook_key: str) -> Dict[str, Any]:
  """Mediazione eredita il template storico; le altre società partono vuote."""
  key = _normalize_workbook_key(workbook_key)
  entry = catalog_entry_for_key(key)
  title = str(entry.get("title") or f"FILE FORNITORI_{key.upper()}")
  if key == "mediazione_2026":
    payload = _load_default_payload()
    payload["title"] = title
    return payload
  return _empty_workbook_payload(title)


def _normalize_workbook_key(workbook_key: str) -> str:
  key = (workbook_key or DEFAULT_WORKBOOK_KEY).strip()
  # Alias legacy: il vecchio default era risacca ma i dati sono Mediazione
  if key in {"", "default", "fornitori"}:
    return DEFAULT_WORKBOOK_KEY
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
  migrate_legacy_risacca_workbook_to_mediazione(db)
  key = _normalize_workbook_key(workbook_key)
  row = db.query(SupplierPaymentsWorkbook).filter(SupplierPaymentsWorkbook.workbook_key == key).first()
  if row:
    return workbook_to_read(row)

  seed_payload = _seed_payload_for_key(key)
  title = str(seed_payload.get("title") or catalog_entry_for_key(key).get("title") or key)
  payload_json = json.dumps(seed_payload, ensure_ascii=False)
  row = SupplierPaymentsWorkbook(workbook_key=key, title=title, payload_json=payload_json)
  db.add(row)
  db.commit()
  db.refresh(row)
  return workbook_to_read(row, seeded=True)


def upsert_workbook(db: Session, payload: SupplierPaymentsWorkbookUpsert) -> SupplierPaymentsWorkbookRead:
  key = _normalize_workbook_key(payload.workbook_key)
  default_title = str(catalog_entry_for_key(key).get("title") or "FILE FORNITORI")
  body = {
      "title": (payload.title or default_title).strip() or default_title,
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


def delete_workbook(
  db: Session,
  workbook_key: str = DEFAULT_WORKBOOK_KEY,
  *,
  reseed: bool = True,
) -> Dict[str, Any]:
  """Elimina il file/registro pagamenti dal database. Opzionale: reinizializza dal template."""
  key = _normalize_workbook_key(workbook_key)
  row = db.query(SupplierPaymentsWorkbook).filter(SupplierPaymentsWorkbook.workbook_key == key).first()
  deleted = False
  if row:
    db.delete(row)
    db.commit()
    deleted = True
  if reseed:
    empty_payload = _empty_workbook_payload(catalog_entry_for_key(key).get("title"))
    title = str(empty_payload.get("title") or catalog_entry_for_key(key).get("title") or key)
    payload_json = json.dumps(empty_payload, ensure_ascii=False)
    row = SupplierPaymentsWorkbook(workbook_key=key, title=title, payload_json=payload_json)
    db.add(row)
    db.commit()
    db.refresh(row)
    seeded = workbook_to_read(row, seeded=True)
    return {
      "ok": True,
      "deleted": deleted,
      "reseeded": True,
      "workbook": seeded,
      "message": "Tutti i fogli eliminati: registro reinizializzato vuoto.",
    }
  return {
    "ok": True,
    "deleted": deleted,
    "reseeded": False,
    "message": "File eliminato dal database." if deleted else "Nessun file da eliminare.",
  }


_SPECIAL_SHEETS = frozenset({"TOTALI", "DELEGHE F24", "VERSAMENTO CONTANTI"})


def _strip_excel_quotes(value: Any) -> str:
  text = str(value or "").strip()
  if len(text) >= 2 and text.startswith("'") and text.endswith("'"):
    return text[1:-1].strip()
  return text


def _num_cell(value: Any) -> float:
  if value is None or value == "":
    return 0.0
  if isinstance(value, (int, float)):
    return float(value)
  text = str(value).strip().replace(".", "").replace(",", ".")
  try:
    return float(text)
  except ValueError:
    return 0.0


def _normalize_doc(value: Any) -> str:
  """Normalizza il n. documento tenendo i separatori (1/17 ≠ 117)."""
  text = _strip_excel_quotes(value).upper()
  text = re.sub(r"[^A-Z0-9]+", "/", text)
  return text.strip("/")


def _normalize_party(value: Any) -> str:
  return " ".join(_strip_excel_quotes(value).lower().split())


_NAME_STOPWORDS = frozenset(
  {
    "srl",
    "srls",
    "spa",
    "snc",
    "sas",
    "ss",
    "soc",
    "coop",
    "societa",
    "unipersonale",
    "di",
    "del",
    "della",
    "e",
    "the",
  }
)


def _name_tokens(value: Any) -> set:
  text = _normalize_party(value).replace("'", " ")
  toks = set()
  for part in text.split():
    if len(part) >= 4 and part not in _NAME_STOPWORDS:
      toks.add(part)
  return toks


def _names_overlap(left: Any, right: Any) -> bool:
  a = _normalize_party(left)
  b = _normalize_party(right)
  if not a or not b:
    return False
  if a == b or a in b or b in a:
    return True
  ta, tb = _name_tokens(a), _name_tokens(b)
  return bool(ta and tb and (ta & tb))


def list_paid_document_rows(
  db: Session,
  workbook_key: Optional[str] = None,
  *,
  company: Optional[str] = None,
  all_workbooks: bool = False,
) -> List[Dict[str, Any]]:
  """
  Righe del file Pagamenti con pagamento registrato
  (col. PAGATO DARE > 0) sui fogli mensili.
  Se company è valorizzata usa il file della società;
  se all_workbooks=True unisce tutti i file del catalogo.
  """
  keys: List[str]
  if all_workbooks:
    keys = [str(item["key"]) for item in WORKBOOK_CATALOG]
  elif workbook_key:
    keys = [_normalize_workbook_key(workbook_key)]
  elif company:
    keys = [workbook_key_for_company(company)]
  else:
    keys = [DEFAULT_WORKBOOK_KEY]

  paid: List[Dict[str, Any]] = []
  for key in keys:
    wb = get_workbook(db, key)
    for sheet in wb.sheets or []:
      name = str(getattr(sheet, "name", "") or "").strip().upper()
      if not name or name in _SPECIAL_SHEETS:
        continue
      rows = getattr(sheet, "rows", None) or []
      for idx, raw in enumerate(rows):
        if idx == 0 or not isinstance(raw, list):
          continue
        cells = list(raw) + [None] * max(0, 12 - len(raw))
        invoice_number = _strip_excel_quotes(cells[1])
        supplier_name = _strip_excel_quotes(cells[4])
        if not invoice_number and not supplier_name:
          continue
        if str(cells[6] or "").strip().upper() == "TOTALE":
          continue
        # Solo colonna « PAGATO (DARE)» = pagata. «PAGARE (AVERE)» = ancora da pagare.
        pagato = _num_cell(cells[8])
        if pagato <= 0.009:
          continue
        data_pag = cells[10]
        has_pay_date = bool(str(data_pag or "").strip())
        doc_norm = _normalize_doc(invoice_number)
        if not doc_norm and not _normalize_party(supplier_name):
          continue
        paid.append(
          {
            "workbook_key": key,
            "sheet": str(getattr(sheet, "name", "") or ""),
            "invoice_number": invoice_number,
            "invoice_number_norm": doc_norm,
            "supplier_vat": _strip_excel_quotes(cells[3]),
            "supplier_name": supplier_name,
            "supplier_name_norm": _normalize_party(supplier_name),
            "amount_paid": pagato,
            "payment_date": str(data_pag).strip() if has_pay_date else None,
            "row_index": idx,
          }
        )
  return paid


def find_paid_row_for_invoice(
  paid_rows: List[Dict[str, Any]],
  *,
  invoice_number: Optional[str] = None,
  supplier_name: Optional[str] = None,
  supplier_vat: Optional[str] = None,
  invoice_total: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
  """Abbina una fattura Atlas a una riga pagata del file Pagamenti.

  Match valido se stesso n. documento e almeno uno tra:
  - stesso fornitore (P.IVA o denominazione)
  - importo PAGATO (DARE) ≈ totale fattura (±0,05 €)

  Il solo numero non basta (i fornitori riutilizzano 125, 18, 274/2026, ecc.).
  """
  num_norm = _normalize_doc(invoice_number)
  name_norm = _normalize_party(supplier_name)
  vat_norm = _normalize_doc(supplier_vat)
  if not num_norm:
    return None

  try:
    total = float(invoice_total) if invoice_total is not None else None
  except (TypeError, ValueError):
    total = None

  best = None
  for row in paid_rows:
    if row.get("invoice_number_norm") != num_norm:
      continue
    score = 3
    if vat_norm and _normalize_doc(row.get("supplier_vat")) == vat_norm:
      score += 2
    if name_norm and _names_overlap(name_norm, row.get("supplier_name_norm")):
      score += 1
    pagato = float(row.get("amount_paid") or 0)
    if total is not None and total > 0.009 and abs(pagato - total) <= 0.05:
      score += 2
    if score < 4:
      continue
    if best is None or score > best[0]:
      best = (score, row)
  if best:
    return best[1]
  return None
