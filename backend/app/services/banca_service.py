from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..models.bank_account import BankAccount
from ..models.bank_movement import BankMovement
from ..models.cash_entry import CashEntry
from ..models.invoice import Invoice
from ..models.supplier import Supplier
from .cash_service import NON_FISCALE_CONTO
from .invoice_service import payment_status_label


def _fiscale_filter():
  return or_(CashEntry.conto.is_(None), CashEntry.conto != NON_FISCALE_CONTO)


def _banca_conto_sql():
  c = func.lower(func.coalesce(CashEntry.conto, ""))
  return or_(
    c.like("%banca%"),
    c.like("%bonific%"),
    c.like("%conto corrente%"),
    c.like("%cc %"),
    c.like("%iban%"),
    c.like("%intesa%"),
    c.like("%unicredit%"),
  )


def _dec(v) -> Decimal:
  return Decimal(str(v or 0)).quantize(Decimal("0.01"))


def _account_out(row: BankAccount) -> Dict[str, Any]:
  return {
    "id": row.id,
    "bank_name": row.bank_name,
    "account_name": row.account_name,
    "iban": row.iban,
    "saldo_disponibile": float(_dec(row.saldo_disponibile)),
    "saldo_contabile": float(_dec(row.saldo_contabile)),
    "connection_status": row.connection_status,
    "last_sync_at": row.last_sync_at.isoformat() if row.last_sync_at else None,
    "is_active": bool(row.is_active),
    "notes": row.notes,
    "eb_session_id": getattr(row, "eb_session_id", None),
    "eb_account_uid": getattr(row, "eb_account_uid", None),
    "eb_aspsp_name": getattr(row, "eb_aspsp_name", None),
    "eb_aspsp_country": getattr(row, "eb_aspsp_country", None),
    "enable_banking_connected": bool(getattr(row, "eb_account_uid", None)),
  }


def _movement_out(
  row: BankMovement,
  account: Optional[BankAccount] = None,
  invoice: Optional[Invoice] = None,
  supplier_name: Optional[str] = None,
) -> Dict[str, Any]:
  out = {
    "id": row.id,
    "bank_account_id": row.bank_account_id,
    "account_label": (
      f"{account.bank_name} · {account.account_name}" if account else None
    ),
    "movement_date": row.movement_date.isoformat() if row.movement_date else None,
    "description": row.description,
    "causale": row.causale,
    "movement_type": row.movement_type,
    "amount": float(_dec(row.amount)),
    "counterparty": row.counterparty,
    "category": row.category,
    "reconciliation_status": row.reconciliation_status,
    "matched_invoice_id": row.matched_invoice_id,
    "matched_cash_entry_id": row.matched_cash_entry_id,
    "difference_amount": float(_dec(row.difference_amount)) if row.difference_amount is not None else None,
    "source": row.source,
    "notes": row.notes,
  }
  if invoice is not None:
    out["matched_invoice"] = {
      "id": invoice.id,
      "invoice_number": invoice.invoice_number or str(invoice.id),
      "supplier_name": supplier_name or "",
      "total": float(_dec(invoice.total)),
      "payment_status": payment_status_label(invoice),
    }
  return out


def ensure_default_account(db: Session) -> BankAccount:
  row = db.query(BankAccount).filter(BankAccount.is_active.is_(True)).order_by(BankAccount.id.asc()).first()
  if row:
    return row
  row = BankAccount(
    bank_name="Conto principale",
    account_name="Conto corrente",
    iban=None,
    saldo_disponibile=Decimal("0.00"),
    saldo_contabile=Decimal("0.00"),
    connection_status="disconnected",
  )
  db.add(row)
  db.commit()
  db.refresh(row)
  return row


def list_accounts(db: Session) -> List[Dict[str, Any]]:
  ensure_default_account(db)
  rows = db.query(BankAccount).filter(BankAccount.is_active.is_(True)).order_by(BankAccount.id.asc()).all()
  return [_account_out(r) for r in rows]


def create_account(db: Session, payload: Dict[str, Any]) -> Dict[str, Any]:
  row = BankAccount(
    bank_name=(payload.get("bank_name") or "Banca").strip() or "Banca",
    account_name=(payload.get("account_name") or "Conto corrente").strip() or "Conto corrente",
    iban=(payload.get("iban") or "").strip() or None,
    saldo_disponibile=_dec(payload.get("saldo_disponibile")),
    saldo_contabile=_dec(payload.get("saldo_contabile")),
    connection_status="disconnected",
    notes=(payload.get("notes") or None),
  )
  db.add(row)
  db.commit()
  db.refresh(row)
  return _account_out(row)


