from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from ..models.invoice import Invoice
from ..models.supplier import Supplier
from .invoice_service import payment_status_label


def get_invoices_analytics_summary(db: Session) -> Dict[str, Any]:
  """KPI dashboard fatture da tabella Invoice (senza Aruba)."""
  now = datetime.now(timezone.utc)
  today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
  month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
  if now.month == 12:
    next_month = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
  else:
    next_month = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)
  week_end = today_start + timedelta(days=7)

  rows = (
    db.query(Invoice, Supplier.name)
    .join(Supplier, Invoice.supplier_id == Supplier.id)
    .filter(Invoice.ignored.is_(False))
    .all()
  )

  def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
      return None
    if dt.tzinfo is None:
      return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

  da_registrare = 0
  scadenze_in_arrivo = 0
  scadute = 0
  totale_mese = Decimal("0.00")
  totale_iva_mese = Decimal("0.00")
  ricevute_oggi = 0
  monthly: Dict[str, Dict[str, Any]] = {}

  for inv, _name in rows:
    ps = payment_status_label(inv)
    inv_date = _aware(inv.invoice_date)
    due = _aware(inv.due_date)

    if inv_date and today_start <= inv_date < today_start + timedelta(days=1):
      ricevute_oggi += 1

    if inv.cash_entry_id is None and ps != "paid":
      da_registrare += 1

    if due is not None and ps != "paid":
      if due < today_start:
        scadute += 1
      elif due <= week_end:
        scadenze_in_arrivo += 1

    if inv_date and month_start <= inv_date < next_month:
      totale_mese += Decimal(str(inv.total or 0))
      totale_iva_mese += Decimal(str(inv.vat_amount or 0))

    if inv_date:
      key = f"{inv_date.year:04d}-{inv_date.month:02d}"
      if key not in monthly:
        monthly[key] = {"month_key": key, "totale": Decimal("0.00"), "iva": Decimal("0.00"), "count": 0}
      monthly[key]["totale"] += Decimal(str(inv.total or 0))
      monthly[key]["iva"] += Decimal(str(inv.vat_amount or 0))
      monthly[key]["count"] += 1

  month_rows = []
  y, m = now.year, now.month
  for _ in range(6):
    key = f"{y:04d}-{m:02d}"
    row = monthly.get(key, {"month_key": key, "totale": Decimal("0.00"), "iva": Decimal("0.00"), "count": 0})
    month_rows.append(
      {
        "month_key": key,
        "month_label": f"{m:02d}/{y}",
        "totale": float(row["totale"]),
        "iva": float(row["iva"]),
        "count": int(row["count"]),
      }
    )
    m -= 1
    if m <= 0:
      m = 12
      y -= 1
  month_rows.reverse()

  return {
    "date": today_start.date().isoformat(),
    "ricevute_oggi": ricevute_oggi,
    "da_registrare": da_registrare,
    "scadenze_in_arrivo": scadenze_in_arrivo,
    "scadute": scadute,
    "totale_mese": float(totale_mese),
    "totale_iva_mese": float(totale_iva_mese),
    "documenti_totali": len(rows),
    "flussi_mensili": month_rows,
  }
