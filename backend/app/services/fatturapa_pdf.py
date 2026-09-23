"""PDF da FatturaPA: preferisce Allegati PDF embedded, altrimenti genera anteprima leggibile."""
from __future__ import annotations

import base64
import binascii
import re
import unicodedata
import xml.etree.ElementTree as ET
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import List, Optional, Tuple

from fpdf import FPDF
from fpdf.enums import Align, XPos, YPos, WrapMode

from ..integrations.sdi.invoice_document_parser import parse_fatturapa_document

_FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
_ATLAS_GREEN = (15, 81, 50)
_HEADER_BG = (232, 245, 238)
_ROW_ALT = (248, 250, 249)
_BORDER = (200, 210, 205)
_MUTED = (90, 100, 95)


def _safe_text(value: object) -> str:
  if value is None:
    return ""
  return str(value).replace("\r\n", "\n").replace("\r", "\n").strip()


def _plain_ascii(value: str) -> str:
  """Fallback senza punti interrogativi: toglie accenti, non sostituisce con '?'."""
  norm = unicodedata.normalize("NFKD", value or "")
  return "".join(c for c in norm if not unicodedata.combining(c) and ord(c) < 128) or "-"


def _fmt_money(value: object) -> str:
  if value is None:
    return "-"
  try:
    d = value if isinstance(value, Decimal) else Decimal(str(value))
    return f"{d.quantize(Decimal('0.01')):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
  except Exception:
    return str(value)


def _fmt_qty(value: object) -> str:
  if value is None:
    return "-"
  try:
    d = value if isinstance(value, Decimal) else Decimal(str(value))
    if d == d.to_integral_value():
      return str(int(d))
    return f"{d.quantize(Decimal('0.01'))}".replace(".", ",")
  except Exception:
    return str(value)


def _fmt_date(value: object) -> str:
  if value is None:
    return "-"
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


