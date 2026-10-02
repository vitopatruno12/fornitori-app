from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from itertools import combinations
from typing import Any, Dict, List, Optional, Sequence, Tuple
import bisect
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
  linked_invoices: Optional[List[Dict[str, Any]]] = None,
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
  if linked_invoices is not None:
    out["linked_invoices"] = linked_invoices
  elif invoice is not None:
    out["linked_invoices"] = [out["matched_invoice"]]
  else:
    out["linked_invoices"] = []
  return _enrich_movement_out(out, row)


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
  deactivate_unlinked_duplicate_accounts(db)
  rows = db.query(BankAccount).filter(BankAccount.is_active.is_(True)).order_by(BankAccount.id.asc()).all()
  return [_account_out(r) for r in rows]


def create_account(db: Session, payload: Dict[str, Any]) -> Dict[str, Any]:
  company = (payload.get("company") or "").strip() or None
  ledger_code = (payload.get("ledger_code") or "1100").strip() or "1100"
  iban_n = normalize_iban(payload.get("iban"))
  if iban_n:
    for existing in db.query(BankAccount).order_by(BankAccount.id.asc()).all():
      if normalize_iban(existing.iban) == iban_n:
        # Non ricreare seed già presenti (anche se disattivati come duplicati).
        return _account_out(existing)
  row = BankAccount(
    bank_name=(payload.get("bank_name") or "Banca").strip() or "Banca",
    account_name=(payload.get("account_name") or "Conto corrente").strip() or "Conto corrente",
    iban=iban_n or ((payload.get("iban") or "").strip() or None),
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
    if target == "mediazione_z" and iban_n == normalize_iban("IT06B0844516000000000972450"):
      if "mediazione z" not in name_l:
        row.account_name = "Mediazione Z · BCC Terra d'Otranto"
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
    "account_name": "Mediazione Z · BCC Terra d'Otranto",
    "iban": "IT06B0844516000000000972450",
    "company": "mediazione_z",
    "ledger_code": "1100",
    "notes": "MEDIAZIONE Z · BCC Terra d'Otranto · IBAN IT06B0844516000000000972450",
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
  # Include anche is_active=False: altrimenti un seed disattivato (duplicato) verrebbe ricreato.
  rows = db.query(BankAccount).all()
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


def _bank_family_key(row: BankAccount) -> str:
  bank = f"{row.bank_name or ''} {row.account_name or ''} {row.notes or ''}".lower()
  iban = normalize_iban(row.iban)
  if (
    "bppb" in bank
    or "puglia" in bank
    or "basilicata" in bank
    or iban in {"IT25D0538516000CC1410004514", "IT55B0538516000CC1410004512", "IT25D0538516000CC410004514"}
  ):
    return "bppb"
  if (
    "bcc" in bank
    or "terra d" in bank
    or "bellegra" in bank
    or iban in {"IT37M0844516000000000967252", "IT06B0844516000000000972450"}
  ):
    return "bcc"
  if "intesa" in bank or "sanpaolo" in bank or iban == "IT88N0306979822100000008926":
    return "intesa"
  if "unicredit" in bank or iban == "IT48Q0200816005000105294153":
    return "unicredit"
  return f"iban:{iban}" if iban else f"id:{row.id}"


def deactivate_unlinked_duplicate_accounts(db: Session) -> int:
  """Disattiva seed non collegati a saldo 0 se esiste già un conto collegato stessa società+banca."""
  rows = db.query(BankAccount).filter(BankAccount.is_active.is_(True)).order_by(BankAccount.id.asc()).all()
  connected_keys: set[str] = set()
  connected_ibans: set[str] = set()
  for row in rows:
    connected = bool(getattr(row, "eb_account_uid", None)) or (row.connection_status or "") == "connected"
    if not connected:
      continue
    company = (row.company or "").strip().lower() or "condiviso"
    connected_keys.add(f"{company}|{_bank_family_key(row)}")
    iban = normalize_iban(row.iban)
    if iban:
      connected_ibans.add(iban)

  deactivated = 0
  for row in rows:
    connected = bool(getattr(row, "eb_account_uid", None)) or (row.connection_status or "") == "connected"
    if connected:
      continue
    saldo = abs(_dec(row.saldo_disponibile))
    if saldo > Decimal("0.009"):
      continue
    company = (row.company or "").strip().lower() or "condiviso"
    iban = normalize_iban(row.iban)
    twin = (iban and iban in connected_ibans) or (f"{company}|{_bank_family_key(row)}" in connected_keys)
    if not twin:
      continue
    row.is_active = False
    row.connection_status = "disconnected"
    deactivated += 1
  if deactivated:
    db.commit()
  return deactivated


def accounts_for_company(db: Session, company: Optional[str] = None) -> List[Dict[str, Any]]:
  """Conti per società: IBAN/tag noti — niente fallback su tutti i conti condivisi."""
  ensure_default_account(db)
  ensure_canonical_bank_accounts(db)
  ensure_known_account_companies(db)
  deactivate_unlinked_duplicate_accounts(db)
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

  # Aggiorna saldi da movimenti SOLO se il conto non è collegato a Enable Banking
  # (altrimenti sovrascriverebbe il saldo reale Intesa, es. €12.000 → €934)
  if not (account.eb_account_uid or "").strip():
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
  lookup_tokens: List[str] = []
  for m, _ in rows:
    lookup_tokens.extend(_parse_linked_invoices_note(getattr(m, "notes", None)))
    if not _parse_linked_invoices_note(getattr(m, "notes", None)):
      lookup_tokens.extend(extract_invoice_digit_tokens(_movement_search_blob(m)))

  invoices_by_id: Dict[int, Invoice] = {}
  invoices_by_norm: Dict[str, Invoice] = {}
  suppliers_by_id: Dict[int, str] = {}

  if invoice_ids:
    inv_rows = db.query(Invoice).filter(Invoice.id.in_(invoice_ids)).all()
    for inv in inv_rows:
      invoices_by_id[inv.id] = inv
      key = _normalize_doc_token(str(inv.invoice_number or ""))
      if key:
        invoices_by_norm[key] = inv

  digit_cores = sorted(
    {
      re.sub(r"\D", "", tok)
      for tok in lookup_tokens
      if len(re.sub(r"\D", "", tok)) >= 4
    },
    key=len,
    reverse=True,
  )
  if digit_cores:
    clauses = [Invoice.invoice_number.ilike(f"%{core}%") for core in digit_cores[:80]]
    if clauses:
      for inv in db.query(Invoice).filter(or_(*clauses)).limit(2500).all():
        invoices_by_id[inv.id] = inv
        key = _normalize_doc_token(str(inv.invoice_number or ""))
        if key:
          invoices_by_norm[key] = inv

  supplier_ids = {inv.supplier_id for inv in invoices_by_id.values() if inv.supplier_id}
  if supplier_ids:
    suppliers_by_id = {
      s.id: s.name
      for s in db.query(Supplier).filter(Supplier.id.in_(supplier_ids)).all()
    }

  out_rows: List[Dict[str, Any]] = []
  for m, a in rows:
    matched = invoices_by_id.get(m.matched_invoice_id) if m.matched_invoice_id else None
    sn = None
    if matched is not None and matched.supplier_id:
      sn = suppliers_by_id.get(matched.supplier_id)
    linked = _build_linked_invoices(
      m,
      matched=matched,
      supplier_name=sn,
      account=a,
      invoices_by_norm=invoices_by_norm,
      suppliers_by_id=suppliers_by_id,
    )
    # Se abbiamo più fatture ma matched_invoice assente, usa la prima come primaria in UI
    primary = matched
    primary_sn = sn
    if primary is None and linked:
      first_id = linked[0].get("id")
      if first_id and first_id in invoices_by_id:
        primary = invoices_by_id[first_id]
        if primary.supplier_id:
          primary_sn = suppliers_by_id.get(primary.supplier_id)
    out_rows.append(
      _movement_out(
        m,
        a,
        primary,
        primary_sn,
        linked_invoices=linked,
      )
    )
  return out_rows


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

  company_labels = {
    "mediazione_a": "Mediazione A · Mani in Pasta Abba",
    "mediazione_z": "Mediazione Z · Mani in Pasta Zanardelli",
    "via_lattea": "Via Lattea · Mucche Volanti",
    "risacca": "Risacca · Bar Momento",
    "pg": "PG · Gazza Ladra",
    "condiviso": "Condiviso",
  }
  company_order = ["mediazione_a", "mediazione_z", "via_lattea", "risacca", "pg", "condiviso"]
  grouped: Dict[str, List[Dict[str, Any]]] = {}
  for account in accounts:
    cid = str(account.get("company") or "").strip().lower() or "condiviso"
    grouped.setdefault(cid, []).append(account)
  societa = []
  for cid in company_order:
    rows = grouped.get(cid) or []
    if not rows:
      continue
    ids = [int(a["id"]) for a in rows if a.get("id")]
    id_set = set(ids)
    ent_c = Decimal("0.00")
    usc_c = Decimal("0.00")
    ultimi_c: List[Dict[str, Any]] = []
    if ids and mov_count:
      ent_c = _dec(
        db.query(func.coalesce(func.sum(BankMovement.amount), 0))
        .filter(
          BankMovement.bank_account_id.in_(ids),
          BankMovement.movement_date == today,
          BankMovement.movement_type == "entrata",
        )
        .scalar()
      )
      usc_c = _dec(
        db.query(func.coalesce(func.sum(BankMovement.amount), 0))
        .filter(
          BankMovement.bank_account_id.in_(ids),
          BankMovement.movement_date == today,
          BankMovement.movement_type == "uscita",
        )
        .scalar()
      )
      ultimi_c = [
        m
        for m in list_movements(db, limit=80)
        if int(m.get("bank_account_id") or 0) in id_set
      ][:3]
    saldo_c = sum((_dec(a.get("saldo_disponibile")) for a in rows), Decimal("0.00"))
    societa.append(
      {
        "company": cid,
        "label": company_labels.get(cid, cid),
        "saldo": float(saldo_c),
        "entrate_oggi": float(ent_c),
        "uscite_oggi": float(usc_c),
        "conti": [
          {
            "id": a.get("id"),
            "label": a.get("label") or a.get("account_name") or a.get("bank_name"),
            "bank_name": a.get("bank_name"),
            "iban": a.get("iban"),
            "saldo_disponibile": a.get("saldo_disponibile"),
            "connection_status": a.get("connection_status"),
          }
          for a in rows
        ],
        "ultimi_movimenti": ultimi_c,
      }
    )

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
    "societa": societa,
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


def _as_date(value: Any) -> Optional[date]:
  if value is None:
    return None
  if isinstance(value, datetime):
    return value.date()
  if isinstance(value, date):
    return value
  text = str(value).strip()[:10]
  if len(text) >= 10 and text[4] == "-" and text[7] == "-":
    try:
      return date.fromisoformat(text[:10])
    except ValueError:
      return None
  return None


def _dates_compatible(inv: Any, mov: Any, *, max_days: int = 365) -> bool:
  """Bonifico non prima della fattura (tolleranza 3 gg) e entro max_days (pagamenti ritardati)."""
  inv_d = _as_date(getattr(inv, "invoice_date", None))
  mov_d = _as_date(getattr(mov, "movement_date", None))
  if not inv_d or not mov_d:
    return False
  delta = (mov_d - inv_d).days
  return -3 <= delta <= max_days


def _date_match_points(inv: Any, mov: Any) -> int:
  """Punti data: fino a 180 gg pieni; intorno alla scadenza; metà fino a 365 gg."""
  inv_d = _as_date(getattr(inv, "invoice_date", None))
  due_d = _as_date(getattr(inv, "due_date", None))
  mov_d = _as_date(getattr(mov, "movement_date", None))
  if not inv_d or not mov_d:
    return 0
  delta_inv = (mov_d - inv_d).days
  if delta_inv < -3:
    return 0
  if due_d:
    delta_due = (mov_d - due_d).days
    # Tipico: pagata vicino alla scadenza o nelle settimane successive
    if -21 <= delta_due <= 90:
      return _SCORE_DATE
    if -45 <= delta_due <= 180:
      return _SCORE_DATE
  if delta_inv <= 180:
    return _SCORE_DATE
  if delta_inv <= 365:
    return 5
  return 0


_BENE_LABEL_RE = re.compile(
  r"(?:"
  r"A\s+FAVORE\s+DI|"
  r"IN\s+FAVORE\s+DI|"
  r"A\s+FAV\.?\s+DI|"
  r"VS\.?\s*FAV(?:ORE)?\.?|"
  r"BENEFICIARI[OA]|"
  r"BENEF\.?|"
  r"BEN\.|"
  r"DESTINATARIO|"
  r"CREDITORE|"
  r"FORNITORE"
  r")\s*[:\-]?\s*",
  re.IGNORECASE,
)
_BENE_STOP_RE = re.compile(
  r"\b(?:IBAN|CRO|CRI|TRN|CAUSALE|CAUS\.|IMPORTO|EUR|EURO|COMMISSION\w*|"
  r"RIF(?:ERIMENTO)?\.?|FATT(?:URA)?|FT\.?|COD(?:ICE)?|SEPA|ISTANTANEO|"
  r"DISPOSTO|ADDEBITO|BONIFICO|PAGAMENTO)\b",
  re.IGNORECASE,
)
_BENE_GENERIC_RE = re.compile(
  r"^(?:bonifico|pagamento|addebito|sepa|disposizione|movimento|storno|commissione)\b",
  re.IGNORECASE,
)


def _trim_beneficiary(raw: str) -> str:
  text = re.sub(r"\s+", " ", str(raw or "")).strip(" ·|-:;,.\"'")
  if not text:
    return ""
  cut = _BENE_STOP_RE.search(text)
  if cut and cut.start() >= 3:
    text = text[: cut.start()]
  text = re.sub(r"\s+", " ", text).strip(" ·|-:;,.\"'")
  words = text.split()
  if len(words) > 8:
    text = " ".join(words[:8])
  letters = re.sub(r"[^A-Za-zÀ-ÿ]", "", text)
  if len(letters) < 4 or _BENE_GENERIC_RE.match(text):
    return ""
  return text[:120]


def _extract_beneficiary_name(text: str) -> str:
  """Nome beneficiario del bonifico, dalla causale del movimento."""
  flat = re.sub(r"\s+", " ", str(text or "")).strip()
  if not flat:
    return ""
  labeled = _BENE_LABEL_RE.search(flat)
  if labeled:
    name = _trim_beneficiary(flat[labeled.end() :])
    if name:
      return name
  parts = [p.strip() for p in re.split(r"\s+[·|]\s+", flat) if p.strip()]
  for part in parts:
    if _BENE_GENERIC_RE.match(part):
      continue
    name = _trim_beneficiary(part)
    if name and not _BENE_LABEL_RE.match(name):
      return name
  return ""


def _movement_beneficiary(mov: Any = None, blob: str = "") -> str:
  """Stesso nominativo della colonna Beneficiario in Movimenti (counterparty)."""
  stored = str(getattr(mov, "counterparty", "") or "").strip() if mov is not None else ""
  if stored and not _BENE_GENERIC_RE.match(stored):
    return _trim_beneficiary(stored) or stored[:120]
  raw = blob
  if not raw and mov is not None:
    raw = _movement_search_blob(mov)
  return _extract_beneficiary_name(raw)


def _party_compact(name: Optional[str]) -> str:
  raw = re.sub(r"[^A-Z0-9]", "", (name or "").upper())
  for stop in ("UNIPERSONALE", "SOCIETA", "SRLS", "SRL", "SPA", "SNC", "SAS", "COOP"):
    raw = raw.replace(stop, "")
  return raw


def _party_name_tokens(name: Optional[str]) -> List[str]:
  raw = re.sub(r"[^A-Z0-9]+", " ", (name or "").upper())
  extra_stop = {"dei", "del", "della", "delle", "degli", "di", "da", "the", "and"}
  return [
    t
    for t in raw.split()
    if len(t) >= 3 and t.lower() not in _BANK_NAME_STOPWORDS and t.lower() not in extra_stop and not t.isdigit()
  ]


def _party_names_align(supplier_name: Optional[str], beneficiary: str) -> bool:
  left = _party_name_tokens(supplier_name)
  right = _party_name_tokens(beneficiary)
  if not left or not right:
    # Sigle spezzate: «FR. E VA. SRL» non ha token lunghi, ma il compatto FREVA sì.
    left_c = _party_compact(supplier_name)
    right_c = _party_compact(beneficiary)
    return len(left_c) >= 5 and (left_c in right_c or right_c in left_c)
  shared = set(left) & set(right)
  if shared:
    shorter = left if len(left) <= len(right) else right
    if len(shared) >= max(1, (len(shorter) + 1) // 2):
      return True
    if max(len(token) for token in shared) >= 6:
      return True
  joined_l = "".join(left)
  joined_r = "".join(right)
  return len(joined_l) >= 5 and (joined_l in joined_r or joined_r in joined_l)


_DOC_REF_RE = re.compile(
  r"(?:FATTURA|FATT\.?|FT\.?|N\.?\s*FATT\.?|DOC(?:UMENTO)?|N\.?\s*DOC)\s*[:.\-]?\s*"
  r"([A-Z0-9][A-Z0-9/\-]{2,24})",
  re.IGNORECASE,
)


_FT_ANCHOR_RE = re.compile(
  r"(?<![A-Z0-9])(?:SALDO\s+)?(?:FATTURE|FATTURA|FT\.?)(?![A-Z0-9])\s*(?:N\.?\s*)?",
  re.IGNORECASE,
)
_FT_NOTE_STOP_RE = re.compile(
  r"COMMIS|ADDEBITO|VOSTRA\s+DISPOSIZIONE|ID\.?\s*BON|C\.\s*BENEF|\bNOTE\s*:",
  re.IGNORECASE,
)


def extract_invoice_refs(blob: str) -> List[str]:
  """Numeri fattura scritti nella causale (SALDO FT '8947/01' '7684/01', 4952-4953, …)."""
  text = re.sub(r"\s+", " ", str(blob or ""))
  refs: List[str] = []
  seen: set[str] = set()
  for match in _FT_ANCHOR_RE.finditer(text):
    chunk = text[match.end(): match.end() + 220]
    stop = _FT_NOTE_STOP_RE.search(chunk)
    if stop:
      chunk = chunk[: stop.start()]
    for ref in _tokenize_invoice_refs(chunk):
      key = ref.upper()
      if key in seen:
        continue
      seen.add(key)
      refs.append(ref)
  return refs


_INVOICE_DIGIT_TOKEN_RE = re.compile(
  r"(?<!\d)(\d{2,8}(?:\s*[/-]\s*\d{1,4})?)(?!\d)",
)


def invoice_ref_digits(value: Optional[str]) -> str:
  """Solo cifre (e / - tra gruppi), senza lettere/etichette."""
  raw = str(value or "").strip()
  if not raw:
    return ""
  parts = re.findall(r"\d+(?:[/-]\d+)*", raw)
  return ", ".join(parts) if parts else ""


def extract_invoice_digit_tokens(blob: str) -> List[str]:
  """Token numerici fattura: prima da ancore FT/SALDO, poi cifre isolate in causale.

  Esclude anni (20xx) e riferimenti bancari troppo lunghi (CRO/PV).
  """
  primary = extract_invoice_refs(blob)
  out: List[str] = []
  seen: set[str] = set()

  def add(token: str) -> None:
    cleaned = invoice_ref_digits(token) or str(token or "").strip()
    if not cleaned:
      return
    # un solo gruppo principale
    first = cleaned.split(",")[0].strip()
    digits = re.sub(r"\D", "", first)
    if len(digits) < 2 or len(digits) > 12:
      return
    if re.fullmatch(r"20\d{2}", digits):
      return
    key = _normalize_doc_token(first)
    if not key or key in seen:
      return
    seen.add(key)
    out.append(first)

  for ref in primary:
    add(ref)
  if out:
    return out

  text = re.sub(r"\s+", " ", str(blob or ""))
  # Evita «saldo agosto» senza numeri utili
  lower = text.lower()
  if re.search(r"saldo\s+(?:ft|fattur)", lower) and not re.search(r"\d{2,}", text):
    return []
  for match in _INVOICE_DIGIT_TOKEN_RE.finditer(text):
    add(match.group(1))
  return out


def _tokenize_invoice_refs(chunk: str) -> List[str]:
  chunk = (chunk or "").strip(" .:-")
  chunk = re.sub(r"\b(20\d)\s+(\d)\b", r"\1\2", chunk)
  if not re.search(r"\d", chunk):
    return []
  # «saldo fatture agosto» o «dal 17 al 31 luglio»: periodo, non un elenco di numeri.
  scrub = re.sub(
    r"(?i)\b(?:dal|da|al|a|del|di)\s+\d{1,2}(?:\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre))?(?:\s+20\d{2})?",
    " ",
    chunk,
  )
  scrub = re.sub(
    r"(?i)\b(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b(?:\s+20\d{2})?",
    " ",
    scrub,
  )
  scrub = re.sub(r"\b20\d{2}\b", " ", scrub)
  if not re.search(r"\d", scrub):
    return []
  leftovers = re.findall(r"\d+", scrub)
  if leftovers and all(re.fullmatch(r"20\d{0,2}", n) for n in leftovers):
    return []
  found: List[str] = []

  def add(token: str) -> None:
    token = re.sub(r"\s+", "", str(token or "")).strip(" .'\"-/")
    if not token or not re.search(r"\d", token):
      return
    if re.fullmatch(r"20\d{2}", token):
      return
    digits = re.sub(r"\D", "", token)
    if len(digits) < 2 or len(digits) > 12:
      return
    found.append(token.upper())

  for quoted in re.findall(r"'([^']{1,40})'", chunk):
    piece = quoted.strip()
    if re.fullmatch(r"\d+(?:-\d+)+", re.sub(r"\s+", "", piece)):
      for part in re.split(r"\s*-\s*", piece):
        add(part)
    else:
      add(piece)

  rest = re.sub(r"'[^']*'", " ", chunk)
  rest = re.sub(r"(?i)\bdel\s+\d{1,2}(?:\s+[a-zàèéìòù]+)?(?:\s+\d{4})?", " ", rest)
  rest = re.split(r"(?i)\bal\s+netto\b", rest)[0]
  rest = re.sub(r"(\d{1,3})\s+(\d{3,})", r"\1\2", rest)
  rest = re.sub(r"(?i)\b(?:saldo|fatture|fattura|n)\b", " ", rest)
  rest = re.sub(r"\s+", " ", rest).strip(" .:-")
  if re.fullmatch(r"[A-Z]{1,4}-?\d[\w/\-]*", rest, re.IGNORECASE) and not re.fullmatch(
    r"\d+(?:-\d+)+", rest
  ):
    add(rest)
    rest = ""
  for part in re.split(r"[\s,;]+|\s+\be\b\s+|(?<=\d)\s*-\s*(?=\d)", rest):
    part = re.split(r"(?i)id\.?", part.strip(" .-'/"))[0]
    matched = re.match(r"([A-Z]{0,4}\d[\w./\-]{0,30})", part, re.IGNORECASE)
    if not matched:
      continue
    token = matched.group(1).strip("./-")
    if re.fullmatch(r"\d+(?:-\d+)+", token):
      for piece in token.split("-"):
        add(piece)
    else:
      add(token)
  if len(found) > 1 and len(re.sub(r"\D", "", found[-1])) <= 1:
    found = found[:-1]
  out: List[str] = []
  seen: set[str] = set()
  for token in found:
    if token in seen:
      continue
    seen.add(token)
    out.append(token)
  return out


def _ref_matches_number(ref: str, invoice_number: Optional[str]) -> bool:
  ref_s = re.sub(r"\s+", "", (ref or "").upper())
  num_s = re.sub(r"\s+", "", (invoice_number or "").upper())
  if not ref_s or not num_s:
    return False
  if ref_s == num_s:
    return True
  if num_s.startswith(ref_s) and num_s[len(ref_s):len(ref_s) + 1] in {"/", "-", "."}:
    return True
  if len(ref_s) >= 8 and num_s.startswith(ref_s):
    return True
  return False


def _extract_doc_ref(blob: str) -> str:
  """Numero fattura citato nella causale del bonifico."""
  refs = extract_invoice_refs(blob)
  if refs:
    return ", ".join(refs)[:80]
  match = _DOC_REF_RE.search(str(blob or ""))
  if not match:
    return ""
  token = match.group(1).strip(" .-")
  if len(_normalize_doc_token(token)) < 3:
    return ""
  return token[:40]


def _extract_bonifico_ref(blob: str) -> Optional[str]:
  """Ricava CRO / CRI / TRN / ID bonifico (anche Enable Banking) dalla causale/note."""
  text = str(blob or "")
  if not text.strip():
    return None
  patterns = (
    r"\bCRO[\s.:/-]*([A-Z0-9]{6,35})\b",
    r"\bCRI[\s.:/-]*([A-Z0-9]{6,35})\b",
    r"\bTRN[\s.:/-]*([A-Z0-9]{6,35})\b",
    r"\bE2E[\s.:/-]*([A-Z0-9]{6,35})\b",
    r"\bEND[\s\-]?TO[\s\-]?END(?:[\s\-]?ID)?[\s.:/-]*([A-Z0-9]{6,35})\b",
    r"\bID[\s.:/-]*BON(?:IFICO)?[\s.:/-]*([A-Z0-9]{6,35})\b",
    r"\bBON(?:IFICO)?[\s.:/-]*N?[°.]?\s*([A-Z0-9]{6,35})\b",
    r"\bRIF(?:ERIMENTO)?[\s.:/-]*(?:BON(?:IFICO)?)?[\s.:/-]*([A-Z0-9]{6,35})\b",
    # Sync Enable Banking: notes = "Enable Banking · id=…"
    r"(?:Enable Banking\s*[·•\-]?\s*)?id=([A-Za-z0-9._\-]{6,64})",
  )
  up = text.upper()
  for pat in patterns:
    m = re.search(pat, up, re.IGNORECASE)
    if m:
      ref = str(m.group(1) or "").strip(" .-_/")
      if len(ref) >= 6:
        return ref[:40]
  return None


def _movement_amount_matches_invoice(inv: Any, mov: Any) -> bool:
  total = abs(_dec(getattr(inv, "total", 0)))
  amt = abs(_dec(getattr(mov, "amount", 0)))
  if total <= Decimal("0.009") or amt <= Decimal("1.00"):
    return False
  paid = abs(_dec(getattr(inv, "amount_paid", 0)))
  residuo = abs(total - paid)
  if residuo <= Decimal("0.009"):
    residuo = total
  if abs(total - amt) <= Decimal("0.05") or abs(residuo - amt) <= Decimal("0.05"):
    return True
  # Anche match diretto sull'importo già registrato come pagato
  if paid > Decimal("0.009") and abs(paid - amt) <= Decimal("0.05"):
    return True
  return False


# Pesi score riconciliazione (totale 100)
_SCORE_AMOUNT = 40
_SCORE_PARTY = 30
_SCORE_NUMBER = 20
_SCORE_DATE = 10
_SCORE_AUTO = 80  # riconcilia subito
_SCORE_PROBABLE = 70  # proposta / one-click
_AMOUNT_FEE_TOLERANCE = Decimal("2.00")  # abbuono/commissione


def _invoice_residuo(inv: Any) -> Decimal:
  total = abs(_dec(getattr(inv, "total", 0)))
  paid = abs(_dec(getattr(inv, "amount_paid", 0)))
  residuo = total - paid
  if residuo <= Decimal("0.009"):
    return Decimal("0.00")
  return residuo


def _score_amount_vs_targets(amt: Decimal, targets: List[tuple[str, Decimal]]) -> Dict[str, Any]:
  """Confronta l'importo banca con residuo / totale / importo pagato.

  Ritorna points (0–40), partial, best diff e quale target ha vinto.
  """
  best_points = 0
  best_diff: Optional[Decimal] = None
  best_label = ""
  partial = False
  if amt <= Decimal("1.00"):
    return {"points": 0, "partial": False, "diff": None, "matched_as": None}

  for label, target in targets:
    if target is None or target <= Decimal("0.009"):
      continue
    diff = abs(target - amt)
    if best_diff is None or diff < best_diff:
      best_diff = diff
    points = 0
    is_partial = False
    if diff <= Decimal("0.05"):
      points = _SCORE_AMOUNT
    elif diff <= _AMOUNT_FEE_TOLERANCE:
      points = 25
    elif amt < target - Decimal("0.05") and amt >= target * Decimal("0.4"):
      points = 15
      is_partial = True
    if points > best_points:
      best_points = points
      best_label = label
      partial = is_partial
      best_diff = diff
    elif points == best_points and points > 0 and (best_diff is None or diff < best_diff):
      best_label = label
      partial = is_partial
      best_diff = diff

  return {
    "points": best_points,
    "partial": partial if best_points > 0 else False,
    "diff": best_diff,
    "matched_as": best_label or None,
  }


def score_movement_invoice(inv: Any, mov: Any, blob: str) -> Dict[str, Any]:
  """Score 0–100: importo 40 + anagrafica 30 + n. fattura 20 + data 10.

  bande: auto (≥80), probable (70–79), review (<70).
  L'importo banca viene confrontato con residuo, totale e importo pagato.
  I bonifici ritardati (fino a ~1 anno) restano riconoscibili se importo+fornitore
  o importo+n. documento sono solidi.
  """
  breakdown = {"amount": 0, "party": 0, "number": 0, "date": 0}
  if getattr(mov, "movement_type", None) and str(mov.movement_type).lower() != "uscita":
    return {
      "score": 0,
      "band": "review",
      "breakdown": breakdown,
      "partial": False,
      "amount_diff": None,
      "amount_matched_as": None,
    }

  total = abs(_dec(getattr(inv, "total", 0)))
  paid = abs(_dec(getattr(inv, "amount_paid", 0)))
  residuo = _invoice_residuo(inv)
  amt = abs(_dec(getattr(mov, "amount", 0)))

  amount_targets: List[tuple[str, Decimal]] = []
  if residuo > Decimal("0.009"):
    amount_targets.append(("residuo", residuo))
  if total > Decimal("0.009"):
    amount_targets.append(("totale", total))
  if paid > Decimal("0.009"):
    amount_targets.append(("pagato", paid))
  # Se già saldata, confronta comunque col totale (riverifica bonifico)
  if not amount_targets and total > Decimal("0.009"):
    amount_targets.append(("totale", total))

  amount_hit = _score_amount_vs_targets(amt, amount_targets)
  breakdown["amount"] = int(amount_hit["points"])
  partial = bool(amount_hit["partial"])
  diff = amount_hit["diff"]

  beneficiary = _movement_beneficiary(mov, blob)
  supplier_name = getattr(inv, "supplier_name", None)
  party_hit = bool(beneficiary) and _party_names_align(supplier_name, beneficiary)
  if not party_hit and not beneficiary:
    party_hit = _supplier_in_blob(supplier_name, blob)
  if party_hit:
    breakdown["party"] = _SCORE_PARTY
  else:
    # P.IVA in causale
    vat = str(
      getattr(inv, "supplier_vat", None) or getattr(inv, "vat_number", None) or ""
    ).strip()
    if vat and len(re.sub(r"\D", "", vat)) >= 11:
      vat_digits = re.sub(r"\D", "", vat)
      blob_digits = re.sub(r"\D", "", blob or "")
      if vat_digits and vat_digits in blob_digits:
        breakdown["party"] = _SCORE_PARTY

  num = str(getattr(inv, "invoice_number", None) or "").strip()
  norm = _normalize_doc_token(num)
  has_num = _invoice_number_in_text(num, blob)
  if has_num:
    if len(norm) < 4:
      # numeri corti: solo se c'è anche importo o fornitore
      if breakdown["amount"] >= 25 or breakdown["party"] >= _SCORE_PARTY:
        breakdown["number"] = _SCORE_NUMBER
    else:
      breakdown["number"] = _SCORE_NUMBER

  breakdown["date"] = _date_match_points(inv, mov)

  score = int(sum(breakdown.values()))
  amount_exact = breakdown["amount"] >= _SCORE_AMOUNT
  party_ok = breakdown["party"] >= _SCORE_PARTY
  number_ok = breakdown["number"] >= _SCORE_NUMBER
  date_ok = _dates_compatible(inv, mov, max_days=365)

  # Regole auto per bonifici tipici / ritardati (senza file pagamenti)
  if not partial and date_ok and amount_exact and number_ok and len(norm) >= 4:
    # Importo esatto + n. fattura in causale → prova forte
    score = max(score, _SCORE_AUTO)
  elif not partial and date_ok and amount_exact and party_ok:
    # Importo esatto + beneficiario/fornitore entro 1 anno dalla fattura
    score = max(score, _SCORE_AUTO)
  elif not partial and amount_exact and number_ok and party_ok and len(norm) >= 4:
    # Tre segnali solidi anche se la data è debole
    score = max(score, _SCORE_AUTO)

  if score >= _SCORE_AUTO:
    band = "auto"
  elif score >= _SCORE_PROBABLE:
    band = "probable"
  else:
    band = "review"

  # Numeri corti senza importo forte → mai auto
  if has_num and len(norm) < 4 and breakdown["amount"] < 25:
    if band == "auto":
      band = "probable"
      score = min(score, _SCORE_PROBABLE + 5)

  return {
    "score": score,
    "band": band,
    "breakdown": breakdown,
    "partial": partial,
    "amount_diff": float(diff) if diff is not None else None,
    "amount_matched_as": amount_hit.get("matched_as"),
  }


def _bank_movement_pays_invoice(inv: Any, mov: Any, blob: str) -> bool:
  """True se lo score è almeno auto (≥80): riconciliazione affidabile."""
  return score_movement_invoice(inv, mov, blob)["band"] == "auto"


def _enrich_movement_out(out: Dict[str, Any], mov: Any = None, blob: str = "") -> Dict[str, Any]:
  """Aggiunge beneficiario e n. bonifico/CRO ricavati dalla causale."""
  raw = blob
  if not raw and mov is not None:
    raw = _movement_search_blob(mov)
  enriched = dict(out)
  beneficiary = _movement_beneficiary(mov, raw)
  if beneficiary:
    enriched["beneficiary"] = beneficiary
    if not str(enriched.get("counterparty") or "").strip():
      enriched["counterparty"] = beneficiary
  ref = _extract_bonifico_ref(raw)
  if ref:
    enriched["bonifico_ref"] = ref
  doc_ref = _extract_doc_ref(raw)
  if doc_ref:
    enriched["doc_ref"] = doc_ref
  return enriched


_IT_MONTHS = {
  "gennaio": 1,
  "febbraio": 2,
  "marzo": 3,
  "aprile": 4,
  "maggio": 5,
  "giugno": 6,
  "luglio": 7,
  "agosto": 8,
  "settembre": 9,
  "ottobre": 10,
  "novembre": 11,
  "dicembre": 12,
}
_CREDIT_NOTE_RE = re.compile(r"(?i)(?:^|[^A-Z0-9])NC(?:[^A-Z0-9]|$)")


def _is_credit_note(inv: Any) -> bool:
  num = str(getattr(inv, "invoice_number", None) or "")
  if _CREDIT_NOTE_RE.search(num):
    return True
  return _dec(getattr(inv, "total", 0)) < Decimal("-0.009")


def _saldo_period(blob: str, mov_date: Optional[date]) -> Optional[tuple]:
  """(anno, mese, nome mese) se la causale è un saldo del mese, senza elenco numeri."""
  text = (blob or "").lower()
  if mov_date is None:
    return None
  idx = text.find("saldo fattur")
  if idx < 0:
    short = re.search(r"saldo\s+ft\b", text)
    if not short:
      return None
    # «saldo ft agosto», non «saldo ft 760» o un elenco di numeri.
    after = text[short.end(): short.end() + 48]
    if re.search(r"\d{3,}", after):
      return None
    idx = short.start()
  window = text[idx:idx + 80]
  month = None
  month_name = ""
  for name, num in _IT_MONTHS.items():
    if re.search(rf"\b{name}\b", window):
      month = num
      month_name = name
      break
  if month is None:
    return None
  year = mov_date.year
  if month > mov_date.month:
    year -= 1
  return year, month, month_name


def allocate_saldo_fatture(
  invoices: List[Any],
  mov_meta: List[Dict[str, Any]],
  *,
  skip_invoice_ids: Optional[set] = None,
  skip_movement_ids: Optional[set] = None,
) -> Dict[int, Dict[str, Any]]:
  """Un bonifico «saldo fatture <mese>» che quadra con le fatture del fornitore.

  La nota di credito e la fattura dello stesso importo (quella stornata) restano fuori.
  Un movimento può coprire più fatture. I movimenti già usati 1:1 non vengono toccati.
  """
  skip_inv = set(skip_invoice_ids or ())
  skip_mov = skip_movement_ids if skip_movement_ids is not None else set()
  claimed: set[int] = set()
  out: Dict[int, Dict[str, Any]] = {}

  candidates: List[tuple] = []
  for meta in mov_meta:
    mov = meta["mov"]
    if str(getattr(mov, "movement_type", "") or "").lower() != "uscita":
      continue
    mid = int(getattr(mov, "id") or 0)
    if mid and mid in skip_mov:
      continue
    amt = abs(_dec(getattr(mov, "amount", 0)))
    if amt <= Decimal("1.00"):
      continue
    mov_d = _as_date(getattr(mov, "movement_date", None))
    period = _saldo_period(meta.get("blob") or "", mov_d)
    if not period:
      continue
    beneficiary = _movement_beneficiary(mov, meta.get("blob") or "")
    if not beneficiary:
      continue
    candidates.append((amt, meta, period, beneficiary))

  by_month: Dict[tuple, List[Any]] = {}
  for inv in invoices:
    inv_d = _as_date(getattr(inv, "invoice_date", None))
    if not inv_d:
      continue
    by_month.setdefault((inv_d.year, inv_d.month), []).append(inv)

  candidates.sort(key=lambda item: item[0], reverse=True)
  for amt, meta, (year, month, month_name), beneficiary in candidates:
    month_inv: List[Any] = []
    for inv in by_month.get((year, month), ()):
      iid = int(getattr(inv, "id"))
      if iid in skip_inv or iid in claimed:
        continue
      if not _party_names_align(getattr(inv, "supplier_name", None), beneficiary):
        continue
      month_inv.append(inv)
    chosen: Optional[List[Any]] = None
    for group in _saldo_candidate_groups(month_inv):
      remaining = _saldo_payable(group)
      if remaining is None:
        continue
      total = sum((abs(_dec(getattr(inv, "total", 0))) for inv in remaining), Decimal("0.00"))
      if abs(total - amt) <= Decimal("0.05"):
        chosen = remaining
        break
    if not chosen:
      continue
    mov_id = int(getattr(meta["mov"], "id") or 0)
    if mov_id:
      skip_mov.add(mov_id)
    for inv in chosen:
      iid = int(getattr(inv, "id"))
      claimed.add(iid)
      out[iid] = {"meta": meta, "month_label": month_name, "year": year}
  return out


def _saldo_candidate_groups(month_inv: List[Any]) -> List[List[Any]]:
  """Prima tutte le società insieme, poi una società alla volta."""
  groups = [month_inv]
  buckets: Dict[str, List[Any]] = {}
  for inv in month_inv:
    key = str(getattr(inv, "company", None) or "").strip()
    if key:
      buckets.setdefault(key, []).append(inv)
  if len(buckets) > 1:
    groups.extend(buckets.values())
  return groups


def _saldo_payable(month_inv: List[Any]) -> Optional[List[Any]]:
  credits = [inv for inv in month_inv if _is_credit_note(inv)]
  ordinary = [inv for inv in month_inv if inv not in credits]
  remaining = list(ordinary)
  for cred in credits:
    cred_amt = abs(_dec(getattr(cred, "total", 0)))
    twins = [
      inv
      for inv in remaining
      if abs(abs(_dec(getattr(inv, "total", 0))) - cred_amt) <= Decimal("0.05")
    ]
    if len(twins) != 1:
      return None
    remaining.remove(twins[0])
  if len(remaining) < 2:
    return None
  return remaining


def _invoice_for_ref(ref: str, invoices: List[Any]) -> Optional[Any]:
  hits = [
    inv
    for inv in invoices
    if _ref_matches_number(ref, getattr(inv, "invoice_number", None))
  ]
  if len(hits) == 1:
    return hits[0]
  exact = [
    inv
    for inv in hits
    if re.sub(r"\s+", "", str(getattr(inv, "invoice_number", "") or "")).upper() == re.sub(r"\s+", "", ref).upper()
  ]
  if len(exact) == 1:
    return exact[0]
  return None


def allocate_cited_invoices(
  invoices: List[Any],
  mov_meta: List[Dict[str, Any]],
  *,
  skip_invoice_ids: Optional[set] = None,
  skip_movement_ids: Optional[set] = None,
) -> Dict[int, Dict[str, Any]]:
  """Bonifico che elenca i numeri fattura in causale e la cui somma quadra.

  Se manca anche un solo numero, o la somma non è l'importo del bonifico, non allega.
  """
  skip_inv = set(skip_invoice_ids or ())
  skip_mov = skip_movement_ids if skip_movement_ids is not None else set()
  claimed: set[int] = set()
  out: Dict[int, Dict[str, Any]] = {}

  candidates: List[tuple] = []
  for meta in mov_meta:
    mov = meta["mov"]
    if str(getattr(mov, "movement_type", "") or "").lower() != "uscita":
      continue
    mid = int(getattr(mov, "id") or 0)
    if mid and mid in skip_mov:
      continue
    amt = abs(_dec(getattr(mov, "amount", 0)))
    if amt <= Decimal("1.00"):
      continue
    refs = extract_invoice_digit_tokens(meta.get("blob") or "")
    if not refs:
      continue
    beneficiary = _movement_beneficiary(mov, meta.get("blob") or "")
    if not beneficiary:
      continue
    candidates.append((amt, meta, refs, beneficiary))

  candidates.sort(key=lambda item: item[0], reverse=True)
  for amt, meta, refs, beneficiary in candidates:
    pool = []
    for inv in invoices:
      iid = int(getattr(inv, "id"))
      if iid in skip_inv or iid in claimed:
        continue
      if not _party_names_align(getattr(inv, "supplier_name", None), beneficiary):
        continue
      pool.append(inv)
    chosen: List[Any] = []
    seen_ids: set[int] = set()
    complete = True
    for ref in refs:
      inv = _invoice_for_ref(ref, pool)
      if inv is None:
        complete = False
        break
      iid = int(getattr(inv, "id"))
      if iid in seen_ids:
        continue
      seen_ids.add(iid)
      chosen.append(inv)
    if not complete or not chosen:
      continue
    total = sum((abs(_dec(getattr(inv, "total", 0))) for inv in chosen), Decimal("0.00"))
    if abs(total - amt) > Decimal("0.05"):
      continue
    mov_id = int(getattr(meta["mov"], "id") or 0)
    if mov_id:
      skip_mov.add(mov_id)
    for inv in chosen:
      iid = int(getattr(inv, "id"))
      claimed.add(iid)
      out[iid] = {"meta": meta, "cited": True, "refs": refs}
  return out


_NUM_RANGE_RE = re.compile(
  r"(?:dalla|dal)\s+n?\.?\s*(\d{2,8})\s+(?:alla|al)\s+n?\.?\s*(\d{2,8})"
  r"|da\s+n\.?\s*(\d{2,8})\s+a\s+n\.?\s*(\d{2,8})",
  re.IGNORECASE,
)


def _invoice_leading_number(invoice_number: Optional[str]) -> Optional[int]:
  match = re.match(r"\D*(\d{2,8})", str(invoice_number or ""))
  if not match:
    return None
  return int(match.group(1))


def invoice_named_on_group_wire(inv: Any, mov: Any, blob: str) -> bool:
  """Un saldo di gruppo tiene pagata solo la fattura scritta in causale, non tutto il fornitore."""
  beneficiary = _movement_beneficiary(mov, blob)
  supplier = getattr(inv, "supplier_name", None)
  if beneficiary and not _party_names_align(supplier, beneficiary):
    return False
  num = str(getattr(inv, "invoice_number", None) or "").strip()
  if not num:
    return False
  for ref in extract_invoice_digit_tokens(blob):
    if _ref_matches_number(ref, num):
      return True
  text = blob or ""
  if "saldo" in text.lower():
    found = _NUM_RANGE_RE.search(text)
    if found:
      nums = [int(group) for group in found.groups() if group]
      if len(nums) == 2:
        lo, hi = sorted(nums)
        lead = _invoice_leading_number(num)
        if lead is not None and lo <= lead <= hi:
          return True
  return False


def _invoice_protected_by_bank_evidence(inv_dto: Any, mov_meta: List[Dict[str, Any]]) -> bool:
  """True se un bonifico matched prova il pagamento (FK, nota multi-fattura, numeri in causale)."""
  inv_id = int(getattr(inv_dto, "id") or 0)
  num = str(getattr(inv_dto, "invoice_number", None) or "").strip()
  num_key = _normalize_doc_token(num)
  supplier = getattr(inv_dto, "supplier_name", None)

  for meta in mov_meta:
    mov = meta["mov"]
    status = str(getattr(mov, "reconciliation_status", "") or "").lower()
    if status not in {"matched", "difference"}:
      continue
    linked = getattr(mov, "matched_invoice_id", None)
    if linked and int(linked) == inv_id:
      return True

    blob = meta.get("blob") or ""
    note_nums = _parse_linked_invoices_note(getattr(mov, "notes", None))
    for raw in note_nums:
      if num_key and _normalize_doc_token(raw) == num_key:
        return True
      if num and _ref_matches_number(raw, num):
        return True

    beneficiary = meta.get("beneficiary") or _movement_beneficiary(mov, blob)
    if beneficiary and supplier and not _party_names_align(supplier, beneficiary):
      continue
    if invoice_named_on_group_wire(inv_dto, mov, blob):
      return True
    if num:
      for ref in extract_invoice_digit_tokens(blob):
        if _ref_matches_number(ref, num):
          return True
  return False


def allocate_number_ranges(
  invoices: List[Any],
  mov_meta: List[Dict[str, Any]],
  *,
  skip_invoice_ids: Optional[set] = None,
  skip_movement_ids: Optional[set] = None,
) -> Dict[int, Dict[str, Any]]:
  """«Dalla n. 7905 alla n. 8764»: allega se la somma di quel intervallo quadra."""
  skip_inv = set(skip_invoice_ids or ())
  skip_mov = skip_movement_ids if skip_movement_ids is not None else set()
  claimed: set[int] = set()
  out: Dict[int, Dict[str, Any]] = {}
  candidates: List[tuple] = []
  for meta in mov_meta:
    mov = meta["mov"]
    if str(getattr(mov, "movement_type", "") or "").lower() != "uscita":
      continue
    mid = int(getattr(mov, "id") or 0)
    if mid and mid in skip_mov:
      continue
    amt = abs(_dec(getattr(mov, "amount", 0)))
    if amt <= Decimal("1.00"):
      continue
    blob = meta.get("blob") or ""
    if "saldo" not in blob.lower():
      continue
    found = _NUM_RANGE_RE.search(blob)
    if not found:
      continue
    nums = [int(g) for g in found.groups() if g]
    if len(nums) != 2:
      continue
    lo, hi = sorted(nums)
    beneficiary = _movement_beneficiary(mov, blob)
    if not beneficiary:
      continue
    candidates.append((amt, meta, lo, hi, beneficiary))
  candidates.sort(key=lambda item: item[0], reverse=True)
  for amt, meta, lo, hi, beneficiary in candidates:
    chosen: List[Any] = []
    for inv in invoices:
      iid = int(getattr(inv, "id"))
      if iid in skip_inv or iid in claimed:
        continue
      if not _party_names_align(getattr(inv, "supplier_name", None), beneficiary):
        continue
      leading = _invoice_leading_number(getattr(inv, "invoice_number", None))
      if leading is None or leading < lo or leading > hi:
        continue
      chosen.append(inv)
    if len(chosen) < 2:
      continue
    total = sum((abs(_dec(getattr(inv, "total", 0))) for inv in chosen), Decimal("0.00"))
    if abs(total - amt) > Decimal("0.05"):
      continue
    mov_id = int(getattr(meta["mov"], "id") or 0)
    if mov_id:
      skip_mov.add(mov_id)
    for inv in chosen:
      iid = int(getattr(inv, "id"))
      claimed.add(iid)
      out[iid] = {"meta": meta, "cited": True, "refs": [str(lo), str(hi)]}
  return out


_SUBSET_POOL_MAX = 20  # C(20,6) ≈ 39k: enumerazione esatta ancora leggera
_SUBSET_CANDIDATE_WIRES = 120
_SUBSET_TOL = Decimal("0.05")


def _subset_pick_best(
  hits: Sequence[Tuple[int, ...]],
  amounts: Sequence[Tuple[Any, Decimal]],
) -> Optional[Tuple[int, ...]]:
  """Tra sottoinsiemi della stessa taglia: preferisci indici contigui, poi span date minimo.

  Se restano più candidati equivalenti → None (ambiguo, non auto-abbinare).
  """
  if not hits:
    return None
  if len(hits) == 1:
    return hits[0]

  def _span_days(idxs: Tuple[int, ...]) -> int:
    dates = [_as_date(getattr(amounts[i][0], "invoice_date", None)) or date.min for i in idxs]
    return (max(dates) - min(dates)).days

  contiguous = [h for h in hits if h[-1] - h[0] == len(h) - 1]
  pool = contiguous if contiguous else list(hits)
  if len(pool) == 1:
    return pool[0]
  best_span = min(_span_days(h) for h in pool)
  tight = [h for h in pool if _span_days(h) == best_span]
  if len(tight) == 1:
    return tight[0]
  return None


def _subset_sum_invoices(
  invoices: List[Any],
  target: Decimal,
  *,
  max_items: int = 6,
  around: Optional[date] = None,
) -> Optional[List[Any]]:
  """Sottoinsieme (2…max_items) la cui somma totale ≈ target (±0,05 €).

  Enumerazione esatta sul pool (no greedy). Preferisce il sottoinsieme più piccolo;
  a parità, fatture consecutive per data / span minimo. Ambiguità → None.
  """
  amounts: List[Tuple[Any, Decimal]] = []
  for inv in invoices:
    residuo = _invoice_residuo(inv)
    amt = residuo if residuo > Decimal("0.009") else abs(_dec(getattr(inv, "total", 0)))
    if amt > Decimal("0.009") and amt <= target + _SUBSET_TOL:
      amounts.append((inv, amt))
  if len(amounts) < 2:
    return None

  if len(amounts) > _SUBSET_POOL_MAX:
    if around is not None:
      amounts.sort(
        key=lambda item: (
          abs(((_as_date(getattr(item[0], "invoice_date", None)) or around) - around).days),
          item[1],
        )
      )
    else:
      amounts.sort(
        key=lambda item: (_as_date(getattr(item[0], "invoice_date", None)) or date.min, item[1])
      )
    amounts = amounts[:_SUBSET_POOL_MAX]

  # Ordine cronologico: serve per preferire blocchi contigui (saldo periodo)
  amounts.sort(key=lambda item: (_as_date(getattr(item[0], "invoice_date", None)) or date.min, item[1]))
  n = len(amounts)
  tol = _SUBSET_TOL
  limit = min(max_items, n)

  full = sum((amt for _, amt in amounts), Decimal("0.00"))
  if abs(full - target) <= tol and 2 <= n <= limit:
    return [inv for inv, _ in amounts]

  for k in range(2, limit + 1):
    hits: List[Tuple[int, ...]] = []
    for idxs in combinations(range(n), k):
      total = sum((amounts[i][1] for i in idxs), Decimal("0.00"))
      if abs(total - target) <= tol:
        hits.append(idxs)
    if not hits:
      continue
    best = _subset_pick_best(hits, amounts)
    if best is None:
      return None
    return [amounts[i][0] for i in best]
  return None


def allocate_supplier_bundles(
  invoices: List[Any],
  mov_meta: List[Dict[str, Any]],
  *,
  skip_invoice_ids: Optional[set] = None,
  skip_movement_ids: Optional[set] = None,
  include_paid: bool = False,
) -> Dict[int, Dict[str, Any]]:
  """Un bonifico = somma di 2+ fatture aperte dello stesso fornitore (beneficiario allineato).

  Copre i pagamenti multipli anche senza testo «saldo fatture <mese>» in causale.
  Con include_paid=True serve a verificare che un gruppo multi resti valido (no riapertura).
  """
  skip_inv = set(skip_invoice_ids or ())
  skip_mov = skip_movement_ids if skip_movement_ids is not None else set()
  claimed: set[int] = set()
  out: Dict[int, Dict[str, Any]] = {}

  pool_src: List[Any] = []
  for inv in invoices:
    iid = int(getattr(inv, "id"))
    if iid in skip_inv:
      continue
    status = (getattr(inv, "payment_status", None) or "unpaid")
    if status == "paid" and not include_paid:
      continue
    residuo = _invoice_residuo(inv)
    total = abs(_dec(getattr(inv, "total", 0)))
    if status == "paid":
      if total <= Decimal("0.009"):
        continue
    elif residuo <= Decimal("0.009") and total <= Decimal("0.009"):
      continue
    pool_src.append(inv)

  candidates: List[tuple] = []
  # Solo uscite ancora unmatched (o matched multi senza id): evita scan su tutto lo storico
  for meta in mov_meta:
    mov = meta["mov"]
    if str(getattr(mov, "movement_type", "") or "").lower() != "uscita":
      continue
    mid = int(getattr(mov, "id") or 0)
    if mid and mid in skip_mov:
      continue
    status = str(getattr(mov, "reconciliation_status", "") or "")
    linked = getattr(mov, "matched_invoice_id", None)
    if not include_paid:
      if status == "matched" and linked:
        continue
      if status not in ("", "unmatched", "matched"):
        continue
    elif status == "matched" and linked:
      continue
    amt = abs(_dec(getattr(mov, "amount", 0)))
    if amt <= Decimal("1.00"):
      continue
    beneficiary = _movement_beneficiary(mov, meta.get("blob") or "")
    if not beneficiary:
      continue
    candidates.append((amt, meta, beneficiary))
  # Priorità ai bonifici più grandi; finestra ampliata per non perdere multi medi
  candidates.sort(key=lambda item: item[0], reverse=True)
  candidates = candidates[:_SUBSET_CANDIDATE_WIRES]
  for amt, meta, beneficiary in candidates:
    pool = [
      inv
      for inv in pool_src
      if int(getattr(inv, "id")) not in claimed
      and _party_names_align(getattr(inv, "supplier_name", None), beneficiary)
      and _dates_compatible(inv, meta["mov"], max_days=365)
    ]
    if len(pool) < 2:
      continue
    mov_d = _as_date(getattr(meta["mov"], "movement_date", None))
    chosen = _subset_sum_invoices(pool, amt, max_items=6, around=mov_d)
    if not chosen or len(chosen) < 2:
      continue
    mov_id = int(getattr(meta["mov"], "id") or 0)
    if mov_id:
      skip_mov.add(mov_id)
    for inv in chosen:
      iid = int(getattr(inv, "id"))
      claimed.add(iid)
      out[iid] = {
        "meta": meta,
        "bundle": True,
        "bundle_size": len(chosen),
        "supplier": getattr(inv, "supplier_name", None),
      }
  return out


_PAYMENT_NOTE_RE = re.compile(
  r"\n?\[pagamenti banca\].*?\[/pagamenti banca\]\s*",
  re.DOTALL,
)
_LINKED_INVOICES_NOTE_RE = re.compile(
  r"\n?\[fatture collegate\].*?\[/fatture collegate\]\s*",
  re.DOTALL,
)
_LINKED_INVOICES_BODY_RE = re.compile(
  r"\[fatture collegate\](.*?)\[/fatture collegate\]",
  re.DOTALL,
)


def _eur_it(amount: Decimal) -> str:
  return f"{_dec(amount):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _set_payment_note(row: Any, body: Optional[str]) -> None:
  """Sostituisce solo il blocco dei pagamenti banca, senza cancellare le altre note."""
  note = _PAYMENT_NOTE_RE.sub("\n", str(getattr(row, "note", None) or "")).strip()
  if body:
    block = f"[pagamenti banca]\n{body}\n[/pagamenti banca]"
    row.note = f"{note}\n{block}".strip() if note else block
  else:
    row.note = note or None


def _parse_linked_invoices_note(notes: Optional[str]) -> List[str]:
  """Numeri fattura salvati sul bonifico (saldo cumulativo / multi-fattura)."""
  match = _LINKED_INVOICES_BODY_RE.search(str(notes or ""))
  if not match:
    return []
  body = match.group(1) or ""
  numbers: List[str] = []
  seen: set[str] = set()
  for raw in re.split(r"[\n;,]+", body):
    line = str(raw or "").strip()
    if not line or line.startswith("#"):
      continue
    key = _normalize_doc_token(line)
    if not key or key in seen:
      continue
    seen.add(key)
    numbers.append(line)
  return numbers


def _set_linked_invoices_note(
  mov: Any,
  numbers: List[str],
  *,
  reason: str = "",
) -> None:
  """Scrive sul movimento l'elenco fatture pagate dallo stesso bonifico."""
  note = _LINKED_INVOICES_NOTE_RE.sub("\n", str(getattr(mov, "notes", None) or "")).strip()
  uniq: List[str] = []
  seen: set[str] = set()
  for raw in numbers:
    n = invoice_ref_digits(raw) or str(raw or "").strip()
    if not n:
      continue
    key = _normalize_doc_token(n)
    if not key or key in seen:
      continue
    seen.add(key)
    uniq.append(n)
  if not uniq:
    mov.notes = note or None
    return
  header = f"# {reason}\n" if reason else ""
  block = f"[fatture collegate]\n{header}{'; '.join(uniq)}\n[/fatture collegate]"
  mov.notes = f"{note}\n{block}".strip() if note else block


def _invoice_brief(
  inv: Invoice,
  *,
  supplier_name: str = "",
  account: Optional[BankAccount] = None,
) -> Dict[str, Any]:
  return {
    "id": inv.id,
    "invoice_number": inv.invoice_number or str(inv.id),
    "supplier_id": getattr(inv, "supplier_id", None),
    "supplier_name": supplier_name or "",
    "total": float(_dec(inv.total)),
    "payment_status": payment_status_label(inv),
    "company": getattr(inv, "company", None) or (getattr(account, "company", None) if account else None),
  }


def _build_linked_invoices(
  mov: BankMovement,
  *,
  matched: Optional[Invoice] = None,
  supplier_name: Optional[str] = None,
  account: Optional[BankAccount] = None,
  invoices_by_norm: Optional[Dict[str, Invoice]] = None,
  suppliers_by_id: Optional[Dict[int, str]] = None,
) -> List[Dict[str, Any]]:
  """Elenco fatture collegate: nota sul movimento, FK singola, refs in causale."""
  by_norm = invoices_by_norm or {}
  suppliers = suppliers_by_id or {}
  out: List[Dict[str, Any]] = []
  seen_ids: set[int] = set()
  seen_norm: set[str] = set()

  def _add_inv(inv: Invoice, sn: str = "") -> None:
    if inv.id in seen_ids:
      return
    seen_ids.add(inv.id)
    num = inv.invoice_number or str(inv.id)
    seen_norm.add(_normalize_doc_token(num))
    name = sn or suppliers.get(getattr(inv, "supplier_id", None) or 0, "") or ""
    out.append(_invoice_brief(inv, supplier_name=name, account=account))

  def _add_number(raw: str) -> None:
    n = invoice_ref_digits(raw) or str(raw or "").strip()
    if not n:
      return
    key = _normalize_doc_token(n)
    if not key or key in seen_norm:
      return
    inv = by_norm.get(key)
    if inv is None:
      for cand in by_norm.values():
        if _ref_matches_number(n, getattr(cand, "invoice_number", None)):
          inv = cand
          break
    if inv is not None:
      _add_inv(inv)
      return
    seen_norm.add(key)
    out.append(
      {
        "id": None,
        "invoice_number": n,
        "supplier_id": None,
        "supplier_name": "",
        "total": None,
        "payment_status": None,
        "company": getattr(account, "company", None) if account else None,
      }
    )

  if matched is not None:
    _add_inv(matched, supplier_name or "")

  for num in _parse_linked_invoices_note(getattr(mov, "notes", None)):
    _add_number(num)

  # Causale: numeri fattura (anche senza prefisso FT) da collegare al beneficiario
  if len(out) <= 1:
    for ref in extract_invoice_digit_tokens(_movement_search_blob(mov)):
      _add_number(ref)

  return out


def _movement_pay_line(meta: Dict[str, Any]) -> str:
  mov = meta["mov"]
  mov_d = _as_date(getattr(mov, "movement_date", None))
  when = mov_d.strftime("%d/%m/%Y") if mov_d else "data n.d."
  return f"{when} € {_eur_it(abs(_dec(getattr(mov, 'amount', 0))))}"


def allocate_acconti(
  invoices: List[Any],
  mov_meta: List[Dict[str, Any]],
  *,
  skip_invoice_ids: Optional[set] = None,
  skip_movement_ids: Optional[set] = None,
) -> Dict[int, Dict[str, Any]]:
  """Bonifico che cita la fattura principale e ne paga solo una parte.

  Più acconti sulla stessa fattura si sommano. La fattura diventa pagata
  solo quando la somma raggiunge il totale.
  """
  skip_inv = set(skip_invoice_ids or ())
  skip_mov = set(skip_movement_ids or ())
  grouped: Dict[int, Dict[str, Any]] = {}

  for meta in mov_meta:
    mov = meta["mov"]
    if str(getattr(mov, "movement_type", "") or "").lower() != "uscita":
      continue
    mid = int(getattr(mov, "id") or 0)
    if mid and mid in skip_mov:
      continue
    amt = abs(_dec(getattr(mov, "amount", 0)))
    if amt <= Decimal("1.00"):
      continue
    blob = meta.get("blob") or ""
    beneficiary = _movement_beneficiary(mov, blob)
    pool = invoices
    if beneficiary:
      aligned = [
        inv
        for inv in invoices
        if _party_names_align(getattr(inv, "supplier_name", None), beneficiary)
      ]
      if aligned:
        pool = aligned
    chosen: Optional[Any] = None
    refs = [ref for ref in extract_invoice_refs(blob) if len(_normalize_doc_token(ref)) >= 4]
    if refs:
      found: List[Any] = []
      seen_ids: set[int] = set()
      for ref in refs:
        inv = _invoice_for_ref(ref, pool)
        if inv is None:
          continue
        iid = int(getattr(inv, "id"))
        if iid in seen_ids:
          continue
        seen_ids.add(iid)
        found.append(inv)
      if len(found) == 1:
        chosen = found[0]
    if chosen is None:
      named = [
        inv
        for inv in pool
        if len(_normalize_doc_token(str(getattr(inv, "invoice_number", None) or ""))) >= 4
        and _invoice_number_in_text(getattr(inv, "invoice_number", None), blob)
      ]
      if len(named) == 1:
        chosen = named[0]
    if chosen is None:
      continue
    iid = int(getattr(chosen, "id"))
    if iid in skip_inv:
      continue
    linked = getattr(mov, "matched_invoice_id", None)
    if linked and int(linked) != iid:
      continue
    total = abs(_dec(getattr(chosen, "total", 0)))
    if total <= Decimal("0.009") or amt + Decimal("0.05") >= total:
      continue
    bucket = grouped.setdefault(iid, {"inv": chosen, "parts": []})
    bucket["parts"].append(meta)

  out: Dict[int, Dict[str, Any]] = {}
  for iid, bucket in grouped.items():
    parts = bucket["parts"]
    total = abs(_dec(getattr(bucket["inv"], "total", 0)))
    paid = sum((abs(_dec(getattr(meta["mov"], "amount", 0))) for meta in parts), Decimal("0.00"))
    if paid <= Decimal("0.009"):
      continue
    out[iid] = {
      "inv": bucket["inv"],
      "parts": parts,
      "paid": paid,
      "total": total,
      "residuo": max(Decimal("0.00"), total - paid),
      "settled": paid + Decimal("0.05") >= total,
    }
  return out


def _apply_acconto_state(row: Any, hit: Dict[str, Any]) -> bool:
  """Aggiorna importo, stato e nota. Ritorna True se la fattura è saldata."""
  total = abs(_dec(getattr(row, "total", 0)))
  paid = _dec(hit.get("paid"))
  settled = bool(hit.get("settled")) or paid + Decimal("0.05") >= total
  number = str(getattr(row, "invoice_number", None) or "").strip()
  lines = [_movement_pay_line(meta) for meta in hit.get("parts") or []]
  detail = "; ".join(lines)
  if settled:
    row.amount_paid = total
    row.is_paid = True
    body = f"Fattura {number} saldata. Pagamenti: {detail}."
  else:
    residuo = max(Decimal("0.00"), total - paid)
    row.amount_paid = min(paid, total)
    row.is_paid = False
    body = (
      f"Fattura {number} pagata in parte. Pagamenti: {detail}. "
      f"Residuo da saldare € {_eur_it(residuo)}."
    )
  _set_payment_note(row, body)
  for meta in hit.get("parts") or []:
    mov = meta["mov"]
    mov.reconciliation_status = "matched"
    mov.matched_invoice_id = int(getattr(row, "id"))
    mov.difference_amount = None if settled else (total - paid)
  return settled


def _invoice_row_out(
  inv: Any,
  *,
  match_movement: Optional[Dict[str, Any]] = None,
  reason: str = "",
  match_score: Optional[int] = None,
  match_band: Optional[str] = None,
  match_breakdown: Optional[Dict[str, Any]] = None,
  amount_matched_as: Optional[str] = None,
) -> Dict[str, Any]:
  total = _dec(getattr(inv, "total", 0))
  paid = _dec(getattr(inv, "amount_paid", 0))
  residuo = total - paid
  due = getattr(inv, "due_date", None)
  inv_date = getattr(inv, "invoice_date", None)
  status = getattr(inv, "payment_status", None) or payment_status_label(inv)
  # Allineata solo con prova banca (score auto) o contanti da file Pagamenti
  aligned = reason in {
    "matched",
    "numero_in_movimento",
    "importo_in_movimento",
    "file_contanti",
    "pagata_contanti",
    "score_auto",
    "saldo_fatture",
  }
  out = {
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
  if match_score is not None:
    out["match_score"] = int(match_score)
  if match_band:
    out["match_band"] = match_band
  if match_breakdown:
    out["match_breakdown"] = match_breakdown
  if amount_matched_as:
    out["amount_matched_as"] = amount_matched_as
  return out


# Un abbinamento auto (score ≥80) ha sempre l'importo entro 2 €.
# Sotto quella soglia i punti importo sono 0 o 15 e lo score non arriva a 80.
_AUTO_AMOUNT_CENTS = 200


def _money_cents(value: Any) -> int:
  return int((abs(_dec(value)) * Decimal("100")).quantize(Decimal("1")))


def _invoice_amount_targets(inv: Any) -> List[Decimal]:
  total = abs(_dec(getattr(inv, "total", 0)))
  paid = abs(_dec(getattr(inv, "amount_paid", 0)))
  residuo = _invoice_residuo(inv)
  targets: List[Decimal] = []
  if residuo > Decimal("0.009"):
    targets.append(residuo)
  if total > Decimal("0.009"):
    targets.append(total)
  if paid > Decimal("0.009"):
    targets.append(paid)
  if not targets and total > Decimal("0.009"):
    targets.append(total)
  return targets


def _index_uscita_by_amount(mov_meta: List[Dict[str, Any]]) -> Dict[str, Any]:
  """Uscite indicizzate per centesimi e per fattura già collegata."""
  by_invoice: Dict[int, Dict[str, Any]] = {}
  buckets: Dict[int, List[Dict[str, Any]]] = {}
  for meta in mov_meta:
    mov = meta["mov"]
    linked = getattr(mov, "matched_invoice_id", None)
    if linked:
      by_invoice.setdefault(int(linked), meta)
    if str(getattr(mov, "movement_type", "") or "").lower() != "uscita":
      continue
    amt = abs(_dec(getattr(mov, "amount", 0)))
    if amt <= Decimal("1.00"):
      continue
    buckets.setdefault(_money_cents(amt), []).append(meta)
  return {"by_invoice": by_invoice, "buckets": buckets}


def _uscita_near_targets(index: Dict[str, Any], targets: List[Any]) -> List[Dict[str, Any]]:
  """Movimenti il cui importo è entro 2 € da residuo, totale o pagato."""
  seen: set[int] = set()
  out: List[Dict[str, Any]] = []
  buckets = index["buckets"]
  for target in targets:
    if _dec(target) <= Decimal("0.009"):
      continue
    center = _money_cents(target)
    for delta in range(-_AUTO_AMOUNT_CENTS, _AUTO_AMOUNT_CENTS + 1):
      for meta in buckets.get(center + delta, ()):
        mid = int(getattr(meta["mov"], "id") or 0) or id(meta)
        if mid in seen:
          continue
        seen.add(mid)
        out.append(meta)
  return out


def _index_open_invoices_by_amount(invoices: List[Any]) -> List[tuple]:
  """Fatture ancora aperte, ordinate per centesimi di residuo/totale/pagato."""
  items: List[tuple] = []
  for inv in invoices:
    if (getattr(inv, "payment_status", None) or "") == "paid":
      continue
    if _invoice_residuo(inv) <= Decimal("0.009"):
      continue
    seen_cents: set[int] = set()
    inv_id = int(getattr(inv, "id"))
    for target in _invoice_amount_targets(inv):
      cents = _money_cents(target)
      if cents in seen_cents:
        continue
      seen_cents.add(cents)
      items.append((cents, inv_id, inv))
  items.sort(key=lambda row: row[0])
  return items


def _open_invoices_near_amount(indexed: List[tuple], amount: Decimal) -> List[Any]:
  """Fatture che possono arrivare almeno a «probable» con questo importo.

  Include l'importo esatto (±2 €) e l'acconto (dal 40% del totale in su).
  Senza punti importo lo score massimo è 60, sotto la soglia 70.
  """
  amt = abs(_dec(amount))
  if amt <= Decimal("1.00") or not indexed:
    return []
  cents_list = [row[0] for row in indexed]
  cents = _money_cents(amt)
  ranges = (
    (cents - _AUTO_AMOUNT_CENTS, cents + _AUTO_AMOUNT_CENTS),
    (cents + 1, _money_cents(amt / Decimal("0.4"))),
  )
  seen: set[int] = set()
  out: List[Any] = []
  for lo, hi in ranges:
    if hi < lo:
      continue
    start = bisect.bisect_left(cents_list, lo)
    end = bisect.bisect_right(cents_list, hi)
    for pos in range(start, end):
      inv_id = indexed[pos][1]
      if inv_id in seen:
        continue
      seen.add(inv_id)
      out.append(indexed[pos][2])
  return out


_RECON_INVOICE_LOOKBACK_DAYS = 800  # ~26 mesi: abbastanza per bonifici ritardati
_RECON_MOVEMENT_LIMIT = 1200


def _load_recon_invoices(db: Session, company_id: Optional[str]) -> tuple:
  """Una sola lettura fatture (periodo recente) per la società in esame."""
  since = date.today() - timedelta(days=_RECON_INVOICE_LOOKBACK_DAYS)
  all_invoices = list_invoices(db, include_ignored=False, light=True, since_date=since)
  if not company_id:
    scoped = all_invoices[:4000]
    return scoped, scoped
  raw = company_id.strip().lower()
  if raw in {"non_classificata", "non-classificata"}:
    wanted = "non_classificata"
  else:
    from ..constants.sdi_companies import normalize_company_section

    wanted = normalize_company_section(raw)
    if wanted == "non_classificata":
      scoped = all_invoices[:4000]
      return scoped, scoped
  scoped = [
    inv for inv in all_invoices if (getattr(inv, "company", None) or "") == wanted
  ][:4000]
  # Match solo sulla società: evita O(n×m) su tutte le fatture Atlas
  return scoped, scoped


def _cash_rows_by_number(cash_file_rows: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
  grouped: Dict[str, List[Dict[str, Any]]] = {}
  for row in cash_file_rows:
    key = str(row.get("invoice_number_norm") or "")
    if not key:
      continue
    grouped.setdefault(key, []).append(row)
  return grouped


def _load_recon_movements(
  db: Session,
  account_ids: set,
  *,
  limit: int = _RECON_MOVEMENT_LIMIT,
) -> List[Dict[str, Any]]:
  """Carica uscite recenti: prima da riconciliare, poi matched (per verifica)."""
  mov_q = db.query(BankMovement).filter(BankMovement.movement_type == "uscita")
  if account_ids:
    mov_q = mov_q.filter(BankMovement.bank_account_id.in_(account_ids))

  unmatched = (
    mov_q.filter(BankMovement.reconciliation_status == "unmatched")
    .order_by(BankMovement.movement_date.desc(), BankMovement.id.desc())
    .limit(limit)
    .all()
  )
  need = max(0, limit - len(unmatched))
  matched: List[BankMovement] = []
  if need:
    seen = {int(m.id) for m in unmatched}
    extra = (
      mov_q.filter(BankMovement.reconciliation_status != "unmatched")
      .order_by(BankMovement.movement_date.desc(), BankMovement.id.desc())
      .limit(need + 50)
      .all()
    )
    for m in extra:
      if int(m.id) in seen:
        continue
      matched.append(m)
      if len(matched) >= need:
        break

  movements = unmatched + matched
  acc_ids = {int(m.bank_account_id) for m in movements if m.bank_account_id}
  accounts = {
    int(a.id): a
    for a in db.query(BankAccount).filter(BankAccount.id.in_(list(acc_ids))).all()
  } if acc_ids else {}

  mov_meta: List[Dict[str, Any]] = []
  for movement in movements:
    blob = _movement_search_blob(movement)
    acc = accounts.get(int(movement.bank_account_id or 0))
    mov_meta.append(
      {
        "mov": movement,
        "acc": acc,
        "blob": blob,
        "beneficiary": _movement_beneficiary(movement, blob),
        "blob_digits": re.sub(r"\D", "", blob),
        "out": _movement_out(movement, acc),
      }
    )
  return mov_meta


def reconciliation_snapshot(
  db: Session,
  limit: int = 40,
  company: Optional[str] = None,
) -> Dict[str, Any]:
  """Elenco pagate/da pagare dallo stato già salvato, senza ricalcolare ogni bonifico.

  L'apertura della pagina non può rifare il confronto completo: supera il timeout
  del gateway e la griglia resta vuota.
  """
  company_id = (company or "").strip() or None
  invoices, _match_invoices = _load_recon_invoices(db, company_id)
  account_items = accounts_for_company(db, company_id) if company_id else list_accounts(db)
  account_ids = {int(a["id"]) for a in account_items if a.get("id") is not None}

  inv_ids = [int(inv.id) for inv in invoices if getattr(inv, "id", None) is not None]
  linked_by_invoice: Dict[int, Dict[str, Any]] = {}
  if inv_ids:
    linked_rows = (
      db.query(BankMovement, BankAccount)
      .join(BankAccount, BankMovement.bank_account_id == BankAccount.id)
      .filter(BankMovement.matched_invoice_id.in_(inv_ids))
      .all()
    )
    for mov, acc in linked_rows:
      linked_by_invoice[int(mov.matched_invoice_id)] = {
        "mov": mov,
        "blob": _movement_search_blob(mov),
        "out": _movement_out(mov, acc),
      }

  paid_by_bank: List[Dict[str, Any]] = []
  da_pagare: List[Dict[str, Any]] = []
  for inv in invoices:
    inv_id = int(inv.id)
    status = str(getattr(inv, "payment_status", None) or "")
    linked = linked_by_invoice.get(inv_id)
    if status == "paid":
      paid_by_bank.append(
        _invoice_row_out(
          inv,
          match_movement=_enrich_movement_out(linked["out"], linked["mov"], linked["blob"]) if linked else None,
          reason="matched",
          match_score=100 if linked else None,
          match_band="auto" if linked else None,
        )
      )
    elif status == "partial":
      da_pagare.append(
        _invoice_row_out(
          inv,
          match_movement=_enrich_movement_out(linked["out"], linked["mov"], linked["blob"]) if linked else None,
          reason="acconto",
        )
      )
    else:
      da_pagare.append(_invoice_row_out(inv, reason="da_pagare"))

  unmatched_q = (
    db.query(BankMovement, BankAccount)
    .join(BankAccount, BankMovement.bank_account_id == BankAccount.id)
    .filter(
      BankMovement.reconciliation_status == "unmatched",
      BankMovement.movement_type == "uscita",
    )
  )
  if account_ids:
    unmatched_q = unmatched_q.filter(BankMovement.bank_account_id.in_(account_ids))
  unmatched_count = unmatched_q.count()
  suggestions = []
  for mov, acc in (
    unmatched_q.order_by(BankMovement.movement_date.desc(), BankMovement.id.desc()).limit(limit).all()
  ):
    suggestions.append(
      {
        "movement": _movement_out(mov, acc),
        "suggested_invoice": None,
        "status": "unmatched",
        "match_score": 0,
        "match_band": "review",
      }
    )

  return {
    "company": company_id or "",
    "suggestions": suggestions,
    "paid_by_bank": paid_by_bank,
    "da_pagare": da_pagare,
    "open_invoices_count": len(da_pagare),
    "paid_count": len(paid_by_bank),
    "pagamenti_paid_rows": 0,
    "pagamenti_cash_rows": 0,
    "unmatched_movements": unmatched_count,
    "score_thresholds": {"auto": _SCORE_AUTO, "probable": _SCORE_PROBABLE},
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
    "fast": True,
  }


def _pair_can_score(inv: Any, blob: str, beneficiary: str, blob_digits: str) -> bool:
  """Senza fornitore o numero in causale lo score non arriva a 70. Evita il confronto completo."""
  if beneficiary and _party_names_align(getattr(inv, "supplier_name", None), beneficiary):
    return True
  num = str(getattr(inv, "invoice_number", None) or "").strip()
  if num and _invoice_number_in_text(num, blob):
    return True
  vat = str(getattr(inv, "supplier_vat", None) or getattr(inv, "vat_number", None) or "")
  digits = re.sub(r"\D", "", vat)
  return bool(digits) and len(digits) >= 11 and digits in (blob_digits or "")


def enrich_probable_suggestions(
  db: Session,
  snapshot: Optional[Dict[str, Any]] = None,
  *,
  company: Optional[str] = None,
  limit: int = 40,
) -> Dict[str, Any]:
  """Riempie le proposte 70–79 (one-click) sui movimenti ancora unmatched.

  Lo snapshot veloce non calcola gli score: senza questo passo la griglia
  «Da controllare» non ha mai il pulsante Conferma.
  """
  company_id = (company or (snapshot or {}).get("company") or "").strip() or None
  invoices, _ = _load_recon_invoices(db, company_id)
  open_by_amount = _index_open_invoices_by_amount(invoices)
  used_invoices: set[int] = set()

  account_items = accounts_for_company(db, company_id) if company_id else list_accounts(db)
  account_ids = {int(a["id"]) for a in account_items if a.get("id") is not None}
  mov_q = (
    db.query(BankMovement, BankAccount)
    .join(BankAccount, BankMovement.bank_account_id == BankAccount.id)
    .filter(
      BankMovement.reconciliation_status == "unmatched",
      BankMovement.movement_type == "uscita",
    )
  )
  if account_ids:
    mov_q = mov_q.filter(BankMovement.bank_account_id.in_(account_ids))
  unmatched_rows = (
    mov_q.order_by(BankMovement.movement_date.desc(), BankMovement.id.desc()).limit(limit).all()
  )

  suggestions: List[Dict[str, Any]] = []
  for mov, acc in unmatched_rows:
    blob = _movement_search_blob(mov)
    beneficiary = _movement_beneficiary(mov, blob)
    blob_digits = re.sub(r"\D", "", blob)
    mov_out = _enrich_movement_out(_movement_out(mov, acc), mov, blob)
    best = None
    best_sc: Optional[Dict[str, Any]] = None
    for inv in _open_invoices_near_amount(open_by_amount, _dec(mov.amount)):
      inv_id = int(inv.id)
      if inv_id in used_invoices:
        continue
      residuo = _invoice_residuo(inv)
      if residuo <= Decimal("0.009"):
        continue
      if not _pair_can_score(inv, blob, beneficiary, blob_digits):
        continue
      sc = score_movement_invoice(inv, mov, blob)
      if sc["score"] < _SCORE_PROBABLE:
        continue
      if best_sc is None or sc["score"] > best_sc["score"]:
        best_sc = sc
        diff = abs(residuo - _dec(mov.amount))
        quality = (
          "number"
          if sc["breakdown"].get("number", 0) >= _SCORE_NUMBER
          else ("exact" if sc["breakdown"].get("amount", 0) >= 25 else "near")
        )
        best = {
          "invoice_id": inv_id,
          "supplier_name": inv.supplier_name,
          "invoice_number": inv.invoice_number,
          "due_date": inv.due_date.date().isoformat()
          if hasattr(inv.due_date, "date")
          else (inv.due_date.isoformat() if inv.due_date else None),
          "residuo": float(residuo),
          "difference": float(diff),
          "match_quality": quality,
          "match_score": sc["score"],
          "match_band": sc["band"],
          "match_breakdown": sc["breakdown"],
          "partial": sc.get("partial"),
        }

    if best and best_sc:
      used_invoices.add(int(best["invoice_id"]))
      band = best.get("match_band") or "review"
      linked_number = str(best.get("invoice_number") or "").strip()
      if linked_number and _invoice_number_in_text(linked_number, blob):
        mov_out = dict(mov_out)
        mov_out["doc_ref"] = linked_number
      # auto: già applicati da sync; qui restano i probable da one-click
      if band == "auto" and not best.get("partial"):
        status = "matched"
      elif band == "probable" or best.get("partial"):
        status = "difference"
      else:
        status = "unmatched"
      suggestions.append(
        {
          "movement": mov_out,
          "suggested_invoice": best,
          "status": status,
          "match_score": best.get("match_score"),
          "match_band": band,
        }
      )
    else:
      suggestions.append(
        {
          "movement": mov_out,
          "suggested_invoice": None,
          "status": "unmatched",
          "match_score": 0,
          "match_band": "review",
        }
      )

  out = dict(snapshot or {})
  out["suggestions"] = suggestions
  out["unmatched_movements"] = len([s for s in suggestions if s["status"] == "unmatched"])
  out["probable_count"] = len(
    [s for s in suggestions if s.get("match_band") == "probable" or s.get("status") == "difference"]
  )
  out["fast"] = False
  return out


def reconciliation_preview(
  db: Session,
  limit: int = 40,
  company: Optional[str] = None,
) -> Dict[str, Any]:
  """Classifica fatture pagate/da pagare tramite n. documento nei movimenti banca; propone abbinamenti."""
  ensure_default_account(db)
  company_id = (company or "").strip() or None

  # Il saldo di un mese può coprire la stessa fornitura su più società.
  invoices, match_invoices = _load_recon_invoices(db, company_id)

  account_items = accounts_for_company(db, company_id) if company_id else list_accounts(db)
  account_ids = {int(a["id"]) for a in account_items if a.get("id") is not None}

  mov_meta = _load_recon_movements(db, account_ids)

  from . import supplier_payments_service

  try:
    cash_file_rows = supplier_payments_service.list_cash_paid_document_rows(
      db, company=company_id, all_workbooks=False
    )
  except Exception:
    cash_file_rows = []
  cash_by_number = _cash_rows_by_number(cash_file_rows)

  paid_by_bank: List[Dict[str, Any]] = []
  da_pagare: List[Dict[str, Any]] = []
  used_mov_ids: set[int] = set()

  # Prima passata: candidati auto solo tra i bonifici con importo vicino
  mov_index = _index_uscita_by_amount(mov_meta)
  auto_pairs: List[Dict[str, Any]] = []
  for inv in invoices:
    inv_id = int(inv.id)
    already = mov_index["by_invoice"].get(inv_id)
    if already:
      sc = score_movement_invoice(inv, already["mov"], already["blob"])
      if sc["band"] == "auto" or already["mov"].matched_invoice_id == inv_id:
        auto_pairs.append(
          {
            "inv": inv,
            "found": already,
            "sc": sc,
            "rank": (
              10_000,
              int(sc.get("score") or 0),
              1 if _invoice_number_in_text(str(inv.invoice_number or ""), already["blob"]) else 0,
            ),
            "prelinked": True,
          }
        )
        continue
    best_sc = None
    best_m = None
    for m in _uscita_near_targets(mov_index, _invoice_amount_targets(inv)):
      linked = m["mov"].matched_invoice_id
      if linked and int(linked) != inv_id:
        continue
      sc = score_movement_invoice(inv, m["mov"], m["blob"])
      if sc["band"] != "auto":
        continue
      if best_sc is None or sc["score"] > best_sc["score"]:
        best_sc = sc
        best_m = m
    if best_m is not None and best_sc is not None:
      auto_pairs.append(
        {
          "inv": inv,
          "found": best_m,
          "sc": best_sc,
          "rank": (
            int(best_sc.get("score") or 0),
            1 if _invoice_number_in_text(str(inv.invoice_number or ""), best_m["blob"]) else 0,
            -int(best_m["mov"].id or 0),
          ),
          "prelinked": False,
        }
      )

  auto_pairs.sort(key=lambda p: p["rank"], reverse=True)
  inv_to_pair: Dict[int, Dict[str, Any]] = {}
  for pair in auto_pairs:
    inv_id = int(pair["inv"].id)
    mov_id = int(pair["found"]["mov"].id)
    if inv_id in inv_to_pair or (mov_id in used_mov_ids and not pair["prelinked"]):
      continue
    if mov_id in used_mov_ids and pair["prelinked"]:
      # prelinked vince sul movimento già usato
      pass
    used_mov_ids.add(mov_id)
    inv_to_pair[inv_id] = pair

  saldo_by_invoice = allocate_saldo_fatture(
    match_invoices,
    mov_meta,
    skip_invoice_ids=set(inv_to_pair.keys()),
    skip_movement_ids=used_mov_ids,
  )
  cited_by_invoice = allocate_cited_invoices(
    match_invoices,
    mov_meta,
    skip_invoice_ids=set(inv_to_pair.keys()) | set(saldo_by_invoice.keys()),
    skip_movement_ids=used_mov_ids,
  )
  for iid, hit in allocate_number_ranges(
    match_invoices,
    mov_meta,
    skip_invoice_ids=set(inv_to_pair.keys()) | set(saldo_by_invoice.keys()) | set(cited_by_invoice.keys()),
    skip_movement_ids=used_mov_ids,
  ).items():
    cited_by_invoice[iid] = hit

  for inv in invoices:
    inv_id = int(inv.id)
    num = str(inv.invoice_number or "").strip()
    pair = inv_to_pair.get(inv_id)
    found = pair["found"] if pair else None
    found_score = pair["sc"] if pair else None

    cash_hit = None
    if not found and cash_file_rows:
      cash_subset = cash_by_number.get(supplier_payments_service._normalize_doc(num)) or []
      cash_hit = supplier_payments_service.find_paid_row_for_invoice(
        cash_subset,
        invoice_number=num,
        supplier_name=getattr(inv, "supplier_name", None),
        supplier_vat=getattr(inv, "supplier_vat", None) or getattr(inv, "vat_number", None),
        invoice_total=float(_dec(getattr(inv, "total", 0)) or 0),
        invoice_amount_paid=float(_dec(getattr(inv, "amount_paid", 0)) or 0),
      )

    saldo_hit = None if found else saldo_by_invoice.get(inv_id)
    cited_hit = None if found or saldo_hit else cited_by_invoice.get(inv_id)
    if saldo_hit and not found:
      found = saldo_hit["meta"]
      found_score = {
        "score": 100,
        "band": "auto",
        "breakdown": {"amount": 40, "party": 30, "number": 0, "date": 10},
        "amount_matched_as": "saldo",
      }
    elif cited_hit and not found:
      found = cited_hit["meta"]
      found_score = {
        "score": 100,
        "band": "auto",
        "breakdown": {"amount": 40, "party": 30, "number": 20, "date": 10},
        "amount_matched_as": "numeri",
      }

    if found:
      has_num = _invoice_number_in_text(num, found["blob"])
      if saldo_hit:
        reason = "saldo_fatture"
      elif cited_hit:
        reason = "numero_in_movimento"
      else:
        reason = "matched" if found["mov"].matched_invoice_id == inv_id else (
          "numero_in_movimento" if has_num else "importo_in_movimento"
        )
      if found_score and found_score.get("band") == "auto" and reason not in {"saldo_fatture", "numero_in_movimento"}:
        reason = "score_auto" if reason != "matched" else reason
      mov_out = _enrich_movement_out(found["out"], found["mov"], found["blob"])
      if saldo_hit:
        mov_out = dict(mov_out)
        mov_out["doc_ref"] = f"saldo {saldo_hit['month_label']}"
      elif cited_hit and num:
        mov_out = dict(mov_out)
        mov_out["doc_ref"] = num
      elif has_num and num:
        mov_out = dict(mov_out)
        mov_out["doc_ref"] = num
      paid_by_bank.append(
        _invoice_row_out(
          inv,
          match_movement=mov_out,
          reason=reason,
          match_score=(found_score or {}).get("score"),
          match_band=(found_score or {}).get("band"),
          match_breakdown=(found_score or {}).get("breakdown"),
          amount_matched_as=(found_score or {}).get("amount_matched_as"),
        )
      )
    elif cash_hit:
      paid_by_bank.append(
        _invoice_row_out(
          inv,
          reason="file_contanti",
          match_movement={
            "movement_date": (cash_hit.get("payment_date") or "")[:10] or None,
            "description": f"File Pagamenti · contanti · {cash_hit.get('sheet') or ''}".strip(" ·"),
            "causale": "CONTANTI",
            "amount": cash_hit.get("amount_paid"),
            "id": None,
          },
          match_score=100,
          match_band="auto",
        )
      )
    elif str(getattr(inv, "payment_method", None) or "").strip().lower() == "contanti":
      paid_by_bank.append(
        _invoice_row_out(
          inv,
          reason="pagata_contanti",
          match_movement={
            "description": "Pagata in contanti",
            "causale": "CONTANTI",
            "amount": float(_dec(getattr(inv, "total", 0))),
            "id": None,
          },
          match_score=100,
          match_band="auto",
        )
      )
    else:
      # Senza prova in movimenti (score auto) e senza contanti → da pagare
      da_pagare.append(_invoice_row_out(inv, reason="da_pagare"))

  unmatched = [
    (m["mov"], m["acc"], m["blob"], m["out"])
    for m in mov_meta
    if m["mov"].reconciliation_status == "unmatched"
    and m["mov"].movement_type == "uscita"
    and int(m["mov"].id) not in used_mov_ids
  ][:limit]

  suggestions = []
  used_invoices = set()
  open_by_amount = _index_open_invoices_by_amount(invoices)
  for mov, acc, blob, mov_out in unmatched:
    best = None
    best_score_info: Optional[Dict[str, Any]] = None
    for inv in _open_invoices_near_amount(open_by_amount, _dec(mov.amount)):
      inv_id = int(inv.id)
      if inv_id in used_invoices:
        continue
      residuo = _invoice_residuo(inv)
      if residuo <= Decimal("0.009"):
        continue
      sc = score_movement_invoice(inv, mov, blob)
      if sc["score"] < _SCORE_PROBABLE:
        continue
      if best_score_info is None or sc["score"] > best_score_info["score"]:
        best_score_info = sc
        diff = abs(residuo - _dec(mov.amount))
        quality = (
          "number"
          if sc["breakdown"].get("number", 0) >= _SCORE_NUMBER
          else ("exact" if sc["breakdown"].get("amount", 0) >= 25 else "near")
        )
        best = {
          "invoice_id": inv_id,
          "supplier_name": inv.supplier_name,
          "invoice_number": inv.invoice_number,
          "due_date": inv.due_date.date().isoformat()
          if hasattr(inv.due_date, "date")
          else (inv.due_date.isoformat() if inv.due_date else None),
          "residuo": float(residuo),
          "difference": float(diff),
          "match_quality": quality,
          "match_score": sc["score"],
          "match_band": sc["band"],
          "match_breakdown": sc["breakdown"],
          "partial": sc.get("partial"),
        }

    linked_number = str((best or {}).get("invoice_number") or "").strip()
    if linked_number and _invoice_number_in_text(linked_number, blob):
      mov_out = dict(mov_out)
      mov_out["doc_ref"] = linked_number
    elif not mov_out.get("doc_ref"):
      found_doc = _extract_doc_ref(blob)
      if found_doc:
        mov_out = dict(mov_out)
        mov_out["doc_ref"] = found_doc

    if best:
      used_invoices.add(best["invoice_id"])
      band = best.get("match_band") or "review"
      if band == "auto" and not best.get("partial"):
        status = "matched"
      elif band in ("auto", "probable"):
        status = "difference" if best.get("partial") or _dec(best.get("difference", 0)) > Decimal("0.05") else "matched"
        if band == "probable":
          status = "difference"  # richiede conferma one-click
      else:
        status = "unmatched"
      suggestions.append(
        {
          "movement": mov_out,
          "suggested_invoice": best,
          "status": status,
          "match_score": best.get("match_score"),
          "match_band": band,
        }
      )
    else:
      suggestions.append(
        {
          "movement": mov_out,
          "suggested_invoice": None,
          "status": "unmatched",
          "match_score": 0,
          "match_band": "review",
        }
      )

  return {
    "company": company_id or "",
    "suggestions": suggestions,
    "paid_by_bank": paid_by_bank,
    "da_pagare": da_pagare,
    "open_invoices_count": len(da_pagare),
    "paid_count": len(paid_by_bank),
    "pagamenti_paid_rows": len(cash_file_rows),
    "pagamenti_cash_rows": len(cash_file_rows),
    "unmatched_movements": len([s for s in suggestions if s["status"] == "unmatched"]),
    "score_thresholds": {"auto": _SCORE_AUTO, "probable": _SCORE_PROBABLE},
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
  - bonifici sui conti (score auto: importo + fornitore e/o n. documento, anche ritardati)
  - file Pagamenti: solo CONTANTI/CARTA/assegno (senza bonifico)

  Un movimento con importo di una sola fattura paga quella fattura.
  Un bonifico «saldo fatture <mese>» che quadra con più fatture dello stesso fornitore
  le segna tutte pagate (la nota di credito e la fattura stornata restano fuori).
  """
  from decimal import Decimal

  from . import supplier_payments_service

  company_id = (company or "").strip() or None
  listed, _match_invoices = _load_recon_invoices(db, company_id)
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

  mov_meta = _load_recon_movements(db, account_ids)

  try:
    cash_file_rows = supplier_payments_service.list_cash_paid_document_rows(
      db, company=company_id, all_workbooks=False
    )
  except Exception:
    cash_file_rows = []

  cash_by_number = _cash_rows_by_number(cash_file_rows)

  def _cash_file_hit(inv_dto: Any) -> Optional[Dict[str, Any]]:
    num = str(getattr(inv_dto, "invoice_number", None) or "").strip()
    if not num or not cash_file_rows:
      return None
    subset = cash_by_number.get(supplier_payments_service._normalize_doc(num)) or []
    if not subset:
      return None
    return supplier_payments_service.find_paid_row_for_invoice(
      subset,
      invoice_number=num,
      supplier_name=str(getattr(inv_dto, "supplier_name", None) or "").strip(),
      supplier_vat=str(
        getattr(inv_dto, "supplier_vat", None)
        or getattr(inv_dto, "vat_number", None)
        or ""
      ).strip(),
      invoice_total=float(_dec(getattr(inv_dto, "total", 0)) or 0),
      invoice_amount_paid=float(_dec(getattr(inv_dto, "amount_paid", 0)) or 0),
    )

  def _pair_rank(inv_dto: Any, mov: Any, blob: str, sc: Dict[str, Any]) -> tuple:
    """Ordine: score, n. in causale, vicinanza data, fattura più vecchia."""
    num = str(getattr(inv_dto, "invoice_number", None) or "").strip()
    has_num = 1 if _invoice_number_in_text(num, blob) else 0
    inv_d = _as_date(getattr(inv_dto, "invoice_date", None))
    due_d = _as_date(getattr(inv_dto, "due_date", None))
    mov_d = _as_date(getattr(mov, "movement_date", None))
    anchor = due_d or inv_d
    date_gap = abs((mov_d - anchor).days) if mov_d and anchor else 9999
    inv_ord = inv_d.toordinal() if inv_d else 0
    return (
      int(sc.get("score") or 0),
      has_num,
      -date_gap,
      -inv_ord,
      -int(getattr(mov, "id") or 0),
    )

  mov_index = _index_uscita_by_amount(mov_meta)

  def _bank_hit_for_verify(inv_dto: Any, *, reserved_mov_ids: Optional[set] = None) -> Optional[Any]:
    """Usato per verificare fatture già pagate (riapertura)."""
    reserved = reserved_mov_ids or set()
    inv_id = int(getattr(inv_dto, "id"))
    already = mov_index["by_invoice"].get(inv_id)
    if already and _bank_movement_pays_invoice(inv_dto, already["mov"], already["blob"]):
      return already["mov"]
    best_mov = None
    best_rank: Optional[tuple] = None
    for meta in _uscita_near_targets(mov_index, _invoice_amount_targets(inv_dto)):
      mov = meta["mov"]
      mid = int(mov.id)
      if mid in reserved:
        continue
      # Già abbinato ad altra fattura → non riusarlo in verifica
      linked = mov.matched_invoice_id
      if linked and int(linked) != inv_id:
        continue
      if not _pair_can_score(
        inv_dto,
        meta["blob"],
        meta.get("beneficiary") or "",
        meta.get("blob_digits") or "",
      ):
        continue
      sc = score_movement_invoice(inv_dto, mov, meta["blob"])
      if sc["band"] != "auto":
        continue
      rank = _pair_rank(inv_dto, mov, meta["blob"], sc)
      if best_rank is None or rank > best_rank:
        best_rank = rank
        best_mov = mov
    return best_mov

  # Acconti / multi-fattura: solo fatture ancora aperte (pool molto più piccolo)
  acconti = allocate_acconti(unpaid, mov_meta)
  acconto_mov_ids = {
    int(part["mov"].id)
    for hit in acconti.values()
    for part in hit["parts"]
    if getattr(part["mov"], "id", None) is not None
  }

  # --- Assegnazione esclusiva bonifico → fattura da pagare ---
  candidates: List[Dict[str, Any]] = []
  for inv_dto in unpaid:
    inv_id = int(getattr(inv_dto, "id"))
    # Se già collegata a un movimento valido, ha priorità assoluta
    already = mov_index["by_invoice"].get(inv_id)
    if already and _bank_movement_pays_invoice(inv_dto, already["mov"], already["blob"]):
      sc = score_movement_invoice(inv_dto, already["mov"], already["blob"])
      candidates.append(
        {
          "inv": inv_dto,
          "mov": already["mov"],
          "blob": already["blob"],
          "sc": sc,
          "rank": (10_000, *_pair_rank(inv_dto, already["mov"], already["blob"], sc)),
          "prelinked": True,
        }
      )
      continue
    for meta in _uscita_near_targets(mov_index, _invoice_amount_targets(inv_dto)):
      mov = meta["mov"]
      if int(mov.id) in acconto_mov_ids:
        continue
      linked = mov.matched_invoice_id
      if linked and int(linked) != inv_id:
        continue
      if not _pair_can_score(
        inv_dto,
        meta["blob"],
        meta.get("beneficiary") or "",
        meta.get("blob_digits") or "",
      ):
        continue
      sc = score_movement_invoice(inv_dto, mov, meta["blob"])
      if sc["band"] != "auto":
        continue
      candidates.append(
        {
          "inv": inv_dto,
          "mov": mov,
          "blob": meta["blob"],
          "sc": sc,
          "rank": _pair_rank(inv_dto, mov, meta["blob"], sc),
          "prelinked": False,
        }
      )

  candidates.sort(key=lambda c: c["rank"], reverse=True)
  assigned_inv: set[int] = set()
  assigned_mov: set[int] = set()
  bank_assignments: Dict[int, Dict[str, Any]] = {}
  for cand in candidates:
    inv_id = int(getattr(cand["inv"], "id"))
    mov_id = int(cand["mov"].id)
    if inv_id in assigned_inv or mov_id in assigned_mov:
      continue
    assigned_inv.add(inv_id)
    assigned_mov.add(mov_id)
    bank_assignments[inv_id] = cand

  saldo_by_invoice = allocate_saldo_fatture(
    unpaid,
    mov_meta,
    skip_invoice_ids=set(bank_assignments.keys()),
    skip_movement_ids=assigned_mov | acconto_mov_ids,
  )
  cited_by_invoice = allocate_cited_invoices(
    unpaid,
    mov_meta,
    skip_invoice_ids=set(bank_assignments.keys()) | set(saldo_by_invoice.keys()),
    skip_movement_ids=assigned_mov | acconto_mov_ids,
  )
  for iid, hit in allocate_number_ranges(
    unpaid,
    mov_meta,
    skip_invoice_ids=set(bank_assignments.keys()) | set(saldo_by_invoice.keys()) | set(cited_by_invoice.keys()),
    skip_movement_ids=assigned_mov | acconto_mov_ids,
  ).items():
    cited_by_invoice[iid] = hit

  bundle_by_invoice = allocate_supplier_bundles(
    unpaid,
    mov_meta,
    skip_invoice_ids=set(bank_assignments.keys()) | set(saldo_by_invoice.keys()) | set(cited_by_invoice.keys()),
    skip_movement_ids=assigned_mov | acconto_mov_ids,
  )
  for iid, hit in bundle_by_invoice.items():
    # Stesso canale «multi-fattura» di saldo/cited in UI
    saldo_by_invoice[iid] = hit

  marked: List[Dict[str, Any]] = []
  reopened: List[Dict[str, Any]] = []
  marked_from_file = 0
  changed = False

  touch_ids = (
    {int(getattr(inv, "id")) for inv in unpaid}
    | {int(getattr(inv, "id")) for inv in paid_listed}
    | set(acconti.keys())
    | set(saldo_by_invoice.keys())
    | set(cited_by_invoice.keys())
  )
  orm_by_id: Dict[int, Invoice] = {}
  if touch_ids:
    orm_by_id = {
      int(row.id): row
      for row in db.query(Invoice).filter(Invoice.id.in_(list(touch_ids))).all()
    }

  for inv_dto in unpaid:
    inv_id = int(getattr(inv_dto, "id"))
    num = str(getattr(inv_dto, "invoice_number", None) or "").strip()
    cand = bank_assignments.get(inv_id)
    found = cand["mov"] if cand else None
    saldo_hit = None if found else saldo_by_invoice.get(inv_id)
    cited_hit = None if found or saldo_hit else cited_by_invoice.get(inv_id)
    cash_hit = None if (found or saldo_hit or cited_hit) else _cash_file_hit(inv_dto)
    acconto_hit = None if (found or saldo_hit or cited_hit or cash_hit) else acconti.get(inv_id)
    if not found and not saldo_hit and not cited_hit and not cash_hit and not acconto_hit:
      continue

    row = orm_by_id.get(inv_id)
    if not row:
      continue
    if acconto_hit and not found and not saldo_hit and not cited_hit and not cash_hit:
      settled = _apply_acconto_state(row, acconto_hit)
      changed = True
      marked.append(
        {
          "invoice_id": inv_id,
          "invoice_number": num,
          "reason": "matched" if settled else "acconto",
          "amount_paid": float(_dec(row.amount_paid)),
          "residuo": float(_dec(row.total) - _dec(row.amount_paid)),
        }
      )
      continue
    row.amount_paid = _dec(row.total)
    row.is_paid = True
    reason = "file_contanti"
    movement_id = None
    match_score = None
    match_band = None
    if found and cand:
      blob = cand["blob"]
      sc = cand["sc"]
      match_score = sc.get("score")
      match_band = sc.get("band")
      has_num = _invoice_number_in_text(num, blob)
      reason = "score_auto"
      if has_num:
        reason = "numero_in_movimento"
      elif sc.get("breakdown", {}).get("amount", 0) >= 25:
        reason = "importo_in_movimento"
      movement_id = int(found.id)
      if found.movement_type == "uscita" and (
        found.matched_invoice_id is None
        or int(found.matched_invoice_id) == inv_id
        or found.reconciliation_status == "unmatched"
      ):
        found.reconciliation_status = "matched"
        found.matched_invoice_id = inv_id
        found.difference_amount = None
    elif saldo_hit or cited_hit:
      group = saldo_hit or cited_hit
      if group.get("bundle"):
        reason = "bundle_fornitore"
      elif saldo_hit:
        reason = "saldo_fatture"
      else:
        reason = "numero_in_movimento"
      match_score = 100
      match_band = "auto"
      movement_id = int(group["meta"]["mov"].id)
      group_mov = group["meta"]["mov"]
      if group_mov.reconciliation_status == "unmatched":
        group_mov.reconciliation_status = "matched"
        group_mov.difference_amount = None
    else:
      marked_from_file += 1
    changed = True
    item = {
      "invoice_id": inv_id,
      "invoice_number": num,
      "reason": reason,
    }
    if match_score is not None:
      item["match_score"] = int(match_score)
    if match_band:
      item["match_band"] = match_band
    if movement_id is not None:
      item["movement_id"] = movement_id
      if cand:
        blob_for_ref = cand["blob"]
      elif saldo_hit or cited_hit:
        blob_for_ref = (saldo_hit or cited_hit)["meta"].get("blob") or ""
      else:
        blob_for_ref = ""
      bonifico = _extract_bonifico_ref(blob_for_ref)
      if bonifico:
        item["bonifico_ref"] = bonifico
    if cash_hit:
      item["pagamenti_sheet"] = cash_hit.get("sheet")
      item["pagamenti_payment_date"] = cash_hit.get("payment_date")
    marked.append(item)

  covered_ids = {int(item["invoice_id"]) for item in marked}
  for inv_id, hit in list(saldo_by_invoice.items()) + list(cited_by_invoice.items()):
    if inv_id in covered_ids:
      continue
    covered_ids.add(inv_id)
    row = orm_by_id.get(inv_id)
    if not row or row.is_paid:
      continue
    row.amount_paid = _dec(row.total)
    row.is_paid = True
    group_mov = hit["meta"]["mov"]
    if getattr(group_mov, "reconciliation_status", None) == "unmatched":
      group_mov.reconciliation_status = "matched"
      group_mov.difference_amount = None
    changed = True
    marked.append(
      {
        "invoice_id": inv_id,
        "invoice_number": str(getattr(row, "invoice_number", "") or ""),
        "reason": (
          "bundle_fornitore"
          if hit.get("bundle")
          else ("saldo_fatture" if inv_id in saldo_by_invoice else "numero_in_movimento")
        ),
        "movement_id": int(group_mov.id),
        "match_band": "auto",
      }
    )

  handled_ids = {int(item["invoice_id"]) for item in marked}
  for inv_id, hit in acconti.items():
    if inv_id in handled_ids or inv_id in bank_assignments or inv_id in saldo_by_invoice or inv_id in cited_by_invoice:
      continue
    row = orm_by_id.get(inv_id)
    if not row or row.is_paid:
      continue
    settled = _apply_acconto_state(row, hit)
    changed = True
    handled_ids.add(inv_id)
    marked.append(
      {
        "invoice_id": inv_id,
        "invoice_number": str(getattr(row, "invoice_number", "") or ""),
        "reason": "matched" if settled else "acconto",
        "amount_paid": float(_dec(row.amount_paid)),
        "residuo": float(_dec(row.total) - _dec(row.amount_paid)),
      }
    )

  # Riapri «pagate» senza prova banca né contanti/POS da file.
  # Proteggi anche saldi multi-fattura (nota [fatture collegate] / numeri in causale).
  marked_ids = {int(item["invoice_id"]) for item in marked if item.get("invoice_id") is not None}
  for inv_dto in paid_listed:
    inv_id = int(getattr(inv_dto, "id"))
    num = str(getattr(inv_dto, "invoice_number", None) or "").strip()
    if str(getattr(inv_dto, "payment_method", None) or "").strip().lower() == "contanti":
      continue
    if inv_id in marked_ids or inv_id in bank_assignments or inv_id in saldo_by_invoice or inv_id in cited_by_invoice:
      continue
    if _invoice_protected_by_bank_evidence(inv_dto, mov_meta):
      continue
    part_sum = sum(
      (
        abs(_dec(meta["mov"].amount))
        for meta in mov_meta
        if getattr(meta["mov"], "matched_invoice_id", None)
        and int(meta["mov"].matched_invoice_id) == inv_id
      ),
      Decimal("0.00"),
    )
    total_inv = abs(_dec(getattr(inv_dto, "total", 0)))
    if total_inv > Decimal("0.009") and part_sum + Decimal("0.05") >= total_inv:
      continue
    already = mov_index["by_invoice"].get(inv_id)
    if already and str(getattr(already["mov"], "reconciliation_status", "") or "") in {
      "matched",
      "difference",
    }:
      continue
    if _cash_file_hit(inv_dto):
      continue
    row = orm_by_id.get(inv_id)
    if not row:
      continue
    if str(getattr(row, "payment_method", None) or "").strip().lower() == "contanti":
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
        "reason": "no_bank_match",
      }
    )

  # Persisti sul bonifico l'elenco fatture (saldo cumulativo / multi-fattura)
  by_mov_items: Dict[int, List[Dict[str, Any]]] = {}
  for item in marked:
    mid = item.get("movement_id")
    if mid is None:
      continue
    by_mov_items.setdefault(int(mid), []).append(item)

  # Ricostruzione storica solo se poche pagate (altrimenti O(mov×paid) troppo lenta)
  if len(paid_listed) <= 200:
    for meta in mov_meta:
      mov = meta["mov"]
      if str(getattr(mov, "reconciliation_status", "") or "") != "matched":
        continue
      mid = int(mov.id)
      if mid in by_mov_items:
        continue
      if getattr(mov, "matched_invoice_id", None):
        continue
      if _parse_linked_invoices_note(getattr(mov, "notes", None)):
        continue
      blob = meta.get("blob") or ""
      named: List[Dict[str, Any]] = []
      for inv_dto in paid_listed:
        if invoice_named_on_group_wire(inv_dto, mov, blob):
          named.append(
            {
              "invoice_id": int(getattr(inv_dto, "id")),
              "invoice_number": str(getattr(inv_dto, "invoice_number", "") or ""),
              "reason": "saldo_fatture",
            }
          )
      if len(named) > 1:
        by_mov_items[mid] = named

  mov_by_id = {int(meta["mov"].id): meta["mov"] for meta in mov_meta}
  for mid, items in by_mov_items.items():
    mov = mov_by_id.get(mid)
    if not mov:
      continue
    numbers = [
      str(it.get("invoice_number") or "").strip()
      for it in items
      if str(it.get("invoice_number") or "").strip()
    ]
    if len(numbers) < 2:
      continue
    reasons = {str(it.get("reason") or "") for it in items}
    if "bundle_fornitore" in reasons:
      reason_label = "bundle fornitore"
    elif "saldo_fatture" in reasons:
      reason_label = "saldo cumulativo"
    else:
      reason_label = "saldo cumulativo"
    prev_note = _parse_linked_invoices_note(getattr(mov, "notes", None))
    prev_keys = {_normalize_doc_token(n) for n in prev_note}
    next_keys = {_normalize_doc_token(n) for n in numbers}
    if prev_keys != next_keys:
      _set_linked_invoices_note(mov, numbers, reason=reason_label)
      changed = True
    if not getattr(mov, "matched_invoice_id", None):
      first_id = items[0].get("invoice_id")
      if first_id:
        mov.matched_invoice_id = int(first_id)
        mov.reconciliation_status = "matched"
        mov.difference_amount = None
        changed = True

  if changed:
    db.commit()

  fully_marked = [item for item in marked if item.get("reason") != "acconto"]
  da_pagare_count = max(0, len(unpaid) - len(fully_marked) + len(reopened))
  return {
    "ok": True,
    "company": company_id or "",
    "marked_paid": len(fully_marked),
    "marked_partial": len(marked) - len(fully_marked),
    "marked_from_pagamenti": marked_from_file,
    "reopened_unpaid": len(reopened),
    "da_pagare": da_pagare_count,
    "accounts_checked": len(account_ids),
    "pagamenti_paid_rows": len(cash_file_rows),
    "pagamenti_cash_rows": len(cash_file_rows),
    "items": marked,
    "reopened_items": reopened[:80],
  }


def auto_reconcile(
  db: Session,
  company: Optional[str] = None,
  limit: int = 80,
) -> Dict[str, Any]:
  """Segna le fatture con match auto (anche multi-fattura) e restituisce lo snapshot.

  Le proposte 70–79 (one-click) sono su GET /riconciliazione/proposte, separate,
  così il gateway non va in 504 sulla stessa richiesta lunga.
  """
  bank_sync = sync_payment_status_from_bank(db, company=company)
  refreshed = reconciliation_snapshot(db, limit=limit, company=company)
  refreshed["auto_applied"] = int(bank_sync.get("marked_paid") or 0)
  refreshed["auto_applied_items"] = list(bank_sync.get("items") or [])
  refreshed["auto_errors"] = []
  refreshed["bank_sync"] = bank_sync
  refreshed["score_thresholds"] = {"auto": _SCORE_AUTO, "probable": _SCORE_PROBABLE}
  refreshed["suggestions_pending"] = True
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
  # Non sovrascrivere saldi Enable Banking con Σ movimenti locali
  if (account.eb_account_uid or "").strip():
    return
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