def set_connection(db: Session, account_id: int, connect: bool) -> Dict[str, Any]:
  row = db.query(BankAccount).filter(BankAccount.id == account_id).first()
  if not row:
    raise ValueError("Conto non trovato")
  row.connection_status = "connected" if connect else "disconnected"
  if not connect:
    row.last_sync_at = None
    row.eb_session_id = None
    row.eb_account_uid = None
  db.commit()
  db.refresh(row)
  return _account_out(row)


def begin_bank_login(db: Session, account_id: int) -> Dict[str, Any]:
  """Avvia login banca con credenziali .env e invia OTP."""
  from .bank_connect_otp_service import request_bank_connect_otp

  row = db.query(BankAccount).filter(BankAccount.id == account_id, BankAccount.is_active.is_(True)).first()
  if not row:
    raise ValueError("Conto non trovato")
  if row.connection_status == "connected":
    raise ValueError("Conto già collegato")
  row.connection_status = "pending"
  db.commit()
  try:
    return request_bank_connect_otp(account_id=account_id)
  except Exception:
    row.connection_status = "disconnected"
    db.commit()
    raise


def confirm_bank_login(db: Session, account_id: int, otp: str) -> Dict[str, Any]:
  """Verifica OTP e marca il conto come collegato."""
  from .bank_connect_otp_service import get_bank_env_profile, verify_bank_connect_otp

  row = db.query(BankAccount).filter(BankAccount.id == account_id, BankAccount.is_active.is_(True)).first()
  if not row:
    raise ValueError("Conto non trovato")
  verify_bank_connect_otp(account_id=account_id, otp=otp)
  profile = get_bank_env_profile()
  if profile.get("bank_name") and (not row.bank_name or row.bank_name.strip().lower() in {"banca", "conto principale"}):
    row.bank_name = str(profile["bank_name"])
  if profile.get("iban") and not row.iban:
    row.iban = str(profile["iban"])
  row.connection_status = "connected"
  row.last_sync_at = datetime.now(timezone.utc)
  db.commit()
  db.refresh(row)
  return {
    "ok": True,
    "account": _account_out(row),
    "message": "Conto collegato con login .env + OTP.",
  }


def delete_account(db: Session, account_id: int) -> Dict[str, Any]:
  """Elimina il conto da Atlas (soft-delete) e i relativi movimenti."""
  row = db.query(BankAccount).filter(BankAccount.id == account_id, BankAccount.is_active.is_(True)).first()
  if not row:
    raise ValueError("Conto non trovato")
  deleted_movements = (
    db.query(BankMovement)
    .filter(BankMovement.bank_account_id == account_id)
    .delete(synchronize_session=False)
  )
  label = f"{row.bank_name} · {row.account_name}".strip(" ·")
  row.is_active = False
  row.connection_status = "disconnected"
  row.last_sync_at = None
  db.commit()
  return {
    "ok": True,
    "id": account_id,
    "deleted_movements": int(deleted_movements or 0),
    "message": f"Conto «{label}» eliminato da Atlas ({int(deleted_movements or 0)} movimenti rimossi).",
  }


