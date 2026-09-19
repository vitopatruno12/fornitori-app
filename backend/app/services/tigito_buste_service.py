"""Estrazione cedolini TeamSystem / Tigito (PDF multi-pagina, spesso protetti da P.IVA)."""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

CF_RE = re.compile(r"\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b")
HEADER_RE = re.compile(
  r"(GENNAIO|FEBBRAIO|MARZO|APRILE|MAGGIO|GIUGNO|LUGLIO|AGOSTO|SETTEMBRE|OTTOBRE|NOVEMBRE|DICEMBRE)"
  r"\s+(\d{4})\s+\d+\s+\d+\s+"
  r"(?:\S+\s+){1,2}"
  r"(\d+)\s+(.+?)\s+(\d{2}/\d{2}/\d{2})\s*$"
)
MONEY_RE = re.compile(r"^\d{1,3}(?:\.\d{3})*,\d{2}$")
MONTHS = {
  "GENNAIO": 1,
  "FEBBRAIO": 2,
  "MARZO": 3,
  "APRILE": 4,
  "MAGGIO": 5,
  "GIUGNO": 6,
  "LUGLIO": 7,
  "AGOSTO": 8,
  "SETTEMBRE": 9,
  "OTTOBRE": 10,
  "NOVEMBRE": 11,
  "DICEMBRE": 12,
}

# Password tipiche = P.IVA società
KNOWN_VAT_PASSWORDS = (
  "04945600759",  # Mediazione
  "04886500752",  # Via Lattea
  "05186540752",  # Risacca
  "05440050754",  # PG
)

# Prefisso file Tigito (es. PG02180000826.PDF) → società
TIGITO_FILE_PREFIX_COMPANY: Tuple[Tuple[str, str, str], ...] = (
  ("PG0218", "Mediazione", "04945600759"),
  ("PG0216", "Via Lattea", "04886500752"),
)

COMPANY_BY_VAT = {
  "04945600759": "Mediazione",
  "04886500752": "Via Lattea",
  "05186540752": "Risacca",
  "05440050754": "PG",
}


def resolve_company_from_filename(filename: Optional[str]) -> Optional[Dict[str, str]]:
  """
  Riconosce la società dal nome file Tigito.
  PG02180000826.PDF → Mediazione; PG02160000826.PDF → Via Lattea.
  """
  raw = str(filename or "").strip()
  if not raw:
    return None
  base = raw.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
  up = base.upper().replace(" ", "")
  for prefix, short, vat in TIGITO_FILE_PREFIX_COMPANY:
    if up.startswith(prefix.upper()):
      return {"short_label": short, "vat": vat, "source": "filename", "filename": base}
  # Match anche se il prefisso compare nel nome (es. copia "PG0218… (1).PDF")
  for prefix, short, vat in TIGITO_FILE_PREFIX_COMPANY:
    if prefix.upper() in up:
      return {"short_label": short, "vat": vat, "source": "filename", "filename": base}
  return None


def resolve_company_from_vat(vat: Optional[str]) -> Optional[Dict[str, str]]:
  norm = re.sub(r"\D", "", str(vat or ""))
  short = COMPANY_BY_VAT.get(norm)
  if not short:
    return None
  return {"short_label": short, "vat": norm, "source": "vat"}


def money_to_float(s: str) -> Optional[float]:
  try:
    return float(s.replace(".", "").replace(",", "."))
  except Exception:
    return None


def split_cognome_nome(full: str) -> Tuple[str, str]:
  """Cedolini Tigito: COGNOME NOME (a volte più token nel cognome)."""
  parts = [p for p in str(full or "").strip().split() if p]
  if not parts:
    return "", ""
  if len(parts) == 1:
    return "", parts[0]
  # Ultimo token = nome; resto = cognome (es. DE ROBERTIS EMANUELA CHIARA → cognome DE ROBERTIS, nome EMANUELA CHIARA)
  if len(parts) >= 3 and parts[0].upper() in {"DE", "DI", "DEL", "DELLA", "DEI", "DEGLI", "LA", "LO"}:
    return " ".join(parts[:-1]), parts[-1]
  return parts[0], " ".join(parts[1:])


def parse_birth_it(raw: Optional[str]) -> Optional[date]:
  if not raw:
    return None
  s = str(raw).strip()
  m = re.match(r"^(\d{2})/(\d{2})/(\d{2})$", s)
  if m:
    dd, mm, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
    year = 1900 + yy if yy >= 30 else 2000 + yy
    try:
      return date(year, mm, dd)
    except ValueError:
      return None
  m4 = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", s)
  if m4:
    try:
      return date(int(m4.group(3)), int(m4.group(2)), int(m4.group(1)))
    except ValueError:
      return None
  return None


