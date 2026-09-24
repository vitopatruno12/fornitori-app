"""Assistente virtuale: controllo fatture pagate vs da pagare in Atlas (banca + contanti)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..constants.sdi_companies import SDI_COMPANY_LABELS, SDI_COMPANY_ORDER
from . import banca_service

_MAX_LIST = 15


def wants_invoice_payment_control(question: str, module: str | None = None) -> bool:
  q = (question or "").lower()
  mod = (module or "").lower()
  keys = (
    "pagat",
    "da pagare",
    "non pagat",
    "ancora da pagare",
    "saldat",
    "riconcil",
    "bonific",
    "stato pagament",
    "controllo fattur",
    "controlla fattur",
    "quali fatture",
    "fatture pagate",
    "fatture aperte",
    "residuo",
    "quanto devo",
    "debiti fornitor",
    "file contanti",
    "file pagament",
    "movimenti banc",
  )
  if any(k in q for k in keys):
    return True
  if any(k in mod for k in ("fattur", "banca", "riconcil", "pagament", "amministrazione")):
    if any(k in q for k in ("pag", "apert", "scaden", "control", "stato", "elenco", "riassun")):
      return True
  return False


def extract_company_from_text(text: str) -> Optional[str]:
  q = (text or "").lower()
  mapping = (
    (("mediazione a", "via abba", "mani in pasta abba", "abba"), "mediazione_a"),
    (("mediazione z", "zanardelli", "mani in pasta zanardelli"), "mediazione_z"),
    (("via lattea", "mucche", "lattea"), "via_lattea"),
    (("risacca", "bar momento", "momento", "nardò", "nardo"), "risacca"),
    (("gazza", "pg srl", "pg ·", "arco di trionfo"), "pg"),
  )
  for aliases, company_id in mapping:
    if any(a in q for a in aliases):
      return company_id
  return None


def _eur(value: Any) -> str:
  try:
    n = float(value or 0)
  except (TypeError, ValueError):
    n = 0.0
  return f"€ {n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _row_line(row: Dict[str, Any]) -> str:
  supplier = (row.get("supplier_name") or "—").strip() or "—"
  num = (row.get("invoice_number") or "—").strip() or "—"
  total = _eur(row.get("total") if row.get("total") is not None else row.get("residuo"))
  score = row.get("match_score")
  score_bit = f" · score {int(score)}%" if score is not None else ""
  return f"• {supplier} · n. {num} · {total}{score_bit}"


def _sum_field(rows: List[Dict[str, Any]], field: str) -> float:
  total = Decimal("0")
  for row in rows:
    try:
      total += Decimal(str(row.get(field) or 0))
    except Exception:
      continue
  return float(total)


def build_invoice_payment_control(
  db: Session,
  question: str,
  module: str | None = None,
  context: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
  """Risposta operativa con dati reali Atlas (movimenti banca + file pagamenti contanti)."""
  ctx = context or {}
  # Preferisci società selezionata in UI, poi NLP sulla domanda
  company = (str(ctx.get("company") or "").strip() or None) or extract_company_from_text(
    question
  )
  if company and company not in SDI_COMPANY_ORDER and company != "non_classificata":
    company = None

  try:
    preview = banca_service.reconciliation_preview(db, limit=60, company=company)
  except Exception as exc:  # noqa: BLE001
    return {
      "answer": (
        "Non riesco a leggere ora lo stato pagamenti in Atlas "
        f"({exc}). Apri Riconciliazione banca e riprova."
      ),
      "confidence": 0.4,
      "suggested_actions": ["open_riconciliazione", "open_fatture_pagate"],
    }

  paid = list(preview.get("paid_by_bank") or [])
  unpaid = list(preview.get("da_pagare") or [])
  paid_n = int(preview.get("paid_count") or len(paid))
  unpaid_n = int(preview.get("open_invoices_count") or len(unpaid))
  paid_tot = _sum_field(paid, "total")
  unpaid_tot = _sum_field(unpaid, "residuo")
  cash_n = sum(1 for r in paid if (r.get("reason") or "") == "file_contanti")
  bank_n = max(0, paid_n - cash_n)
  label = SDI_COMPANY_LABELS.get(company or "", "") if company else "tutte le società"
  if company and not label:
    label = company

  q = (question or "").lower()
  asks_paid = any(k in q for k in ("pagat", "saldat", "abbinat"))
  asks_unpaid = any(
    k in q
    for k in ("da pagare", "non pagat", "apert", "residuo", "quanto devo", "debit", "ancora da")
  )
  # Default operativo: elenca le da pagare; se chiede entrambe, mostra entrambe
  if asks_paid and asks_unpaid:
    show_paid = True
    show_unpaid = True
  elif asks_unpaid:
    show_paid = False
    show_unpaid = True
  elif asks_paid:
    show_paid = True
    show_unpaid = True
  else:
    show_paid = False
    show_unpaid = True

  lines: List[str] = [
    f"Controllo Atlas · {label}",
    "Fonti: movimenti bancari + file Pagamenti (contanti/carta).",
    f"Pagate / abbinate: {paid_n} · {_eur(paid_tot)} (banca {bank_n} · contanti {cash_n})",
    f"Da pagare (senza prova banca/contanti): {unpaid_n} · {_eur(unpaid_tot)}",
  ]

  if show_unpaid:
    lines.append("")
    if unpaid:
      lines.append(f"Da pagare (prime {_MAX_LIST}):")
      for row in unpaid[:_MAX_LIST]:
        lines.append(_row_line(row))
      if unpaid_n > _MAX_LIST:
        lines.append(f"… e altre {unpaid_n - _MAX_LIST}. Apri Riconciliazione per l’elenco completo.")
    else:
      lines.append("Nessuna fattura da pagare secondo banca/contanti.")

  if show_paid:
    lines.append("")
    if paid:
      lines.append(f"Pagate in Atlas (prime {_MAX_LIST}):")
      for row in paid[:_MAX_LIST]:
        reason = (row.get("reason") or "").strip()
        tag = " · contanti" if reason == "file_contanti" else " · banca"
        lines.append(_row_line(row) + tag)
      if paid_n > _MAX_LIST:
        lines.append(f"… e altre {paid_n - _MAX_LIST}.")
    else:
      lines.append("Nessuna fattura ancora abbinata come pagata.")

  if not company:
    lines.append("")
    lines.append(
      "Suggerimento: seleziona la società in Fatture/Banca oppure specificala "
      "(es. «Bar Momento», «Via Lattea», «Mediazione A»)."
    )

  actions = ["open_riconciliazione"]
  if unpaid_n:
    actions.append("open_da_pagare")
  if paid_n:
    actions.append("open_fatture_pagate")
  if not company:
    actions.append("open_banca")

  return {
    "answer": "\n".join(lines),
    "confidence": 0.93,
    "suggested_actions": actions,
  }