def sync_account_from_cash(db: Session, account_id: int) -> Dict[str, Any]:
  """Sincronizza movimenti da Prima Nota (conti banca) verso bank_movements."""
  account = db.query(BankAccount).filter(BankAccount.id == account_id).first()
  if not account:
    raise ValueError("Conto non trovato")

  since = datetime.now(timezone.utc) - timedelta(days=90)
  cash_rows = (
    db.query(CashEntry)
    .filter(_fiscale_filter(), _banca_conto_sql(), CashEntry.entry_date >= since)
    .order_by(CashEntry.entry_date.desc())
    .limit(500)
    .all()
  )

  existing_cash_ids = {
    m.matched_cash_entry_id
    for m in db.query(BankMovement.matched_cash_entry_id)
    .filter(
      BankMovement.bank_account_id == account_id,
      BankMovement.matched_cash_entry_id.isnot(None),
    )
    .all()
  }

  created = 0
  for ce in cash_rows:
    if ce.id in existing_cash_ids:
      continue
    mov_date = ce.entry_date.date() if isinstance(ce.entry_date, datetime) else ce.entry_date
    if mov_date is None:
      continue
    db.add(
      BankMovement(
        bank_account_id=account_id,
        movement_date=mov_date,
        description=(ce.description or "").strip() or "Movimento Prima Nota",
        causale=ce.conto,
        movement_type="entrata" if ce.type == "entrata" else "uscita",
        amount=_dec(ce.amount),
        counterparty=None,
        category=None,
        reconciliation_status="matched" if ce.invoice_id else "unmatched",
        matched_invoice_id=ce.invoice_id,
        matched_cash_entry_id=ce.id,
        source="cash",
      )
    )
    created += 1

  # Aggiorna saldi da movimenti
  ent = (
    db.query(func.coalesce(func.sum(BankMovement.amount), 0))
    .filter(BankMovement.bank_account_id == account_id, BankMovement.movement_type == "entrata")
    .scalar()
  )
  usc = (
    db.query(func.coalesce(func.sum(BankMovement.amount), 0))
    .filter(BankMovement.bank_account_id == account_id, BankMovement.movement_type == "uscita")
    .scalar()
  )
  saldo = _dec(ent) - _dec(usc)
  account.saldo_contabile = saldo
  account.saldo_disponibile = saldo
  account.connection_status = "connected"
  account.last_sync_at = datetime.now(timezone.utc)
  db.commit()
  db.refresh(account)

  if created == 0:
    msg = (
      "Nessun movimento nuovo da Prima Nota (ultimi 90 giorni). "
      "Per importare l'estratto reale usa «Importa BAN»."
    )
  else:
    msg = f"Sincronizzati {created} nuovi movimenti da Prima Nota (ultimi 90 giorni)."

  return {
    "ok": True,
    "created": created,
    "account": _account_out(account),
    "message": msg,
  }


def list_movements(
  db: Session,
  *,
  account_id: Optional[int] = None,
  date_from: Optional[date] = None,
  date_to: Optional[date] = None,
  category: Optional[str] = None,
  counterparty: Optional[str] = None,
  limit: int = 200,
) -> List[Dict[str, Any]]:
  ensure_default_account(db)
  q = db.query(BankMovement, BankAccount).join(BankAccount, BankMovement.bank_account_id == BankAccount.id)
  if account_id:
    q = q.filter(BankMovement.bank_account_id == account_id)
  if date_from:
    q = q.filter(BankMovement.movement_date >= date_from)
  if date_to:
    q = q.filter(BankMovement.movement_date <= date_to)
  if category:
    q = q.filter(func.lower(BankMovement.category).like(f"%{category.lower()}%"))
  if counterparty:
    q = q.filter(func.lower(BankMovement.counterparty).like(f"%{counterparty.lower()}%"))
  rows = q.order_by(BankMovement.movement_date.desc(), BankMovement.id.desc()).limit(limit).all()
  invoice_ids = {m.matched_invoice_id for m, _ in rows if m.matched_invoice_id}
  invoices_by_id: Dict[int, Invoice] = {}
  suppliers_by_id: Dict[int, str] = {}
  if invoice_ids:
    inv_rows = db.query(Invoice).filter(Invoice.id.in_(invoice_ids)).all()
    invoices_by_id = {inv.id: inv for inv in inv_rows}
    supplier_ids = {inv.supplier_id for inv in inv_rows if inv.supplier_id}
    if supplier_ids:
      suppliers_by_id = {
        s.id: s.name
        for s in db.query(Supplier).filter(Supplier.id.in_(supplier_ids)).all()
      }
  return [
    _movement_out(
      m,
      a,
      invoices_by_id.get(m.matched_invoice_id) if m.matched_invoice_id else None,
      suppliers_by_id.get(invoices_by_id[m.matched_invoice_id].supplier_id)
      if m.matched_invoice_id and m.matched_invoice_id in invoices_by_id and invoices_by_id[m.matched_invoice_id].supplier_id
      else None,
    )
    for m, a in rows
  ]