def _open_pdf(raw: bytes, password: Optional[str] = None):
  try:
    import fitz  # pymupdf
  except ImportError as e:
    raise RuntimeError(
      "Modulo pymupdf non installato sul server. Esegui: pip install pymupdf"
    ) from e

  doc = fitz.open(stream=raw, filetype="pdf")
  if doc.needs_pass:
    candidates = []
    pwd = str(password or "").strip()
    if pwd:
      candidates.append(pwd)
    candidates.extend(KNOWN_VAT_PASSWORDS)
    ok = False
    for cand in candidates:
      try:
        if doc.authenticate(cand):
          ok = True
          break
      except Exception:
        continue
    if not ok:
      doc.close()
      raise ValueError(
        "PDF protetto: password errata. Usa la P.IVA della società (es. 04945600759 Mediazione)."
      )
  return doc


def extract_employees_from_tigito_pdf(
  raw: bytes,
  *,
  password: Optional[str] = None,
) -> List[Dict[str, Any]]:
  """Una riga per pagina cedolino con nome, CF, netto, mese."""
  doc = _open_pdf(raw, password)
  employees: List[Dict[str, Any]] = []
  try:
    for i in range(doc.page_count):
      page = doc.load_page(i)
      words = page.get_text("words")
      lines: Dict[float, list] = {}
      for w in words:
        y = round(w[1], 0)
        lines.setdefault(y, []).append((w[0], w[4]))
      ordered = [(y, " ".join(t for _, t in sorted(rows))) for y, rows in sorted(lines.items())]

      name = cf = birth = month = year = codice = qualifica = None
      for _, txt in ordered:
        m = HEADER_RE.search(txt)
        if m:
          month, year, codice, name, _hire = (
            m.group(1),
            m.group(2),
            m.group(3),
            m.group(4).strip(),
            m.group(5),
          )
        m2 = CF_RE.search(txt)
        if m2 and re.search(r"\d{2}/\d{2}/\d{2}", txt):
          cf = m2.group(1)
          dates = re.findall(r"\d{2}/\d{2}/\d{2}", txt)
          if dates:
            birth = dates[0]
        if re.match(r"^[\d\.,]+\s+\S+", txt) and any(
          k in txt
          for k in (
            "Add.",
            "Inserviente",
            "Casaro",
            "Vendita",
            "Banco",
            "Cucina",
            "Forno",
            "Interm",
            "Apprend",
            "Operaio",
            "Impieg",
            "Prod",
            "Cuoco",
            "Pizzaiolo",
          )
        ):
          qualifica = txt

      netto = None
      netto_candidates = []
      for w in words:
        if w[4].upper() == "NETTO" or w[4].upper().startswith("NETTO"):
          for w2 in words:
            if abs(w2[1] - w[1]) < 10 and w2[0] > w[0] and MONEY_RE.match(w2[4]):
              netto_candidates.append(w2[4])
      if netto_candidates:
        netto = money_to_float(netto_candidates[-1])

      if not name:
        continue

      last_name, first_name = split_cognome_nome(name)
      ym = f"{year}-{MONTHS.get(month, 0):02d}" if year and month else None
      employees.append(
        {
          "page_index": i,
          "page": i + 1,
          "full_name": name,
          "first_name": first_name,
          "last_name": last_name,
          "codice_fiscale": cf,
          "birth_date": birth,
          "birth_date_iso": parse_birth_it(birth).isoformat() if parse_birth_it(birth) else None,
          "employee_code": codice,
          "qualifica": qualifica,
          "netto": netto,
          "year_month": ym,
          "month_label": f"{month} {year}" if month else None,
        }
      )
  finally:
    doc.close()
  return employees


def export_single_page_pdf(raw: bytes, page_index: int, *, password: Optional[str] = None) -> bytes:
  """Estrae una sola pagina come PDF (per associare 1 busta = 1 dipendente)."""
  import fitz

  doc = _open_pdf(raw, password)
  out = None
  try:
    if page_index < 0 or page_index >= doc.page_count:
      raise ValueError(f"Pagina {page_index + 1} non valida")
    out = fitz.open()
    out.insert_pdf(doc, from_page=page_index, to_page=page_index)
    return out.tobytes()
  finally:
    if out is not None:
      out.close()
    doc.close()
