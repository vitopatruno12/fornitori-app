"""PDF da FatturaPA: preferisce Allegati PDF embedded, altrimenti genera anteprima leggibile."""
from __future__ import annotations

import base64
import binascii
import re
import xml.etree.ElementTree as ET
from decimal import Decimal
from io import BytesIO
from typing import List, Optional, Tuple

from fpdf import FPDF
from fpdf.enums import WrapMode, XPos, YPos

from ..integrations.sdi.invoice_document_parser import parse_fatturapa_document


def _safe_text(value: object) -> str:
  if value is None:
    return ""
  return str(value).replace("\r\n", "\n").replace("\r", "\n")


def _fmt_money(value: object) -> str:
  if value is None:
    return "—"
  try:
    d = value if isinstance(value, Decimal) else Decimal(str(value))
    return f"{d.quantize(Decimal('0.01'))}".replace(".", ",")
  except Exception:
    return str(value)


def _fmt_date(value: object) -> str:
  if value is None:
    return "—"
  if hasattr(value, "strftime"):
    try:
      return value.strftime("%d/%m/%Y")
    except Exception:
      pass
  s = str(value).strip()
  if len(s) >= 10 and s[4] == "-" and s[7] == "-":
    return f"{s[8:10]}/{s[5:7]}/{s[0:4]}"
  return s


def _looks_like_pdf(data: bytes) -> bool:
  return bool(data) and data[:5] == b"%PDF-"


def extract_embedded_pdf(xml_text: str) -> Optional[bytes]:
  """Estrae il primo allegato PDF (o PDF compresso) dall'XML FatturaPA."""
  if not xml_text or "<" not in xml_text:
    return None
  try:
    root = ET.fromstring(xml_text)
  except Exception:
    return None

  for node in root.findall(".//{*}Allegati"):
    formato = (
      (node.findtext("{*}FormatoAttachment") or node.findtext(".//{*}FormatoAttachment") or "")
      .strip()
      .upper()
    )
    nome = (node.findtext("{*}NomeAttachment") or node.findtext(".//{*}NomeAttachment") or "").strip()
    raw_b64 = (node.findtext("{*}Attachment") or node.findtext(".//{*}Attachment") or "").strip()
    if not raw_b64:
      continue
    nome_l = nome.lower()
    is_pdf = (
      "PDF" in formato
      or nome_l.endswith(".pdf")
      or formato in {"", "PDF", "APPLICATION/PDF"}
    )
    if not is_pdf and formato not in {"ZIP", "ASICE", "P7M"}:
      # Se non è chiaro, prova comunque a decodificare: molti XML omettono il formato
      if not nome_l.endswith(".pdf"):
        continue
    try:
      cleaned = re.sub(r"\s+", "", raw_b64)
      data = base64.b64decode(cleaned, validate=False)
    except (binascii.Error, ValueError):
      continue
    if _looks_like_pdf(data):
      return data
    # ZIP con PDF dentro (raro ma presente in alcuni intermediari)
    if data[:2] == b"PK":
      try:
        import zipfile

        with zipfile.ZipFile(BytesIO(data)) as zf:
          for info in zf.infolist():
            if info.filename.lower().endswith(".pdf"):
              inner = zf.read(info)
              if _looks_like_pdf(inner):
                return inner
      except Exception:
        continue
  return None