def get_dashboard(db: Session) -> Dict[str, Any]:
  accounts = list_accounts(db)
  today = date.today()
  month_start = today.replace(day=1)

  q_base = db.query(BankMovement)
  ent_oggi = _dec(
    q_base.filter(BankMovement.movement_date == today, BankMovement.movement_type == "entrata")
    .with_entities(func.coalesce(func.sum(BankMovement.amount), 0))
    .scalar()
  )
  usc_oggi = _dec(
    db.query(func.coalesce(func.sum(BankMovement.amount), 0))
    .filter(BankMovement.movement_date == today, BankMovement.movement_type == "uscita")
    .scalar()
  )

  # Se inbox movimenti vuota, usa heuristic Prima Nota banca
  mov_count = db.query(func.count(BankMovement.id)).scalar() or 0
  if mov_count == 0:
    ent_e = db.query(func.coalesce(func.sum(CashEntry.amount), 0)).filter(
      _fiscale_filter(), CashEntry.type == "entrata", _banca_conto_sql(), func.date(CashEntry.entry_date) == today
    ).scalar()
    usc_e = db.query(func.coalesce(func.sum(CashEntry.amount), 0)).filter(
      _fiscale_filter(), CashEntry.type == "uscita", _banca_conto_sql(), func.date(CashEntry.entry_date) == today
    ).scalar()
    ent_oggi = _dec(ent_e)
    usc_oggi = _dec(usc_e)
    saldo_totale = _dec(
      db.query(func.coalesce(func.sum(CashEntry.amount), 0))
      .filter(_fiscale_filter(), CashEntry.type == "entrata", _banca_conto_sql())
      .scalar()
    ) - _dec(
      db.query(func.coalesce(func.sum(CashEntry.amount), 0))
      .filter(_fiscale_filter(), CashEntry.type == "uscita", _banca_conto_sql())
      .scalar()
    )
  else:
    saldo_totale = sum((_dec(a["saldo_disponibile"]) for a in accounts), Decimal("0.00"))

  # Flusso mensile (6 mesi) da bank_movements, fallback cash
  monthly = []
  y, m = today.year, today.month
  for _ in range(6):
    key = f"{y:04d}-{m:02d}"
    if mov_count > 0:
      start = date(y, m, 1)
      if m == 12:
        end = date(y + 1, 1, 1)
      else:
        end = date(y, m + 1, 1)
      ent = _dec(
        db.query(func.coalesce(func.sum(BankMovement.amount), 0))
        .filter(
          BankMovement.movement_type == "entrata",
          BankMovement.movement_date >= start,
          BankMovement.movement_date < end,
        )
        .scalar()
      )
      usc = _dec(
        db.query(func.coalesce(func.sum(BankMovement.amount), 0))
        .filter(
          BankMovement.movement_type == "uscita",
          BankMovement.movement_date >= start,
          BankMovement.movement_date < end,
        )
        .scalar()
      )
    else:
      start_dt = datetime(y, m, 1, tzinfo=timezone.utc)
      if m == 12:
        end_dt = datetime(y + 1, 1, 1, tzinfo=timezone.utc)
      else:
        end_dt = datetime(y, m + 1, 1, tzinfo=timezone.utc)
      ent = _dec(
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(
          _fiscale_filter(),
          CashEntry.type == "entrata",
          _banca_conto_sql(),
          CashEntry.entry_date >= start_dt,
          CashEntry.entry_date < end_dt,
        )
        .scalar()
      )
      usc = _dec(
        db.query(func.coalesce(func.sum(CashEntry.amount), 0))
        .filter(
          _fiscale_filter(),
          CashEntry.type == "uscita",
          _banca_conto_sql(),
          CashEntry.entry_date >= start_dt,
          CashEntry.entry_date < end_dt,
        )
        .scalar()
      )
    monthly.append(
      {
        "month_key": key,
        "month_label": f"{m:02d}/{y}",
        "entrate": float(ent),
        "uscite": float(usc),
        "netto": float(ent - usc),
      }
    )
    m -= 1
    if m == 0:
      m = 12
      y -= 1
  monthly.reverse()

  ultimi = list_movements(db, limit=8)
  if not ultimi and mov_count == 0:
    cash_recent = (
      db.query(CashEntry)
      .filter(_fiscale_filter(), _banca_conto_sql())
      .order_by(CashEntry.entry_date.desc())
      .limit(8)
      .all()
    )
    for ce in cash_recent:
      d = ce.entry_date.date() if isinstance(ce.entry_date, datetime) else ce.entry_date
      ultimi.append(
        {
          "id": f"cash-{ce.id}",
          "bank_account_id": None,
          "account_label": ce.conto or "Banca",
          "movement_date": d.isoformat() if d else None,
          "description": ce.description,
          "causale": ce.conto,
          "movement_type": ce.type,
          "amount": float(_dec(ce.amount)),
          "counterparty": None,
          "category": None,
          "reconciliation_status": "matched" if ce.invoice_id else "unmatched",
          "source": "cash",
        }
      )

  unmatched = (
    db.query(func.count(BankMovement.id))
    .filter(BankMovement.reconciliation_status == "unmatched")
    .scalar()
    or 0
  )
  differences = (
    db.query(func.count(BankMovement.id))
    .filter(BankMovement.reconciliation_status == "difference")
    .scalar()
    or 0
  )
  avvisi = []
  disconnected = [a for a in accounts if a["connection_status"] != "connected"]
  if disconnected:
    avvisi.append(f"{len(disconnected)} conto/i non collegati")
  if unmatched:
    avvisi.append(f"{unmatched} movimenti da riconciliare")
  if differences:
    avvisi.append(f"{differences} differenze da verificare")
  if mov_count == 0:
    avvisi.append("Nessun movimento bancario importato: usa Sincronizza sui conti o importa da Prima Nota")

  return {
    "saldo_totale": float(saldo_totale),
    "entrate_oggi": float(ent_oggi),
    "uscite_oggi": float(usc_oggi),
    "liquidita_disponibile": float(saldo_totale),
    "flusso_cassa_mese": float(ent_oggi - usc_oggi),  # placeholder day; monthly below
    "flussi_mensili": monthly,
    "ultimi_movimenti": ultimi,
    "avvisi": avvisi,
    "accounts_count": len(accounts),
    "month_start": month_start.isoformat(),
  }


