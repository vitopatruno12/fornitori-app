from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
import re

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..models.bank_account import BankAccount
from ..models.bank_movement import BankMovement
from ..models.cash_entry import CashEntry
from ..models.invoice import Invoice
from ..models.supplier import Supplier
from ..constants.company_banks import (
  IBAN_TO_COMPANY,
  account_matches_company,
  expected_banks_for_company,
  normalize_iban,
)
from .cash_service import NON_FISCALE_CONTO
from .invoice_service import list_invoices, payment_status_label


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


def _account_display_label(account: Optional[BankAccount]) -> Optional[str]:
  if not account:
    return None
  bank = (account.bank_name or "Banca").strip() or "Banca"
  company = (getattr(account, "company", None) or "").strip()
  name = (account.account_name or "").strip()
  iban = (account.iban or "").replace(" ", "").upper()
  company_labels = {
    "via_lattea": "Via Lattea",
    "mediazione_a": "Mediazione A",
    "mediazione_z": "Mediazione Z",
    "risacca": "Risacca",
    "pg": "PG",
  }
  bits = [bank]
  if company:
    bits.append(company_labels.get(company, company))
  elif name:
    bits.append(name)
  if iban:
    short = f"{iban[:4]}…{iban[-6:]}" if len(iban) > 8 else iban
    bits.append(short)
  return " · ".join(bits)