def build_fatturapa_preview_pdf(xml_text: str) -> bytes:
  """Genera un PDF di anteprima dai campi FatturaPA (quando non c'è allegato)."""
  doc = parse_fatturapa_document(xml_text)
  supplier = doc.get("supplier") or {}
  customer = doc.get("customer") or {}
  document = doc.get("document") or {}
  lines = doc.get("lines") or []
  vat_summary = doc.get("vatSummary") or []

  pdf = FPDF()
  pdf.set_auto_page_break(auto=True, margin=14)
  pdf.add_page()
  pdf.set_font("helvetica", "B", 14)
  mc = {"new_x": XPos.LMARGIN, "new_y": YPos.NEXT}

  def write(text: str, bold: bool = False, size: int = 10) -> None:
    pdf.set_font("helvetica", "B" if bold else "", size)
    txt = _safe_text(text) or " "
    try:
      pdf.multi_cell(0, 6, txt, **mc)
    except Exception:
      safe = txt.encode("latin-1", "replace").decode("latin-1") or " "
      try:
        pdf.multi_cell(0, 6, safe, wrapmode=WrapMode.CHAR, **mc)
      except Exception:
        pdf.multi_cell(
          0,
          6,
          safe.encode("ascii", "replace").decode("ascii"),
          wrapmode=WrapMode.CHAR,
          **mc,
        )

  write("Fattura elettronica (anteprima Atlas)", bold=True, size=13)
  write(
    f"Tipo: {document.get('type') or '—'}  ·  N. {document.get('number') or '—'}  ·  "
    f"Data {_fmt_date(document.get('date'))}  ·  {document.get('currency') or 'EUR'}"
  )
  write("")
  write("Cedente / fornitore", bold=True)
  write(f"{supplier.get('name') or '—'}")
  write(f"P.IVA / CF: {supplier.get('vat') or supplier.get('fiscalCode') or '—'}")
  write("")
  write("Cessionario / destinatario", bold=True)
  write(f"{customer.get('name') or '—'}")
  write(f"P.IVA: {customer.get('vat') or '—'}")
  write("")
  write("Righe", bold=True)
  if not lines:
    write("(nessuna riga dettaglio)")
  else:
    for row in lines[:80]:
      qty = row.get("quantity")
      price = row.get("unitPrice")
      total = row.get("lineTotal")
      vat = row.get("vatRate")
      desc = row.get("description") or "—"
      write(
        f"{row.get('lineNumber') or '·'}. {desc}  |  "
        f"qta {qty if qty is not None else '—'}  ·  "
        f"€ {_fmt_money(price)}  ·  tot € {_fmt_money(total)}  ·  IVA {vat if vat is not None else '—'}%"
      )
    if len(lines) > 80:
      write(f"... altre {len(lines) - 80} righe omesse")

  write("")
  write("Riepilogo IVA", bold=True)
  for row in vat_summary:
    write(
      f"Aliquota {row.get('vatRate') if row.get('vatRate') is not None else '—'}%  ·  "
      f"Imponibile € {_fmt_money(row.get('taxableAmount'))}  ·  "
      f"IVA € {_fmt_money(row.get('vatAmount'))}"
    )
  write("")
  write(f"Imponibile totale: € {_fmt_money(doc.get('taxableAmount'))}", bold=True)
  write(f"IVA totale: € {_fmt_money(doc.get('vatAmount'))}", bold=True)
  write(f"Totale documento: € {_fmt_money(document.get('total'))}", bold=True, size=11)
  write("")
  write("Nota: anteprima generata dall'XML FatturaPA (nessun PDF allegato nel file).", size=8)

  out = pdf.output(dest="S")
  if isinstance(out, str):
    return out.encode("latin-1", "replace")
  return bytes(out)


def build_fatturapa_pdf_bytes(xml_text: str) -> Tuple[bytes, str]:
  """
  Restituisce (pdf_bytes, source) dove source è 'attachment' o 'preview'.
  """
  embedded = extract_embedded_pdf(xml_text)
  if embedded:
    return embedded, "attachment"
  return build_fatturapa_preview_pdf(xml_text), "preview"


def unwrap_p7m_to_xml_text(raw: bytes) -> Optional[str]:
  """Best-effort: se il file è XML plain o contiene XML FatturaPA, restituisce testo."""
  if not raw:
    return None
  # XML plain
  try:
    text = raw.decode("utf-8")
  except UnicodeDecodeError:
    try:
      text = raw.decode("latin-1")
    except Exception:
      text = ""
  if text and "<FatturaElettronica" in text:
    return text
  # A volte il payload DER contiene l'XML come sottostringa
  try:
    as_latin = raw.decode("latin-1", errors="ignore")
  except Exception:
    as_latin = ""
  start = as_latin.find("<?xml")
  if start < 0:
    start = as_latin.find("<FatturaElettronica")
  if start >= 0:
    end = as_latin.rfind("</p:FatturaElettronica>")
    if end < 0:
      end = as_latin.rfind("</FatturaElettronica>")
    if end > start:
      chunk = as_latin[start : end + len("</FatturaElettronica>")]
      if "<FatturaElettronica" in chunk:
        return chunk
  return text if text and "<FatturaElettronica" in text else None