def reconciliation_preview(db: Session, limit: int = 40) -> Dict[str, Any]:
  """Abbina uscite non riconciliate a fatture fornitori aperte per importo."""
  ensure_default_account(db)
  open_invoices = (
    db.query(Invoice, Supplier.name)
    .join(Supplier, Invoice.supplier_id == Supplier.id)
    .filter(Invoice.ignored.is_(False))
    .order_by(Invoice.id.desc())
    .limit(300)
    .all()
  )
  open_rows = []
  for inv, supplier_name in open_invoices:
    if payment_status_label(inv) == "paid":
      continue
    residuo = _dec(inv.total) - _dec(inv.amount_paid)
    if residuo <= Decimal("0.009"):
      continue
    open_rows.append(
      {
        "invoice_id": inv.id,
        "supplier_name": supplier_name,
        "invoice_number": inv.invoice_number,
        "due_date": inv.due_date.date().isoformat() if hasattr(inv.due_date, "date") else (inv.due_date.isoformat() if inv.due_date else None),
        "residuo": float(residuo),
      }
    )

  unmatched = (
    db.query(BankMovement, BankAccount)
    .join(BankAccount, BankMovement.bank_account_id == BankAccount.id)
    .filter(BankMovement.reconciliation_status == "unmatched", BankMovement.movement_type == "uscita")
    .order_by(BankMovement.movement_date.desc())
    .limit(limit)
    .all()
  )

  suggestions = []
  used_invoices = set()
  for mov, acc in unmatched:
    amt = _dec(mov.amount)
    best = None
    for inv in open_rows:
      if inv["invoice_id"] in used_invoices:
        continue
      diff = abs(_dec(inv["residuo"]) - amt)
      if diff <= Decimal("0.05"):
        best = {**inv, "difference": float(diff), "match_quality": "exact"}
        break
      if best is None and diff <= Decimal("5.00"):
        best = {**inv, "difference": float(diff), "match_quality": "near"}
    if best:
      used_invoices.add(best["invoice_id"])
      suggestions.append(
        {
          "movement": _movement_out(mov, acc),
          "suggested_invoice": best,
          "status": "matched" if best["match_quality"] == "exact" else "difference",
        }
      )
    else:
      suggestions.append(
        {
          "movement": _movement_out(mov, acc),
          "suggested_invoice": None,
          "status": "unmatched",
        }
      )

  return {
    "suggestions": suggestions,
    "open_invoices_count": len(open_rows),
    "unmatched_movements": len(unmatched),
  }


def apply_match(db: Session, movement_id: int, invoice_id: Optional[int], status: str = "matched") -> Dict[str, Any]:
  mov = db.query(BankMovement).filter(BankMovement.id == movement_id).first()
  if not mov:
    raise ValueError("Movimento non trovato")
  if status not in {"matched", "unmatched", "difference"}:
    raise ValueError("Stato non valido")
  mov.reconciliation_status = status
  mov.matched_invoice_id = invoice_id if status != "unmatched" else None
  if status == "difference" and invoice_id:
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if inv:
      residuo = _dec(inv.total) - _dec(inv.amount_paid)
      mov.difference_amount = residuo - _dec(mov.amount)
      paid = _dec(inv.amount_paid) + _dec(mov.amount)
      inv.amount_paid = min(_dec(inv.total), paid)
      inv.is_paid = payment_status_label(inv) == "paid"
  elif status == "matched" and invoice_id:
    mov.difference_amount = None
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if inv:
      inv.amount_paid = _dec(inv.total)
      inv.is_paid = True
  else:
    mov.difference_amount = None
  db.commit()
  db.refresh(mov)
  acc = db.query(BankAccount).filter(BankAccount.id == mov.bank_account_id).first()
  inv = db.query(Invoice).filter(Invoice.id == mov.matched_invoice_id).first() if mov.matched_invoice_id else None
  supplier_name = None
  if inv and inv.supplier_id:
    sup = db.query(Supplier).filter(Supplier.id == inv.supplier_id).first()
    supplier_name = sup.name if sup else None
  return _movement_out(mov, acc, inv, supplier_name)