def _account_out(row: BankAccount) -> Dict[str, Any]:
  company = (getattr(row, "company", None) or "").strip() or None
  ledger_code = (getattr(row, "ledger_code", None) or "1100").strip() or "1100"
  return {
    "id": row.id,
    "bank_name": row.bank_name,
    "account_name": row.account_name,
    "iban": row.iban,
    "company": company,
    "ledger_code": ledger_code,
    "label": _account_display_label(row),
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
    "account_label": _account_display_label(account),
    "account_company": (getattr(account, "company", None) or None) if account else None,
    "ledger_code": (
      (getattr(account, "ledger_code", None) or "1100").strip() or "1100"
    )
    if account
    else "1100",
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
      "supplier_id": getattr(invoice, "supplier_id", None),
      "supplier_name": supplier_name or "",
      "total": float(_dec(invoice.total)),
      "payment_status": payment_status_label(invoice),
      "company": getattr(invoice, "company", None) or getattr(account, "company", None),
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
  ensure_canonical_bank_accounts(db)
  ensure_known_account_companies(db)
  rows = db.query(BankAccount).filter(BankAccount.is_active.is_(True)).order_by(BankAccount.id.asc()).all()
  return [_account_out(r) for r in rows]


def create_account(db: Session, payload: Dict[str, Any]) -> Dict[str, Any]:
  company = (payload.get("company") or "").strip() or None
  ledger_code = (payload.get("ledger_code") or "1100").strip() or "1100"
  row = BankAccount(
    bank_name=(payload.get("bank_name") or "Banca").strip() or "Banca",
    account_name=(payload.get("account_name") or "Conto corrente").strip() or "Conto corrente",
    iban=(payload.get("iban") or "").strip() or None,
    company=company,
    ledger_code=ledger_code,
    saldo_disponibile=_dec(payload.get("saldo_disponibile")),
    saldo_contabile=_dec(payload.get("saldo_contabile")),
    connection_status="disconnected",
    notes=(payload.get("notes") or None),
  )
  db.add(row)
  db.commit()
  db.refresh(row)
  return _account_out(row)


def update_account(db: Session, account_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
  row = db.query(BankAccount).filter(BankAccount.id == account_id).first()
  if not row:
    raise ValueError("Conto non trovato")
  if "bank_name" in payload and payload.get("bank_name") is not None:
    row.bank_name = str(payload.get("bank_name") or "").strip() or row.bank_name
  if "account_name" in payload and payload.get("account_name") is not None:
    row.account_name = str(payload.get("account_name") or "").strip() or row.account_name
  if "iban" in payload:
    row.iban = (str(payload.get("iban") or "").strip() or None)
  if "company" in payload:
    row.company = (str(payload.get("company") or "").strip() or None)
  if "ledger_code" in payload and payload.get("ledger_code") is not None:
    row.ledger_code = str(payload.get("ledger_code") or "1100").strip() or "1100"
  if "notes" in payload:
    row.notes = (str(payload.get("notes") or "").strip() or None)
  db.commit()
  db.refresh(row)
  return _account_out(row)


def ensure_known_account_companies(db: Session) -> int:
  """Allinea company sui conti con IBAN noti (Mediazione / Via Lattea / Risacca)."""
  rows = db.query(BankAccount).filter(BankAccount.is_active.is_(True)).all()
  changed = 0
  for row in rows:
    iban_n = normalize_iban(row.iban)
    target = IBAN_TO_COMPANY.get(iban_n)
    if not target:
      # Intesa senza IBAN completo ma nome chiaro → Risacca
      blob = f"{row.bank_name or ''} {row.account_name or ''} {row.notes or ''}".lower()
      if "intesa" in blob and ("risacca" in blob or "momento" in blob or "business insieme" in blob):
        target = "risacca"
      else:
        continue
    current = (getattr(row, "company", None) or "").strip().lower()
    name_l = (row.account_name or "").lower()
    need_rename = False
    if target == "via_lattea" and iban_n in {
      normalize_iban("IT25D0538516000CC1410004514"),
      normalize_iban("IT25D0538516000CC410004514"),
    }:
      if "via lattea" not in name_l:
        row.account_name = "Via Lattea · CC1410004514"
        need_rename = True
    if target == "via_lattea" and iban_n == normalize_iban("IT37M0844516000000000967252"):
      if "via lattea" not in name_l:
        row.account_name = "Via Lattea · BCC Terra d'Otranto"
        need_rename = True
    if target == "mediazione_a" and iban_n == normalize_iban("IT55B0538516000CC1410004512"):
      if "mediazione" not in name_l:
        row.account_name = "Mediazione · CC1410004512"
        need_rename = True
    if target == "mediazione_a" and iban_n == normalize_iban("IT06B0844516000000000972450"):
      if "mediazione" not in name_l:
        row.account_name = "Mediazione · BCC Terra d'Otranto"
        need_rename = True
    if target == "risacca" and (not row.account_name or "intesa" in name_l):
      if "risacca" not in name_l:
        row.account_name = "Risacca · Bar Momento · Intesa"
        need_rename = True
    if current == target and not need_rename:
      continue
    # Non sovrascrivere pg se qualcuno ha già taggato a mano un IBAN non in mappa
    if current == "pg" and target != "pg":
      continue
    if current != target:
      row.company = target
    changed += 1
  if changed:
    db.commit()
  return changed


# Conti canonici da creare se mancano (IBAN noti Atlas)
_CANONICAL_BANK_SEEDS: List[Dict[str, Any]] = [
  {
    "bank_name": "BPPB - Banca Popolare di Puglia e Basilicata",
    "account_name": "Via Lattea · CC1410004514",
    "iban": "IT25D0538516000CC1410004514",
    "company": "via_lattea",
    "ledger_code": "1100",
    "notes": "LA VIA LATTEA · BPPB · IBAN IT25D0538516000CC1410004514",
  },
  {
    "bank_name": "BPPB - Banca Popolare di Puglia e Basilicata",
    "account_name": "Mediazione · CC1410004512",
    "iban": "IT55B0538516000CC1410004512",
    "company": "mediazione_a",
    "ledger_code": "1100",
    "notes": "MEDIAZIONE · BPPB · IBAN IT55B0538516000CC1410004512",
  },
  {
    "bank_name": "BCC Terra d'Otranto",
    "account_name": "Via Lattea · BCC Terra d'Otranto",
    "iban": "IT37M0844516000000000967252",
    "company": "via_lattea",
    "ledger_code": "1100",
    "notes": "LA VIA LATTEA · BCC Terra d'Otranto · IBAN IT37M0844516000000000967252",
  },
  {
    "bank_name": "BCC Terra d'Otranto",
    "account_name": "Mediazione · BCC Terra d'Otranto",
    "iban": "IT06B0844516000000000972450",
    "company": "mediazione_a",
    "ledger_code": "1100",
    "notes": "MEDIAZIONE · BCC Terra d'Otranto · IBAN IT06B0844516000000000972450",
  },
  {
    "bank_name": "Intesa Sanpaolo",
    "account_name": "Risacca · Bar Momento · Intesa",
    "iban": "IT88N0306979822100000008926",
    "company": "risacca",
    "ledger_code": "1100",
    "notes": "RISACCA · Intesa Sanpaolo · IBAN IT88N0306979822100000008926",
  },
]


def ensure_canonical_bank_accounts(db: Session) -> int:
  """Crea i conti canonici (Via Lattea BPPB/BCC, Mediazione, Risacca) se l'IBAN non esiste."""
  rows = db.query(BankAccount).filter(BankAccount.is_active.is_(True)).all()
  existing = {normalize_iban(r.iban) for r in rows if r.iban}
  created = 0
  for seed in _CANONICAL_BANK_SEEDS:
    iban_n = normalize_iban(seed["iban"])
    if not iban_n or iban_n in existing:
      continue
    db.add(
      BankAccount(
        bank_name=seed["bank_name"],
        account_name=seed["account_name"],
        iban=iban_n,
        company=seed.get("company"),
        ledger_code=seed.get("ledger_code") or "1100",
        notes=seed.get("notes"),
        connection_status="disconnected",
        is_active=True,
        saldo_disponibile=Decimal("0"),
        saldo_contabile=Decimal("0"),
      )
    )
    existing.add(iban_n)
    created += 1
  if created:
    db.commit()
  return created


def accounts_for_company(db: Session, company: Optional[str] = None) -> List[Dict[str, Any]]:
  """Conti per società: IBAN/tag noti — niente fallback su tutti i conti condivisi."""
  ensure_default_account(db)
  ensure_canonical_bank_accounts(db)
  ensure_known_account_companies(db)
  rows = db.query(BankAccount).filter(BankAccount.is_active.is_(True)).order_by(BankAccount.id.asc()).all()
  company_id = (company or "").strip()
  if not company_id:
    return [_account_out(r) for r in rows]

  matched = [
    r
    for r in rows
    if account_matches_company(
      company_id=company_id,
      account_company=getattr(r, "company", None),
      bank_name=r.bank_name,
      account_name=r.account_name,
      iban=r.iban,
      notes=getattr(r, "notes", None),
    )
  ]
  return [_account_out(r) for r in matched]


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


def unsync_account(db: Session, account_id: int) -> Dict[str, Any]:
  """Scollega Enable Banking e rimuove i movimenti importati del conto (resta in elenco)."""
  row = db.query(BankAccount).filter(BankAccount.id == account_id, BankAccount.is_active.is_(True)).first()
  if not row:
    raise ValueError("Conto non trovato")
  deleted_movements = (
    db.query(BankMovement)
    .filter(BankMovement.bank_account_id == account_id)
    .delete(synchronize_session=False)
  )
  row.connection_status = "disconnected"
  row.last_sync_at = None
  row.eb_session_id = None
  row.eb_account_uid = None
  row.saldo_disponibile = 0
  row.saldo_contabile = 0
  db.commit()
  db.refresh(row)
  label = f"{row.bank_name} · {row.account_name}".strip(" ·")
  return {
    "ok": True,
    "account": _account_out(row),
    "deleted_movements": int(deleted_movements or 0),
    "message": (
      f"Conto «{label}» scollegato: {int(deleted_movements or 0)} movimenti rimossi. "
      "Puoi ricollegarlo e reimportare."
    ),
  }


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
    return request_bank_connect_otp(account_id=account_id, account=_account_out(row))
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
  profile = get_bank_env_profile(_account_out(row))
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


def _normalize_doc_token(value: str) -> str:
  return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def _movement_search_blob(mov: BankMovement) -> str:
  return " ".join(
    [
      str(mov.description or ""),
      str(mov.causale or ""),
      str(mov.counterparty or ""),
      str(mov.notes or ""),
    ]
  )


def _invoice_number_in_text(invoice_number: Optional[str], text: str) -> bool:
  """Cerca il numero documento nel testo movimento (bonifico / causale)."""
  num = (invoice_number or "").strip()
  if not num:
    return False
  norm_num = _normalize_doc_token(num)
  # Numeri troppo corti (1, 12, 18…) generano falsi positivi nei bonifici
  if len(norm_num) < 3:
    return False
  text_u = (text or "").upper()
  num_u = num.upper()
  # Match con confini alfanumerici (evita falsi positivi su numeri corti)
  pattern = re.compile(rf"(?<![A-Z0-9]){re.escape(num_u)}(?![A-Z0-9])", re.IGNORECASE)
  if pattern.search(text_u):
    return True
  if len(norm_num) >= 4:
    return norm_num in _normalize_doc_token(text_u)
  return False


_BANK_NAME_STOPWORDS = frozenset(
  {
    "srl",
    "srls",
    "spa",
    "snc",
    "sas",
    "soc",
    "coop",
    "societa",
    "unipersonale",
  }
)


def _supplier_in_blob(supplier_name: Optional[str], blob: str) -> bool:
  blob_u = (blob or "").upper()
  if not blob_u:
    return False
  raw = re.sub(r"[^A-Z0-9]+", " ", (supplier_name or "").upper())
  tokens = [t for t in raw.split() if len(t) >= 4 and t.lower() not in _BANK_NAME_STOPWORDS]
  if not tokens:
    return False
  return any(re.search(rf"(?<![A-Z0-9]){re.escape(t)}(?![A-Z0-9])", blob_u) for t in tokens)


def _movement_amount_matches_invoice(inv: Any, mov: Any) -> bool:
  total = abs(_dec(getattr(inv, "total", 0)))
  amt = abs(_dec(getattr(mov, "amount", 0)))
  if total <= Decimal("0.009") or amt <= Decimal("1.00"):
    return False
  residuo = abs(total - _dec(getattr(inv, "amount_paid", 0)))
  if residuo <= Decimal("0.009"):
    residuo = total
  return abs(total - amt) <= Decimal("0.05") or abs(residuo - amt) <= Decimal("0.05")


def _bank_movement_pays_invoice(inv: Any, mov: Any, blob: str) -> bool:
  """Pagamento valido solo con n. documento E importo (fornitore da solo non basta).

  Prima bastava numero + nome fornitore in causale → molte fatture segnate pagate
  senza bonifico reale. Ora serve sempre l'importo (totale o residuo ±0,05 €).
  Per numeri corti (<4 caratteri) serve anche un token del fornitore.
  """
  if getattr(mov, "movement_type", None) and str(mov.movement_type).lower() != "uscita":
    return False
  if not _invoice_number_in_text(getattr(inv, "invoice_number", None), blob):
    return False
  if not _movement_amount_matches_invoice(inv, mov):
    return False
  norm = _normalize_doc_token(str(getattr(inv, "invoice_number", None) or ""))
  if len(norm) < 4:
    return _supplier_in_blob(getattr(inv, "supplier_name", None), blob)
  return True


def _invoice_row_out(inv: Any, *, match_movement: Optional[Dict[str, Any]] = None, reason: str = "") -> Dict[str, Any]:
  total = _dec(getattr(inv, "total", 0))
  paid = _dec(getattr(inv, "amount_paid", 0))
  residuo = total - paid
  due = getattr(inv, "due_date", None)
  inv_date = getattr(inv, "invoice_date", None)
  status = getattr(inv, "payment_status", None) or payment_status_label(inv)
  aligned = reason in {
    "matched",
    "numero_in_movimento",
    "file_pagamenti",
    "gia_pagata_in_atlas",
  } or residuo <= Decimal("0.009") or status == "paid"
  return {
    "invoice_id": getattr(inv, "id", None),
    "supplier_name": getattr(inv, "supplier_name", "") or "",
    "invoice_number": getattr(inv, "invoice_number", None),
    "invoice_date": inv_date.date().isoformat() if hasattr(inv_date, "date") else (inv_date.isoformat() if inv_date else None),
    "due_date": due.date().isoformat() if hasattr(due, "date") else (due.isoformat() if due else None),
    "total": float(total),
    "amount_paid": float(paid),
    "residuo": float(residuo),
    "payment_status": status,
    "company": getattr(inv, "company", None),
    "match_reason": reason,
    "aligned": aligned,
    "paid_ok": aligned,
    "matched_movement": match_movement,
  }


def reconciliation_preview(
  db: Session,
  limit: int = 40,
  company: Optional[str] = None,
) -> Dict[str, Any]:
  """Classifica fatture pagate/da pagare tramite n. documento nei movimenti banca; propone abbinamenti."""
  ensure_default_account(db)
  company_id = (company or "").strip() or None

  invoices = list_invoices(db, company=company_id, include_ignored=False)
  # Ampio set: storico ricevute + bonifici sui conti collegati
  invoices = invoices[:5000]

  account_items = accounts_for_company(db, company_id) if company_id else list_accounts(db)
  account_ids = {int(a["id"]) for a in account_items if a.get("id") is not None}

  mov_q = db.query(BankMovement, BankAccount).join(BankAccount, BankMovement.bank_account_id == BankAccount.id)
  if account_ids:
    mov_q = mov_q.filter(BankMovement.bank_account_id.in_(account_ids))
  # Ampio set per matching per numero (non solo unmatched)
  movements = mov_q.order_by(BankMovement.movement_date.desc(), BankMovement.id.desc()).limit(5000).all()

  # Precompute blobs
  mov_meta: List[Dict[str, Any]] = []
  for mov, acc in movements:
    mov_meta.append(
      {
        "mov": mov,
        "acc": acc,
        "blob": _movement_search_blob(mov),
        "out": _movement_out(mov, acc),
      }
    )

  from . import supplier_payments_service

  try:
    paid_file_rows = supplier_payments_service.list_paid_document_rows(
      db, company=company_id, all_workbooks=not company_id
    )
  except Exception:
    paid_file_rows = []

  paid_by_bank: List[Dict[str, Any]] = []
  da_pagare: List[Dict[str, Any]] = []

  for inv in invoices:
    inv_id = int(inv.id)
    num = str(inv.invoice_number or "").strip()
    status = inv.payment_status or "unpaid"
    residuo = _dec(inv.total) - _dec(inv.amount_paid)

    # Già riconciliata su un movimento (solo se n. documento + importo confermano)
    already = next(
      (
        m
        for m in mov_meta
        if m["mov"].matched_invoice_id == inv_id
      ),
      None,
    )
    found = None
    if already and _bank_movement_pays_invoice(inv, already["mov"], already["blob"]):
      found = already
    if not found and num:
      for m in mov_meta:
        # Solo uscite (bonifici) sui conti collegati
        if m["mov"].movement_type != "uscita":
          continue
        if _bank_movement_pays_invoice(inv, m["mov"], m["blob"]):
          found = m
          break

    file_hit = None
    if not found and paid_file_rows:
      file_hit = supplier_payments_service.find_paid_row_for_invoice(
        paid_file_rows,
        invoice_number=num,
        supplier_name=getattr(inv, "supplier_name", None),
        supplier_vat=getattr(inv, "supplier_vat", None) or getattr(inv, "vat_number", None),
        invoice_total=float(_dec(getattr(inv, "total", 0)) or 0),
      )

    if found:
      paid_by_bank.append(
        _invoice_row_out(
          inv,
          match_movement=found["out"],
          reason="matched" if found["mov"].matched_invoice_id == inv_id else "numero_in_movimento",
        )
      )
    elif file_hit:
      paid_by_bank.append(
        _invoice_row_out(
          inv,
          reason="file_pagamenti",
          match_movement={
            "movement_date": (file_hit.get("payment_date") or "")[:10] or None,
            "description": f"File Pagamenti · {file_hit.get('sheet') or ''}".strip(" ·"),
            "causale": "PAGATO",
            "amount": file_hit.get("amount_paid"),
            "id": None,
          },
        )
      )
    elif status == "paid" or residuo <= Decimal("0.009"):
      paid_by_bank.append(_invoice_row_out(inv, reason="gia_pagata_in_atlas"))
    else:
      da_pagare.append(_invoice_row_out(inv, reason="da_pagare"))

  # Suggerimenti: prima match per numero su uscite unmatched, poi fallback importo
  open_for_amount = [
    {
      "invoice_id": row["invoice_id"],
      "supplier_name": row["supplier_name"],
      "invoice_number": row["invoice_number"],
      "due_date": row["due_date"],
      "residuo": row["residuo"],
    }
    for row in da_pagare
    if row["residuo"] > 0.009
  ]

  unmatched = [
    (m["mov"], m["acc"], m["blob"], m["out"])
    for m in mov_meta
    if m["mov"].reconciliation_status == "unmatched" and m["mov"].movement_type == "uscita"
  ][:limit]

  suggestions = []
  used_invoices = set()
  for mov, acc, blob, mov_out in unmatched:
    # 1) Match per numero documento
    best = None
    for inv in invoices:
      inv_id = int(inv.id)
      if inv_id in used_invoices:
        continue
      if (inv.payment_status or "") == "paid":
        continue
      residuo = _dec(inv.total) - _dec(inv.amount_paid)
      if residuo <= Decimal("0.009"):
        continue
      if not _bank_movement_pays_invoice(inv, mov, blob):
        continue
      diff = abs(residuo - _dec(mov.amount))
      best = {
        "invoice_id": inv_id,
        "supplier_name": inv.supplier_name,
        "invoice_number": inv.invoice_number,
        "due_date": inv.due_date.date().isoformat()
        if hasattr(inv.due_date, "date")
        else (inv.due_date.isoformat() if inv.due_date else None),
        "residuo": float(residuo),
        "difference": float(diff),
        "match_quality": "number",
      }
      break

    # 2) Fallback per importo: solo se la causale cita il fornitore
    if best is None:
      amt = _dec(mov.amount)
      near = None
      for inv in open_for_amount:
        if inv["invoice_id"] in used_invoices:
          continue
        if not _supplier_in_blob(inv.get("supplier_name"), blob):
          continue
        diff = abs(_dec(inv["residuo"]) - amt)
        if diff <= Decimal("0.05"):
          best = {**inv, "difference": float(diff), "match_quality": "exact"}
          break
        if near is None and diff <= Decimal("5.00"):
          near = {**inv, "difference": float(diff), "match_quality": "near"}
      if best is None:
        best = near

    if best:
      used_invoices.add(best["invoice_id"])
      diff_dec = _dec(best.get("difference", 0))
      if best["match_quality"] == "number":
        status = "matched" if diff_dec <= Decimal("0.05") else "difference"
      elif best["match_quality"] == "exact":
        status = "matched"
      else:
        status = "difference"
      suggestions.append(
        {
          "movement": mov_out,
          "suggested_invoice": best,
          "status": status,
        }
      )
    else:
      suggestions.append(
        {
          "movement": mov_out,
          "suggested_invoice": None,
          "status": "unmatched",
        }
      )

  return {
    "company": company_id or "",
    "suggestions": suggestions,
    "paid_by_bank": paid_by_bank,
    "da_pagare": da_pagare,
    "open_invoices_count": len(da_pagare),
    "paid_count": len(paid_by_bank),
    "pagamenti_paid_rows": len(paid_file_rows),
    "unmatched_movements": len([s for s in suggestions if s["status"] == "unmatched"]),
    "accounts_used": [
      {
        "id": a.get("id"),
        "label": a.get("label") or f"{a.get('bank_name')} · {a.get('account_name')}",
        "company": a.get("company"),
        "bank_name": a.get("bank_name"),
        "iban": a.get("iban"),
      }
      for a in account_items
    ],
    "expected_banks": expected_banks_for_company(company_id),
  }


def sync_payment_status_from_bank(
  db: Session,
  company: Optional[str] = None,
) -> Dict[str, Any]:
  """
  Aggiorna lo stato pagamento fatture ricevute in base a:
  - bonifici in uscita (n. documento + importo ±0,05 €)
  - file Pagamenti: solo colonna PAGATO (DARE) > 0

  Regole file fornitori:
  - importo solo in PAGARE (AVERE) → non pagata (da pagare)
  - n. fattura assente dal file della società e senza prova banca → da pagare

  Riapre (da pagare) le fatture già «pagate» senza prova solida.
  """
  from decimal import Decimal

  from . import supplier_payments_service

  company_id = (company or "").strip() or None
  listed = list_invoices(db, company=company_id, include_ignored=False)
  unpaid = [
    inv
    for inv in listed
    if (getattr(inv, "payment_status", None) or "unpaid") != "paid"
  ]
  paid_listed = [
    inv
    for inv in listed
    if (getattr(inv, "payment_status", None) or "unpaid") == "paid"
  ]
  account_items = accounts_for_company(db, company_id) if company_id else list_accounts(db)
  account_ids = {int(a["id"]) for a in account_items if a.get("id") is not None}

  mov_q = db.query(BankMovement)
  if account_ids:
    mov_q = mov_q.filter(BankMovement.bank_account_id.in_(account_ids))
  movements = (
    mov_q.order_by(BankMovement.movement_date.desc(), BankMovement.id.desc()).limit(5000).all()
  )
  mov_meta = [{"mov": m, "blob": _movement_search_blob(m)} for m in movements]

  try:
    file_rows = supplier_payments_service.list_workbook_document_rows(
      db, company=company_id, all_workbooks=not company_id
    )
  except Exception:
    file_rows = []
  paid_file_rows = [r for r in file_rows if r.get("is_paid_in_file")]

  def _bank_hit(inv_dto: Any) -> Optional[Any]:
    inv_id = int(getattr(inv_dto, "id"))
    num = str(getattr(inv_dto, "invoice_number", None) or "").strip()
    already = next(
      (meta for meta in mov_meta if meta["mov"].matched_invoice_id == inv_id),
      None,
    )
    if already and _bank_movement_pays_invoice(inv_dto, already["mov"], already["blob"]):
      return already["mov"]
    if not num:
      return None
    for meta in mov_meta:
      mov = meta["mov"]
      if mov.movement_type != "uscita":
        continue
      if not _bank_movement_pays_invoice(inv_dto, mov, meta["blob"]):
        continue
      return mov
    return None

  def _file_paid_hit(inv_dto: Any) -> Optional[Dict[str, Any]]:
    num = str(getattr(inv_dto, "invoice_number", None) or "").strip()
    if not num or not paid_file_rows:
      return None
    return supplier_payments_service.find_paid_row_for_invoice(
      paid_file_rows,
      invoice_number=num,
      supplier_name=str(getattr(inv_dto, "supplier_name", None) or "").strip(),
      supplier_vat=str(
        getattr(inv_dto, "supplier_vat", None)
        or getattr(inv_dto, "vat_number", None)
        or ""
      ).strip(),
      invoice_total=float(_dec(getattr(inv_dto, "total", 0)) or 0),
    )

  marked: List[Dict[str, Any]] = []
  reopened: List[Dict[str, Any]] = []
  marked_from_file = 0
  changed = False

  for inv_dto in unpaid:
    inv_id = int(getattr(inv_dto, "id"))
    num = str(getattr(inv_dto, "invoice_number", None) or "").strip()
    found = _bank_hit(inv_dto)
    file_hit = None if found else _file_paid_hit(inv_dto)
    if not found and not file_hit:
      continue

    row = db.query(Invoice).filter(Invoice.id == inv_id).first()
    if not row:
      continue
    row.amount_paid = _dec(row.total)
    row.is_paid = True
    reason = "file_pagamenti"
    movement_id = None
    if found:
      reason = "numero_in_movimento" if num else "matched"
      movement_id = int(found.id)
      if (
        found.reconciliation_status == "unmatched"
        and found.movement_type == "uscita"
        and not found.matched_invoice_id
      ):
        found.reconciliation_status = "matched"
        found.matched_invoice_id = inv_id
        found.difference_amount = None
    else:
      marked_from_file += 1
    changed = True
    item = {
      "invoice_id": inv_id,
      "invoice_number": num,
      "reason": reason,
    }
    if movement_id is not None:
      item["movement_id"] = movement_id
    if file_hit:
      item["pagamenti_sheet"] = file_hit.get("sheet")
      item["pagamenti_payment_date"] = file_hit.get("payment_date")
    marked.append(item)

  # Riapri «pagate» senza prova: niente PAGATO DARE e niente banca n.+importo
  for inv_dto in paid_listed:
    inv_id = int(getattr(inv_dto, "id"))
    num = str(getattr(inv_dto, "invoice_number", None) or "").strip()
    found = _bank_hit(inv_dto)
    file_hit = _file_paid_hit(inv_dto)
    in_file = supplier_payments_service.workbook_has_invoice_number(
      file_rows, invoice_number=num
    )
    # Prova solida = PAGATO DARE oppure bonifico n.+importo
    if found or file_hit:
      continue
    # N. assente dal file società, oppure presente solo in PAGARE (AVERE) → da pagare
    row = db.query(Invoice).filter(Invoice.id == inv_id).first()
    if not row:
      continue
    row.amount_paid = Decimal("0.00")
    row.is_paid = False
    for meta in mov_meta:
      mov = meta["mov"]
      if mov.matched_invoice_id == inv_id:
        mov.matched_invoice_id = None
        mov.reconciliation_status = "unmatched"
        mov.difference_amount = None
    changed = True
    reopened.append(
      {
        "invoice_id": inv_id,
        "invoice_number": num,
        "reason": "not_in_file" if not in_file else "pagare_avere_only",
      }
    )

  if changed:
    db.commit()

  da_pagare_count = max(0, len(unpaid) - len(marked) + len(reopened))
  return {
    "ok": True,
    "company": company_id or "",
    "marked_paid": len(marked),
    "marked_from_pagamenti": marked_from_file,
    "reopened_unpaid": len(reopened),
    "da_pagare": da_pagare_count,
    "accounts_checked": len(account_ids),
    "pagamenti_paid_rows": len(paid_file_rows),
    "pagamenti_document_rows": len(file_rows),
    "items": marked,
    "reopened_items": reopened[:80],
  }


def auto_reconcile(
  db: Session,
  company: Optional[str] = None,
  limit: int = 80,
) -> Dict[str, Any]:
  """Applica automaticamente i match sicuri (n. documento o importo esatto), poi ricalcola l'anteprima."""
  preview = reconciliation_preview(db, limit=limit, company=company)
  applied: List[Dict[str, Any]] = []
  errors: List[Dict[str, Any]] = []

  for sug in preview.get("suggestions") or []:
    inv = sug.get("suggested_invoice") or {}
    mov = sug.get("movement") or {}
    mov_id = mov.get("id")
    inv_id = inv.get("invoice_id")
    quality = inv.get("match_quality")
    status = sug.get("status")
    # Match sicuri: n. documento con importo allineato, oppure importo esatto + fornitore in causale
    if quality == "number" and status == "matched":
      apply_status = "matched"
    elif quality == "exact" and status == "matched":
      apply_status = "matched"
    else:
      continue
    if not mov_id or not inv_id:
      continue
    try:
      apply_match(db, int(mov_id), int(inv_id), apply_status)
      applied.append(
        {
          "movement_id": int(mov_id),
          "invoice_id": int(inv_id),
          "invoice_number": inv.get("invoice_number"),
          "match_quality": quality or "exact",
        }
      )
    except Exception as e:  # noqa: BLE001 — continua con gli altri match
      errors.append({"movement_id": mov_id, "invoice_id": inv_id, "error": str(e)})

  # Copre anche movimenti già collegati / non in suggestion: n. documento → pagata
  bank_sync = sync_payment_status_from_bank(db, company=company)

  refreshed = reconciliation_preview(db, limit=limit, company=company)
  refreshed["auto_applied"] = len(applied) + int(bank_sync.get("marked_paid") or 0)
  refreshed["auto_applied_items"] = applied + list(bank_sync.get("items") or [])
  refreshed["auto_errors"] = errors
  refreshed["bank_sync"] = bank_sync
  return refreshed


def apply_match(db: Session, movement_id: int, invoice_id: Optional[int], status: str = "matched") -> Dict[str, Any]:
  mov = db.query(BankMovement).filter(BankMovement.id == movement_id).first()
  if not mov:
    raise ValueError("Movimento non trovato")
  if status not in {"matched", "unmatched", "difference"}:
    raise ValueError("Stato non valido")
  prev_invoice_id = mov.matched_invoice_id
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
    # Scollega: ripristina da pagare se non resta altro match valido
    if status == "unmatched" and prev_invoice_id:
      still = (
        db.query(BankMovement)
        .filter(
          BankMovement.matched_invoice_id == prev_invoice_id,
          BankMovement.id != mov.id,
          BankMovement.reconciliation_status.in_(("matched", "difference")),
        )
        .first()
      )
      if not still:
        inv = db.query(Invoice).filter(Invoice.id == prev_invoice_id).first()
        if inv:
          inv.amount_paid = Decimal("0.00")
          inv.is_paid = False
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
