"""Estrae dipendenti e netto da cedolini TeamSystem (Tigito) protetti da P.IVA."""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import fitz  # pymupdf

CF_RE = re.compile(r"\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b")
HEADER_RE = re.compile(
  r"(GENNAIO|FEBBRAIO|MARZO|APRILE|MAGGIO|GIUGNO|LUGLIO|AGOSTO|SETTEMBRE|OTTOBRE|NOVEMBRE|DICEMBRE)"
  r"\s+(\d{4})\s+\d+\s+\d+\s+"
  r"(?:\S+\s+){1,2}"  # matricola INPS (+ eventuale posizione INAIL)
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

# Mapping P.IVA società → locali Personale Atlas (nomi tipici pack)
COMPANY_LOCALES = {
  "04945600759": {
    "company": "La Mediazione S.r.l.",
    "locales": [
      "Mediazione via abba",
      "Mediazione via zanardelli",
    ],
    "default_locale_by_address": {
      "ABBA": "Mediazione via abba",
      "ZANARDELLI": "Mediazione via zanardelli",
    },
  },
  "04886500752": {
    "company": "La Via Lattea Società Agricola",
    "locales": ["Mucche Volanti", "La Via Lattea"],
    "default_locale_by_address": {
      "ABBA": "Mucche Volanti",
      "LATTEA": "Mucche Volanti",
    },
  },
}


def money_to_float(s: str):
  try:
    return float(s.replace(".", "").replace(",", "."))
  except Exception:
    return None


def parse_pdf(path: str, pwd: str, company_vat: str) -> list[dict]:
  meta = COMPANY_LOCALES.get(company_vat, {})
  company_label = meta.get("company") or company_vat
  doc = fitz.open(path)
  if doc.needs_pass:
    if not doc.authenticate(pwd):
      raise RuntimeError(f"Password errata per {path}")

  employees: list[dict] = []
  for i in range(doc.page_count):
    page = doc.load_page(i)
    words = page.get_text("words")
    lines: dict[float, list] = {}
    for w in words:
      y = round(w[1], 0)
      lines.setdefault(y, []).append((w[0], w[4]))
    ordered = [(y, " ".join(t for _, t in sorted(rows))) for y, rows in sorted(lines.items())]

    ditta = ""
    addr = ""
    for _, txt in ordered:
      up = txt.upper()
      if ("MEDIAZIONE" in up or "LATTEA" in up) and ("S.R.L" in up or "SOCIETA" in up or "SOCIETÀ" in up):
        ditta = txt.strip()
      if "VIA " in up and ("LECCE" in up or "ABBA" in up or "ZANARDELLI" in up) and "COD.FISCALE" not in up:
        addr = txt.strip()

    name = cf = birth = hire = month = year = codice = qualifica = residence = None
    for _, txt in ordered:
      m = HEADER_RE.search(txt)
      if m:
        month, year, codice, name, hire = m.group(1), m.group(2), m.group(3), m.group(4).strip(), m.group(5)
      m2 = CF_RE.search(txt)
      if m2 and re.search(r"\d{2}/\d{2}/\d{2}", txt):
        cf = m2.group(1)
        dates = re.findall(r"\d{2}/\d{2}/\d{2}", txt)
        if dates:
          birth = dates[0]
        mid = txt[m2.end() :].strip()
        residence = re.split(r"\d{2}/\d{2}/\d{2}", mid)[0].strip() or None
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

    tfr_mese = None
    for idx, w in enumerate(words):
      if w[4].upper() == "TFR" and idx + 1 < len(words) and words[idx + 1][4].upper() == "MESE":
        for w2 in words:
          if w2[1] > w[1] and w2[1] < w[1] + 45 and abs(w2[0] - w[0]) < 100 and MONEY_RE.match(w2[4]):
            tfr_mese = money_to_float(w2[4])
            break

    if not name:
      continue

    locale_hint = None
    addr_up = (addr or "").upper()
    for key, loc in (meta.get("default_locale_by_address") or {}).items():
      if key in addr_up or key in (ditta or "").upper():
        locale_hint = loc
        break
    if not locale_hint and meta.get("locales"):
      locale_hint = meta["locales"][0]

    ym = f"{year}-{MONTHS.get(month, 0):02d}" if year and month else None
    employees.append(
      {
        "company": company_label,
        "company_vat": company_vat,
        "ditta": ditta,
        "address": addr,
        "suggested_locale": locale_hint,
        "available_locales": meta.get("locales") or [],
        "page": i + 1,
        "year_month": ym,
        "month_label": f"{month} {year}" if month else None,
        "employee_code": codice,
        "name": name,
        "hire_date": hire,
        "codice_fiscale": cf,
        "birth_date": birth,
        "residence": residence,
        "qualifica": qualifica,
        "netto": netto,
        "tfr_mese": tfr_mese,
        "source_file": Path(path).name,
      }
    )
  doc.close()
  return employees


def main():
  files = [
    (r"C:\Users\vpatr\Downloads\PG02180000826 (1).PDF", "04945600759"),
    (r"C:\Users\vpatr\Downloads\PG02160000826.PDF", "04886500752"),
  ]
  out_dir = Path(__file__).resolve().parent.parent / "uploads" / "buste_extract"
  out_dir.mkdir(parents=True, exist_ok=True)

  all_emp: list[dict] = []
  for path, vat in files:
    all_emp.extend(parse_pdf(path, vat, vat))

  (out_dir / "employees.json").write_text(json.dumps(all_emp, ensure_ascii=False, indent=2), encoding="utf-8")
  print("total", len(all_emp))
  print("by company", Counter(e["company"] for e in all_emp))
  print("by locale hint", Counter(e["suggested_locale"] for e in all_emp))
  for e in all_emp:
    print(
      f"{e['company_vat']} | {e['year_month']} | {e['suggested_locale'] or '-':22} | "
      f"{e['name']:28} | CF {e['codice_fiscale'] or '-':16} | netto={e['netto']}"
    )


if __name__ == "__main__":
  main()
