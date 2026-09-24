"""Agente riconciliazione automatica: movimenti banca ↔ fatture ↔ file fornitori.

Flusso ad ogni esecuzione (timer o manuale):
1. Scarica i movimenti Enable Banking sui conti collegati
2. Legge le causali/descrizioni (n. fattura, fornitore, importo) e collega le uscite
3. Segna pagate le fatture con prova banca (n. o importo + data)
4. Per i pagamenti in CONTANTI/CARTA recupera la prova dal file Pagamenti (per società)

Risultato: colonna «Fattura collegata» e stato fattura allineati senza intervento manuale.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..constants.sdi_companies import SDI_COMPANY_ORDER
from ..models.bank_account import BankAccount
from ..models.bank_movement import BankMovement
from . import banca_service
from . import supplier_payments_service

logger = logging.getLogger(__name__)

SCHEDULE_LABEL = os.getenv(
  "PAGAMENTI_WATCH_SCHEDULE_LABEL",
  "automatico · martedì e venerdì alle 7:30 (e dopo ogni bonifico scaricato)",
).strip()
LOCK_STALE_SEC = 30 * 60
# Periodo scarico movimenti (giorni indietro). Default 120.
SYNC_LOOKBACK_DAYS = max(7, int(os.getenv("BANK_RECON_AGENT_DAYS", "120") or "120"))
AUTO_RECON_LIMIT = max(40, int(os.getenv("BANK_RECON_AGENT_LIMIT", "200") or "200"))


def _data_dir() -> Path:
  return Path(__file__).resolve().parents[2] / "data"


def _state_path() -> Path:
  raw = (os.getenv("PAGAMENTI_WATCH_STATE_PATH") or "").strip()
  return Path(raw) if raw else _data_dir() / "pagamenti_watch_agent.json"


def _lock_path() -> Path:
  return _state_path().with_suffix(".lock")


def default_status() -> Dict[str, Any]:
  return {
    "ok": True,
    "agent": "riconciliazione_bancaria",
    "schedule": SCHEDULE_LABEL,
    "last_run_at": None,
    "last_ok": None,
    "skipped": False,
    "reason": "",
    "message": "Agente non ha ancora eseguito un controllo.",
    "file": {},
    "bank": {},
    "accounts": [],
    "marked_paid": 0,
    "linked_movements": 0,
    "items": [],
  }


def read_status() -> Dict[str, Any]:
  path = _state_path()
  data = default_status()
  if not path.is_file():
    return data
  try:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
      data.update(raw)
  except Exception:
    logger.warning("Stato agente riconciliazione illeggibile: %s", path, exc_info=True)
  data["schedule"] = SCHEDULE_LABEL
  data["agent"] = "riconciliazione_bancaria"
  return data


def _write_status(payload: Dict[str, Any]) -> None:
  path = _state_path()
  path.parent.mkdir(parents=True, exist_ok=True)
  tmp = path.with_suffix(path.suffix + ".tmp")
  tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
  tmp.replace(path)


def _acquire_lock() -> bool:
  path = _lock_path()
  path.parent.mkdir(parents=True, exist_ok=True)
  try:
    if path.is_file() and (time.time() - path.stat().st_mtime) > LOCK_STALE_SEC:
      path.unlink(missing_ok=True)
  except OSError:
    pass
  try:
    fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    try:
      os.write(fd, str(os.getpid()).encode("ascii", "replace"))
    finally:
      os.close(fd)
    return True
  except FileExistsError:
    return False
  except OSError:
    logger.warning("Lock agente riconciliazione non disponibile", exc_info=True)
    return True


def _release_lock() -> None:
  try:
    _lock_path().unlink(missing_ok=True)
  except OSError:
    pass


def _file_fingerprint(db: Session) -> Dict[str, Any]:
  rows = supplier_payments_service.list_paid_document_rows(db, all_workbooks=True)
  cash_rows = supplier_payments_service.list_cash_paid_document_rows(db, all_workbooks=True)
  parts = []
  for row in rows:
    parts.append(
      "|".join(
        [
          str(row.get("workbook_key") or ""),
          str(row.get("sheet") or ""),
          str(row.get("invoice_number_norm") or ""),
          str(row.get("supplier_name_norm") or ""),
          f"{float(row.get('amount_paid') or 0):.2f}",
          str(row.get("payment_date") or ""),
          "1" if row.get("is_cash_payment") else "0",
        ]
      )
    )
  digest = hashlib.sha256("\n".join(sorted(parts)).encode("utf-8")).hexdigest()[:32]
  catalog = supplier_payments_service.list_workbook_catalog(db)
  updated_times = [c.get("updated_at") for c in catalog if c.get("updated_at")]
  updated = max(updated_times) if updated_times else None
  return {
    "updated_at": updated,
    "paid_rows": len(rows),
    "cash_rows": len(cash_rows),
    "fingerprint": digest,
    "workbooks": len(catalog),
    "title": "file fornitori (tutte le società)",
  }


def _bank_fingerprint(db: Session) -> Dict[str, Any]:
  count = int(db.query(func.count(BankMovement.id)).scalar() or 0)
  matched = int(
    db.query(func.count(BankMovement.id))
    .filter(BankMovement.matched_invoice_id.isnot(None))
    .scalar()
    or 0
  )
  max_id = db.query(func.max(BankMovement.id)).scalar()
  max_date = db.query(func.max(BankMovement.movement_date)).scalar()
  return {
    "movement_count": count,
    "matched_count": matched,
    "max_id": int(max_id) if max_id is not None else 0,
    "max_date": max_date.isoformat() if max_date else None,
  }


def _fingerprints_equal(left: Optional[Dict[str, Any]], right: Optional[Dict[str, Any]], keys: Tuple[str, ...]) -> bool:
  a = left or {}
  b = right or {}
  return all(a.get(k) == b.get(k) for k in keys)


def _sync_enable_banking_accounts(db: Session) -> Tuple[int, List[Dict[str, Any]]]:
  from .enable_banking_service import sync_enable_banking_account

  date_from = date.today() - timedelta(days=SYNC_LOOKBACK_DAYS)
  date_to = date.today()
  rows = (
    db.query(BankAccount)
    .filter(BankAccount.is_active.is_(True), BankAccount.eb_account_uid.isnot(None))
    .order_by(BankAccount.id.asc())
    .all()
  )
  imported_total = 0
  accounts: List[Dict[str, Any]] = []
  for row in rows:
    item: Dict[str, Any] = {
      "id": row.id,
      "label": f"{row.bank_name} · {row.account_name}",
      "company": (row.company or "").strip() or None,
      "imported": 0,
      "date_from": date_from.isoformat(),
      "date_to": date_to.isoformat(),
    }
    try:
      res = sync_enable_banking_account(
        db,
        int(row.id),
        sync_payments=False,
        date_from=date_from,
        date_to=date_to,
      )
      imported = int(res.get("imported") or 0)
      item["imported"] = imported
      imported_total += imported
    except Exception as exc:  # noqa: BLE001 — un conto non deve fermare gli altri
      item["error"] = str(exc)[:240]
      logger.warning("Agente riconciliazione: sync conto %s fallito", row.id, exc_info=True)
    accounts.append(item)
  return imported_total, accounts


def _reconcile_all_companies(db: Session) -> Dict[str, Any]:
  """Abbina movimenti↔fatture (causale/n./importo) + contanti da file, per ogni società."""
  linked: List[Dict[str, Any]] = []
  marked_items: List[Dict[str, Any]] = []
  reopened_items: List[Dict[str, Any]] = []
  companies = list(SDI_COMPANY_ORDER) + [None]
  seen_mark = set()
  seen_reopen = set()
  seen_link = set()
  errors: List[Dict[str, Any]] = []

  for company in companies:
    try:
      res = banca_service.auto_reconcile(db, company=company, limit=AUTO_RECON_LIMIT)
    except Exception as exc:  # noqa: BLE001
      logger.warning("Agente: auto_reconcile fallito company=%s", company, exc_info=True)
      errors.append({"company": company or "", "error": str(exc)[:240]})
      continue

    for item in res.get("auto_applied_items") or []:
      mid = item.get("movement_id")
      iid = item.get("invoice_id")
      key = (int(mid) if mid else 0, int(iid) if iid else 0, str(item.get("reason") or item.get("match_quality") or ""))
      if key in seen_link or (not mid and not iid):
        continue
      seen_link.add(key)
      if mid:
        linked.append(item)
      else:
        # sync_payment_status items senza movement_id (es. contanti)
        marked_items.append(item)

    bank_sync = res.get("bank_sync") or {}
    for item in bank_sync.get("items") or []:
      iid = int(item.get("invoice_id") or 0)
      if not iid or iid in seen_mark:
        continue
      seen_mark.add(iid)
      marked_items.append(item)
    for item in bank_sync.get("reopened_items") or []:
      iid = int(item.get("invoice_id") or 0)
      if not iid or iid in seen_reopen:
        continue
      seen_reopen.add(iid)
      reopened_items.append(item)

    for err in res.get("auto_errors") or []:
      errors.append({"company": company or "", **err})

  from_file = sum(
    1 for item in marked_items if item.get("reason") in ("file_contanti", "file_pagamenti")
  )
  from_bank = sum(
    1
    for item in marked_items
    if item.get("reason") in ("numero_in_movimento", "importo_in_movimento", "matched")
  )
  return {
    "linked_movements": len(linked),
    "marked_paid": len(seen_mark) or len(marked_items),
    "marked_from_bank": from_bank,
    "marked_from_pagamenti": from_file,
    "reopened_unpaid": len(seen_reopen),
    "items": (linked + marked_items)[:100],
    "reopened_items": reopened_items[:80],
    "errors": errors[:40],
  }


def run_watch(db: Session, *, force: bool = False) -> Dict[str, Any]:
  """Sincronizza movimenti e riconcilia automaticamente fatture (banca + contanti file)."""
  if not _acquire_lock():
    status = read_status()
    status["ok"] = False
    status["message"] = "Agente già in esecuzione. Riprova tra qualche minuto."
    return status

  started = datetime.now(timezone.utc)
  previous = read_status()
  try:
    file_now = _file_fingerprint(db)
    bank_before = _bank_fingerprint(db)
    imported, accounts = _sync_enable_banking_accounts(db)
    bank_after = _bank_fingerprint(db)

    prev_file = previous.get("file") if isinstance(previous.get("file"), dict) else {}
    prev_bank = previous.get("bank") if isinstance(previous.get("bank"), dict) else {}
    file_changed = not _fingerprints_equal(
      prev_file, file_now, ("fingerprint", "paid_rows", "cash_rows", "updated_at")
    )
    bank_changed = imported > 0 or not _fingerprints_equal(
      prev_bank,
      bank_after,
      ("movement_count", "max_id"),
    )

    reasons = []
    if file_changed:
      reasons.append("file_fornitori")
    if bank_changed:
      reasons.append("movimenti_banca")
    if force and not reasons:
      reasons.append("manuale")

    skipped = not reasons
    marked = {
      "linked_movements": 0,
      "marked_paid": 0,
      "marked_from_bank": 0,
      "marked_from_pagamenti": 0,
      "reopened_unpaid": 0,
      "items": [],
      "reopened_items": [],
      "errors": [],
    }
    if not skipped:
      marked = _reconcile_all_companies(db)
      bank_after = _bank_fingerprint(db)

    reopened_n = int(marked.get("reopened_unpaid") or 0)
    linked_n = int(marked.get("linked_movements") or 0)
    paid_n = int(marked.get("marked_paid") or 0)

    if skipped:
      message = (
        "Nessuna variazione su movimenti banca né sul file fornitori: "
        "riconciliazione già allineata."
      )
    elif linked_n or paid_n or reopened_n:
      bits = []
      if linked_n:
        bits.append(f"collegati {linked_n} movimenti → fattura")
      if paid_n:
        bits.append(
          f"segnate pagate {paid_n} "
          f"({marked.get('marked_from_bank') or 0} da banca, "
          f"{marked.get('marked_from_pagamenti') or 0} contanti da file)"
        )
      if reopened_n:
        bits.append(f"riaperte da pagare {reopened_n} (senza prova banca/contanti)")
      message = f"Riconciliazione automatica ({', '.join(reasons)}): " + "; ".join(bits) + "."
    else:
      message = (
        f"Variazioni ({', '.join(reasons)}): movimenti/file aggiornati, "
        "nessun nuovo abbinamento sicuro."
      )

    payload = {
      "ok": True,
      "agent": "riconciliazione_bancaria",
      "schedule": SCHEDULE_LABEL,
      "last_run_at": started.isoformat(),
      "last_ok": True,
      "skipped": skipped,
      "reason": ",".join(reasons) if reasons else "nessuna_variazione",
      "force": bool(force),
      "message": message,
      "lookback_days": SYNC_LOOKBACK_DAYS,
      "file": file_now,
      "bank": {
        **bank_after,
        "imported": imported,
        "before_count": bank_before.get("movement_count"),
      },
      "accounts": accounts,
      "linked_movements": linked_n,
      "marked_paid": paid_n,
      "marked_from_bank": int(marked.get("marked_from_bank") or 0),
      "marked_from_pagamenti": int(marked.get("marked_from_pagamenti") or 0),
      "reopened_unpaid": reopened_n,
      "items": marked.get("items") or [],
      "reopened_items": marked.get("reopened_items") or [],
      "errors": marked.get("errors") or [],
      # compat UI Pagamenti
      "marked": {
        "marked_paid": paid_n,
        "marked_from_pagamenti": int(marked.get("marked_from_pagamenti") or 0),
        "reopened_unpaid": reopened_n,
        "linked_movements": linked_n,
      },
    }
    _write_status(payload)
    return payload
  except Exception as exc:  # noqa: BLE001
    logger.exception("Agente riconciliazione: controllo fallito")
    payload = {
      **previous,
      "ok": False,
      "agent": "riconciliazione_bancaria",
      "schedule": SCHEDULE_LABEL,
      "last_run_at": started.isoformat(),
      "last_ok": False,
      "skipped": False,
      "reason": "errore",
      "message": f"Controllo fallito: {exc}"[:400],
    }
    try:
      _write_status(payload)
    except OSError:
      pass
    return payload
  finally:
    _release_lock()


# Alias espliciti per API / documentazione
run_reconciliation_agent = run_watch
get_reconciliation_agent_status = read_status
