from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import banca_service

router = APIRouter(prefix="/banca", tags=["banca"])


class BankAccountCreate(BaseModel):
  bank_name: str = Field(..., min_length=1, max_length=160)
  account_name: str = "Conto corrente"
  iban: Optional[str] = None
  saldo_disponibile: float = 0
  saldo_contabile: float = 0
  notes: Optional[str] = None


class ReconcileBody(BaseModel):
  invoice_id: Optional[int] = None
  status: str = "matched"


class BanImportMovement(BaseModel):
  movement_date: str
  description: Optional[str] = None
  causale: Optional[str] = None
  movement_type: str
  amount: float
  counterparty: Optional[str] = None


class BanImportBody(BaseModel):
  movements: List[BanImportMovement] = Field(default_factory=list)


class BankOtpBody(BaseModel):
  otp: str = Field(..., min_length=4, max_length=12)


@router.get("/dashboard")
def banca_dashboard(db: Session = Depends(get_db)) -> Dict[str, Any]:
  return banca_service.get_dashboard(db)


@router.get("/connect-profile")
def banca_connect_profile() -> Dict[str, Any]:
  from ..services.bank_connect_otp_service import get_bank_env_profile

  return get_bank_env_profile()


@router.get("/accounts")
def banca_accounts(db: Session = Depends(get_db)) -> Dict[str, Any]:
  return {"items": banca_service.list_accounts(db)}


@router.post("/accounts")
def banca_create_account(body: BankAccountCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
  return banca_service.create_account(db, body.model_dump())


@router.post("/accounts/{account_id}/import-ban")
def banca_import_ban(account_id: int, body: BanImportBody, db: Session = Depends(get_db)) -> Dict[str, Any]:
  try:
    return banca_service.import_ban_movements(
      db,
      account_id,
      [m.model_dump() for m in body.movements],
    )
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/accounts/{account_id}/connect")
def banca_connect(account_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
  """Avvia collegamento: login con credenziali .env + invio OTP."""
  try:
    return banca_service.begin_bank_login(db, account_id)
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e)) from e
  except RuntimeError as e:
    raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/accounts/{account_id}/connect-otp")
def banca_connect_otp(account_id: int, body: BankOtpBody, db: Session = Depends(get_db)) -> Dict[str, Any]:
  try:
    return banca_service.confirm_bank_login(db, account_id, body.otp)
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/accounts/{account_id}/disconnect")
def banca_disconnect(account_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
  try:
    return banca_service.set_connection(db, account_id, False)
  except ValueError as e:
    raise HTTPException(status_code=404, detail=str(e)) from e


@router.delete("/accounts/{account_id}")
def banca_delete_account(account_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
  try:
    return banca_service.delete_account(db, account_id)
  except ValueError as e:
    raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/accounts/{account_id}/delete")
def banca_delete_account_post(account_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
  try:
    return banca_service.delete_account(db, account_id)
  except ValueError as e:
    raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/accounts/{account_id}/sync")
def banca_sync(account_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
  try:
    return banca_service.sync_account_from_cash(db, account_id)
  except ValueError as e:
    raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/movimenti")
def banca_movimenti(
  account_id: Optional[int] = Query(None),
  date_from: Optional[date] = Query(None),
  date_to: Optional[date] = Query(None),
  category: Optional[str] = Query(None),
  counterparty: Optional[str] = Query(None),
  limit: int = Query(200, ge=1, le=500),
  db: Session = Depends(get_db),
) -> Dict[str, Any]:
  items = banca_service.list_movements(
    db,
    account_id=account_id,
    date_from=date_from,
    date_to=date_to,
    category=category,
    counterparty=counterparty,
    limit=limit,
  )
  return {"items": items, "count": len(items)}


@router.get("/riconciliazione")
def banca_riconciliazione(db: Session = Depends(get_db)) -> Dict[str, Any]:
  return banca_service.reconciliation_preview(db)


@router.post("/movimenti/{movement_id}/riconcilia")
def banca_riconcilia(movement_id: int, body: ReconcileBody, db: Session = Depends(get_db)) -> Dict[str, Any]:
  try:
    return banca_service.apply_match(db, movement_id, body.invoice_id, body.status)
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e)) from e