def _resolve_font_files() -> Tuple[Optional[Path], Optional[Path]]:
  candidates_regular = [
    _FONTS_DIR / "Roboto-Regular.ttf",
    _FONTS_DIR / "DejaVuSans.ttf",
    Path(r"C:\Windows\Fonts\arial.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
  ]
  candidates_bold = [
    _FONTS_DIR / "Roboto-Bold.ttf",
    _FONTS_DIR / "DejaVuSans-Bold.ttf",
    Path(r"C:\Windows\Fonts\arialbd.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
  ]
  regular = next((p for p in candidates_regular if p.is_file()), None)
  bold = next((p for p in candidates_bold if p.is_file()), None)
  return regular, bold


class _InvoicePreviewPDF(FPDF):
  """Anteprima fattura con font Unicode (niente '?' su accenti)."""

  def __init__(self) -> None:
    super().__init__()
    self._family = "helvetica"
    self._unicode = False
    regular, bold = _resolve_font_files()
    if regular:
      try:
        self.add_font("AtlasSans", "", str(regular))
        if bold:
          self.add_font("AtlasSans", "B", str(bold))
        else:
          self.add_font("AtlasSans", "B", str(regular))
        self._family = "AtlasSans"
        self._unicode = True
      except Exception:
        self._family = "helvetica"
        self._unicode = False

  def set_style(self, bold: bool = False, size: float = 10) -> None:
    self.set_font(self._family, "B" if bold else "", size)

  def draw_text(self, text: str, *, bold: bool = False, size: float = 10, h: float = 5.5) -> None:
    self.set_style(bold=bold, size=size)
    txt = _safe_text(text) or " "
    if not self._unicode:
      txt = _plain_ascii(txt) or "-"
    try:
      self.multi_cell(0, h, txt, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    except Exception:
      safe = _plain_ascii(txt) or "-"
      self.set_font("helvetica", "B" if bold else "", size)
      self.multi_cell(0, h, safe, wrapmode=WrapMode.CHAR, new_x=XPos.LMARGIN, new_y=YPos.NEXT)


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
      if not nome_l.endswith(".pdf"):
        continue
    try:
      cleaned = re.sub(r"\s+", "", raw_b64)
      data = base64.b64decode(cleaned, validate=False)
    except (binascii.Error, ValueError):
      continue
    if _looks_like_pdf(data):
      return data
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
  """Genera un PDF di anteprima chiaro dai campi FatturaPA (quando non c'è allegato)."""
  doc = parse_fatturapa_document(xml_text)
  supplier = doc.get("supplier") or {}
  customer = doc.get("customer") or {}
  document = doc.get("document") or {}
  lines = doc.get("lines") or []
  vat_summary = doc.get("vat_summary") or doc.get("vatSummary") or []

  pdf = _InvoicePreviewPDF()
  pdf.set_auto_page_break(auto=True, margin=16)
  pdf.set_margins(14, 14, 14)
  pdf.add_page()
  page_w = pdf.epw

  # Intestazione
  pdf.set_fill_color(*_ATLAS_GREEN)
  pdf.rect(14, 14, page_w, 18, style="F")
  pdf.set_text_color(255, 255, 255)
  pdf.set_xy(16, 16)
  pdf.set_style(bold=True, size=14)
  title = "Fattura elettronica — anteprima Atlas"
  if not pdf._unicode:
    title = "Fattura elettronica - anteprima Atlas"
  pdf.cell(page_w - 4, 8, title if pdf._unicode else _plain_ascii(title), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
  pdf.set_xy(16, 24)
  pdf.set_style(size=9)
  meta = (
    f"Tipo {document.get('type') or '-'}   ·   "
    f"N. {document.get('number') or '-'}   ·   "
    f"Data {_fmt_date(document.get('date'))}   ·   "
    f"{document.get('currency') or 'EUR'}"
  )
  pdf.cell(page_w - 4, 5, meta if pdf._unicode else _plain_ascii(meta), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
  pdf.set_text_color(0, 0, 0)
  pdf.set_y(36)

  # Due riquadri: fornitore / destinatario
  box_w = (page_w - 4) / 2
  box_h = 28
  y0 = pdf.get_y()

  def _party_box(x: float, title_label: str, name: str, vat_line: str) -> None:
    pdf.set_xy(x, y0)
    pdf.set_fill_color(*_HEADER_BG)
    pdf.set_draw_color(*_BORDER)
    pdf.rect(x, y0, box_w, box_h, style="FD")
    pdf.set_xy(x + 2, y0 + 2)
    pdf.set_text_color(*_MUTED)
    pdf.set_style(bold=True, size=8)
    pdf.cell(box_w - 4, 4, title_label if pdf._unicode else _plain_ascii(title_label))
    pdf.set_text_color(0, 0, 0)
    pdf.set_xy(x + 2, y0 + 8)
    pdf.set_style(bold=True, size=10)
    name_txt = _safe_text(name) or "-"
    if not pdf._unicode:
      name_txt = _plain_ascii(name_txt)
    pdf.multi_cell(box_w - 4, 5, name_txt, new_x=XPos.LEFT, new_y=YPos.NEXT)
    pdf.set_x(x + 2)
    pdf.set_style(size=9)
    vat_txt = _safe_text(vat_line) or "-"
    if not pdf._unicode:
      vat_txt = _plain_ascii(vat_txt)
    pdf.multi_cell(box_w - 4, 4.5, vat_txt, new_x=XPos.LMARGIN, new_y=YPos.NEXT)

  supplier_vat = supplier.get("vat") or supplier.get("fiscalCode") or "-"
  customer_vat = customer.get("vat") or "-"
  _party_box(14, "FORNITORE (cedente)", supplier.get("name") or "-", f"P.IVA / CF: {supplier_vat}")
  _party_box(14 + box_w + 4, "DESTINATARIO (cessionario)", customer.get("name") or "-", f"P.IVA: {customer_vat}")
  pdf.set_y(y0 + box_h + 8)

  # Tabella righe
  pdf.set_style(bold=True, size=11)
  pdf.set_text_color(*_ATLAS_GREEN)
  pdf.draw_text("Dettaglio beni / servizi", bold=True, size=11, h=6)
  pdf.set_text_color(0, 0, 0)

  cols = [
    ("N.", 10, Align.C),
    ("Descrizione", page_w - 10 - 22 - 28 - 28 - 18, Align.L),
    ("Q.ta", 22, Align.R),
    ("Prezzo", 28, Align.R),
    ("Totale", 28, Align.R),
    ("IVA%", 18, Align.R),
  ]

  def _row(cells: List[str], *, header: bool = False, alt: bool = False) -> None:
    if pdf.get_y() > pdf.h - 30:
      pdf.add_page()
    h = 7 if header else 6.5
    x0 = pdf.l_margin
    pdf.set_x(x0)
    if header:
      pdf.set_fill_color(*_ATLAS_GREEN)
      pdf.set_text_color(255, 255, 255)
      pdf.set_style(bold=True, size=8)
    else:
      pdf.set_fill_color(*(_ROW_ALT if alt else (255, 255, 255)))
      pdf.set_text_color(0, 0, 0)
      pdf.set_style(size=8)
    pdf.set_draw_color(*_BORDER)
    y = pdf.get_y()
    # Altezza riga in base alla descrizione
    desc = cells[1] if len(cells) > 1 else ""
    if not pdf._unicode:
      desc = _plain_ascii(desc)
    pdf.set_xy(x0 + cols[0][1], y)
    # stima righe descrizione
    max_desc_w = cols[1][1]
    pdf.set_style(bold=header, size=8)
    # usa cell fisse; descrizione con multi_cell interno
    row_h = h
    # draw background
    pdf.rect(x0, y, page_w, row_h, style="FD")
    cx = x0
    for i, ((_, w, align), raw) in enumerate(zip(cols, cells)):
      txt = _safe_text(raw) or "-"
      if not pdf._unicode:
        txt = _plain_ascii(txt) or "-"
      # tronca descrizione molto lunga su una riga
      if i == 1 and len(txt) > 70:
        txt = txt[:67] + "..."
      pdf.set_xy(cx, y + 1)
      pdf.cell(w, row_h - 2, txt, align=align)
      cx += w
    pdf.set_y(y + row_h)

  _row(["N.", "Descrizione", "Q.ta", "Prezzo EUR", "Totale EUR", "IVA%"], header=True)
  if not lines:
    _row(["-", "(nessuna riga dettaglio)", "-", "-", "-", "-"], alt=False)
  else:
    for idx, row in enumerate(lines[:100]):
      vat = row.get("vatRate")
      vat_s = "-" if vat is None else f"{_fmt_qty(vat)}"
      _row(
        [
          str(row.get("lineNumber") or idx + 1),
          row.get("description") or "-",
          _fmt_qty(row.get("quantity")),
          _fmt_money(row.get("unitPrice")),
          _fmt_money(row.get("lineTotal")),
          vat_s,
        ],
        alt=idx % 2 == 1,
      )
    if len(lines) > 100:
      pdf.draw_text(f"... altre {len(lines) - 100} righe omesse", size=8, h=5)

  pdf.ln(4)

  # Riepilogo IVA + totali
  left_w = page_w * 0.55
  right_w = page_w - left_w - 2
  y_sum = pdf.get_y()

  pdf.set_xy(pdf.l_margin, y_sum)
  pdf.set_text_color(*_ATLAS_GREEN)
  pdf.draw_text("Riepilogo IVA", bold=True, size=10, h=5.5)
  pdf.set_text_color(0, 0, 0)
  if not vat_summary:
    pdf.draw_text("Nessun riepilogo IVA nell'XML", size=9)
  else:
    for row in vat_summary:
      rate = row.get("vatRate")
      rate_s = "-" if rate is None else f"{_fmt_qty(rate)}%"
      pdf.draw_text(
        f"Aliquota {rate_s}   Imponibile EUR {_fmt_money(row.get('taxableAmount'))}   "
        f"IVA EUR {_fmt_money(row.get('vatAmount'))}",
        size=9,
        h=5,
      )

  # Box totali a destra
  box_x = pdf.l_margin + left_w + 2
  box_y = y_sum
  pdf.set_fill_color(*_HEADER_BG)
  pdf.set_draw_color(*_ATLAS_GREEN)
  pdf.rect(box_x, box_y, right_w, 32, style="FD")
  pdf.set_xy(box_x + 3, box_y + 3)
  pdf.set_style(bold=True, size=8)
  pdf.set_text_color(*_MUTED)
  pdf.cell(right_w - 6, 4, "TOTALI", new_x=XPos.LEFT, new_y=YPos.NEXT)
  pdf.set_x(box_x + 3)
  pdf.set_text_color(0, 0, 0)
  pdf.set_style(size=9)
  pdf.cell(right_w - 6, 5, f"Imponibile   EUR {_fmt_money(doc.get('taxableAmount'))}", new_x=XPos.LEFT, new_y=YPos.NEXT)
  pdf.set_x(box_x + 3)
  pdf.cell(right_w - 6, 5, f"IVA             EUR {_fmt_money(doc.get('vatAmount'))}", new_x=XPos.LEFT, new_y=YPos.NEXT)
  pdf.set_x(box_x + 3)
  pdf.set_style(bold=True, size=11)
  pdf.set_text_color(*_ATLAS_GREEN)
  total_txt = f"Totale   EUR {_fmt_money(document.get('total'))}"
  pdf.cell(right_w - 6, 7, total_txt if pdf._unicode else _plain_ascii(total_txt), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

  pdf.set_text_color(*_MUTED)
  pdf.set_y(max(pdf.get_y(), box_y + 36))
  pdf.ln(2)
  pdf.draw_text(
    "Anteprima generata dall'XML FatturaPA (nessun PDF allegato nel file originale).",
    size=8,
    h=4.5,
  )

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
  try:
    text = raw.decode("utf-8")
  except UnicodeDecodeError:
    try:
      text = raw.decode("latin-1")
    except Exception:
      text = ""
  if text and "<FatturaElettronica" in text:
    return text
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
