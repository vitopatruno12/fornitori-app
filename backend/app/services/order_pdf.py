"""PDF ordine fornitore (fpdf2)."""
from io import BytesIO
from typing import List

from fpdf import FPDF
from fpdf.enums import WrapMode, XPos, YPos

from ..schemas.supplier_order import SupplierOrderRead


def _safe_line(s: str) -> str:
  if not s:
    return ""
  return str(s).replace("\r\n", "\n").replace("\r", "\n")


def build_order_pdf_bytes(order: SupplierOrderRead) -> bytes:
  pdf = FPDF()
  pdf.set_auto_page_break(auto=True, margin=15)
  pdf.add_page()
  pdf.set_font("helvetica", "B", 14)
  pdf.cell(0, 10, "Ordine fornitore", ln=True)
  pdf.set_font("helvetica", size=11)
  lines: List[str] = [
    f"N. ordine: #{order.id}",
    f"Fornitore: {order.supplier_name or '-'}",
    f"Data ordine: {order.order_date}",
  ]
  if order.expected_delivery_date:
    lines.append(f"Consegna prevista: {order.expected_delivery_date}")
  lines.append(f"IVA %: {order.vat_percent}")
  lines.append(f"Stato: {order.status}")
  lines.append("")
  lines.append("Righe merce:")
  for it in order.items or []:
    row = f" - {it.product_description}"
    if it.pieces is not None:
      row += f" | {it.pieces} pz"
    if it.weight_kg is not None:
      row += f" | {it.weight_kg} kg"
    if it.note:
      row += f" | {it.note}"
    lines.append(row)
  lines.append("")
  if order.note:
    lines.append("Note al fornitore:")
    lines.extend(_safe_line(order.note).split("\n"))
  if order.note_internal:
    lines.append("")
    lines.append("Note interne (non inviate al fornitore):")
    lines.extend(_safe_line(order.note_internal).split("\n"))
  if order.merchandise_summary:
    lines.append("")
    lines.append(f"Riepilogo: {order.merchandise_summary}")

  # Dopo multi_cell fpdf2 lascia X a destra (default new_x=RIGHT): la riga successiva con w=0
  # calcola larghezza ~0 e genera "Not enough horizontal space to render a single character".
  mc_kwargs = {"new_x": XPos.LMARGIN, "new_y": YPos.NEXT}
  for line in lines:
    txt = _safe_line(line) if line else " "
    if not txt.strip():
      txt = " "
    try:
      pdf.multi_cell(0, 7, txt, **mc_kwargs)
    except Exception:
      safe = txt.encode("latin-1", "replace").decode("latin-1") or " "
      try:
        pdf.multi_cell(0, 7, safe, wrapmode=WrapMode.CHAR, **mc_kwargs)
      except Exception:
        pdf.multi_cell(0, 7, safe.encode("ascii", "replace").decode("ascii"), wrapmode=WrapMode.CHAR, **mc_kwargs)
  out = pdf.output(dest="S")
  if isinstance(out, str):
    return out.encode("latin-1", "replace")
  return bytes(out)


def build_order_pdf_buffer(order: SupplierOrderRead) -> BytesIO:
  return BytesIO(build_order_pdf_bytes(order))
