"""Agente: due volte a settimana confronta file Pagamenti e movimenti banca.

Se il file o i movimenti sono cambiati rispetto all'ultimo controllo,
aggiorna lo stato pagamento delle fatture (stesso n. documento + fornitore / importo).
Non riapre le già pagate.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
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

SCHEDULE_LABEL = os.getenv("PAGAMENTI_WATCH_SCHEDULE_LABEL", "martedì e venerdì alle 7:30").strip()
LOCK_STALE_SEC = 30 * 60


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
    logger.warning("Stato agente pagamenti illeggibile: %s", path, exc_info=True)
  data["schedule"] = SCHEDULE_LABEL
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
    logger.warning("Lock agente pagamenti non disponibile", exc_info=True)
    return True


def _release_lock() -> None:
  try:
    _lock_path().unlink(missing_ok=True)
  except OSError:
    pass


def _file_fingerprint(db: Session) -> Dict[str, Any]:
  wb = supplier_payments_service.get_workbook(db)
  rows = supplier_payments_service.list_paid_document_rows(db)
  parts = []
  for row in rows:
    parts.append(
      "|".join(
        [
          str(row.get("sheet") or ""),
          str(row.get("invoice_number_norm") or ""),
          str(row.get("supplier_name_norm") or ""),
          f"{float(row.get('amount_paid') or 0):.2f}",
          str(row.get("payment_date") or ""),
        ]
      )
    )
  digest = hashlib.sha256("\n".join(sorted(parts)).encode("utf-8")).hexdigest()[:32]
  updated = wb.updated_at.isoformat() if getattr(wb, "updated_at", None) else None
  return {
    "updated_at": updated,
    "paid_rows": len(rows),
    "fingerprint": digest,
    "title": wb.title,
  }


def _bank_fingerprint(db: Session) -> Dict[str, Any]:
  count = int(db.query(func.count(BankMovement.id)).scalar() or 0)
  max_id = db.query(func.max(BankMovement.id)).scalar()
  max_date = db.query(func.max(BankMovement.movement_date)).scalar()
  return {
    "movement_count": count,
    "max_id": int(max_id) if max_id is not None else 0,
    "max_date": max_date.isoformat() if max_date else None,
  }


def _fingerprints_equal(left: Optional[Dict[str, Any]], right: Optional[Dict[str, Any]], keys: Tuple[str, ...]) -> bool:
  a = left or {}
  b = right or {}
  return all(a.get(k) == b.get(k) for k in keys)


def _sync_enable_banking_accounts(db: Session) -> Tuple[int, List[Dict[str, Any]]]:
  from .enable_banking_service import sync_enable_banking_account

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
    }
    try:
      res = sync_enable_banking_account(db, int(row.id), sync_payments=False)
      imported = int(res.get("imported") or 0)
      item["imported"] = imported
      imported_total += imported
    except Exception as exc:  # noqa: BLE001 — un conto non deve fermare gli altri
      item["error"] = str(exc)[:240]
      logger.warning("Agente pagamenti: sync conto %s fallito", row.id, exc_info=True)
    accounts.append(item)
  return imported_total, accounts


def _mark_paid_from_evidence(db: Session) -> Dict[str, Any]:
  marked_items: List[Dict[str, Any]] = []
  companies = list(SDI_COMPANY_ORDER) + [None]
  seen = set()
  for company in companies:
    res = banca_service.sync_payment_status_from_bank(db, company=company)
    for item in res.get("items") or []:
      key = int(item.get("invoice_id") or 0)
      if not key or key in seen:
        continue
      seen.add(key)
      marked_items.append(item)
  from_file = sum(1 for item in marked_items if item.get("reason") == "file_pagamenti")
  return {
    "marked_paid": len(marked_items),
    "marked_from_pagamenti": from_file,
    "items": marked_items[:80],
  }


def run_watch(db: Session, *, force: bool = False) -> Dict[str, Any]:
  """Controlla file + movimenti; aggiorna le fatture solo se c'è una variazione."""
  if not _acquire_lock():
    status = read_status()
    status["ok"] = False
    status["message"] = "Controllo già in corso. Riprova tra qualche minuto."
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
    file_changed = not _fingerprints_equal(prev_file, file_now, ("fingerprint", "paid_rows", "updated_at"))
    bank_changed = imported > 0 or not _fingerprints_equal(
      prev_bank,
      bank_after,
      ("movement_count", "max_id"),
    )

    reasons = []
    if file_changed:
      reasons.append("file_pagamenti")
    if bank_changed:
      reasons.append("movimenti_banca")
    if force and not reasons:
      reasons.append("manuale")

    skipped = not reasons
    marked = {"marked_paid": 0, "marked_from_pagamenti": 0, "items": []}
    if not skipped:
      marked = _mark_paid_from_evidence(db)

    if skipped:
      message = "Nessuna variazione su file Pagamenti né sui movimenti banca: nessun aggiornamento."
    elif marked["marked_paid"]:
      message = (
        f"Variazioni ({', '.join(reasons)}): aggiornate {marked['marked_paid']} fatture "
        f"({marked['marked_from_pagamenti']} da file Pagamenti)."
      )
    else:
      message = (
        f"Variazioni ({', '.join(reasons)}): movimenti/file aggiornati, "
        "nessuna nuova fattura da segnare pagata."
      )

    payload = {
      "ok": True,
      "schedule": SCHEDULE_LABEL,
      "last_run_at": started.isoformat(),
      "last_ok": True,
      "skipped": skipped,
      "reason": ",".join(reasons) if reasons else "nessuna_variazione",
      "force": bool(force),
      "message": message,
      "file": file_now,
      "bank": {
        **bank_after,
        "imported": imported,
        "before_count": bank_before.get("movement_count"),
      },
      "accounts": accounts,
      "marked_paid": marked["marked_paid"],
      "marked_from_pagamenti": marked["marked_from_pagamenti"],
      "items": marked["items"],
    }
    _write_status(payload)
    return payload
  except Exception as exc:  # noqa: BLE001
    logger.exception("Agente pagamenti: controllo fallito")
    payload = {
      **previous,
      "ok": False,
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