def _refresh_account_balances(db: Session, account: BankAccount) -> None:
  ent = (
    db.query(func.coalesce(func.sum(BankMovement.amount), 0))
    .filter(BankMovement.bank_account_id == account.id, BankMovement.movement_type == "entrata")
    .scalar()
  )
  usc = (
    db.query(func.coalesce(func.sum(BankMovement.amount), 0))
    .filter(BankMovement.bank_account_id == account.id, BankMovement.movement_type == "uscita")
    .scalar()
  )
  saldo = _dec(ent) - _dec(usc)
  account.saldo_contabile = saldo
  account.saldo_disponibile = saldo
  account.connection_status = "connected"
  account.last_sync_at = datetime.now(timezone.utc)


def import_ban_movements(db: Session, account_id: int, movements: List[Dict[str, Any]]) -> Dict[str, Any]:
  """Importa movimenti da file BAN/CBI su un conto (deduplica date+importo+descrizione+tipo)."""
  account = db.query(BankAccount).filter(BankAccount.id == account_id).first()
  if not account:
    raise ValueError("Conto non trovato")
  if not isinstance(movements, list) or not movements:
    raise ValueError("Nessun movimento da importare")

  existing_keys = {
    (
      m.movement_date.isoformat() if m.movement_date else "",
      m.movement_type or "",
      f"{_dec(m.amount):.2f}",
      (m.description or "")[:80],
    )
    for m in db.query(BankMovement)
    .filter(BankMovement.bank_account_id == account_id, BankMovement.source.in_(["import", "ban"]))
    .all()
  }
  # Include anche altri source per evitare doppioni evidenti
  for m in (
    db.query(BankMovement)
    .filter(BankMovement.bank_account_id == account_id)
    .order_by(BankMovement.id.desc())
    .limit(2000)
    .all()
  ):
    existing_keys.add(
      (
        m.movement_date.isoformat() if m.movement_date else "",
        m.movement_type or "",
        f"{_dec(m.amount):.2f}",
        (m.description or "")[:80],
      )
    )

  created = 0
  skipped = 0
  for raw in movements[:2000]:
    if not isinstance(raw, dict):
      skipped += 1
      continue
    date_raw = str(raw.get("movement_date") or "").strip()
    try:
      mov_date = date.fromisoformat(date_raw[:10])
    except ValueError:
      skipped += 1
      continue
    amount = _dec(raw.get("amount"))
    if amount <= 0:
      skipped += 1
      continue
    mov_type = str(raw.get("movement_type") or "").strip().lower()
    if mov_type not in {"entrata", "uscita"}:
      skipped += 1
      continue
    description = (str(raw.get("description") or "").strip() or "Movimento BAN")[:512]
    causale = (str(raw.get("causale") or "").strip() or None)
    if causale:
      causale = causale[:256]
    counterparty = (str(raw.get("counterparty") or "").strip() or None)
    if counterparty:
      counterparty = counterparty[:256]

    key = (mov_date.isoformat(), mov_type, f"{amount:.2f}", description[:80])
    if key in existing_keys:
      skipped += 1
      continue

    db.add(
      BankMovement(
        bank_account_id=account_id,
        movement_date=mov_date,
        description=description,
        causale=causale,
        movement_type=mov_type,
        amount=amount,
        counterparty=counterparty,
        category=None,
        reconciliation_status="unmatched",
        source="import",
        notes="Importato da file BAN",
      )
    )
    existing_keys.add(key)
    created += 1

  _refresh_account_balances(db, account)
  db.commit()
  db.refresh(account)
  return {
    "ok": True,
    "created": created,
    "skipped": skipped,
    "account": _account_out(account),
    "message": f"Import BAN: {created} nuovi movimenti ({skipped} già presenti o non validi).",
  }
