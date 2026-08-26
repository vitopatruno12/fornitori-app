from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
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


class EnableBankingAuthBody(BaseModel):
  aspsp_name: Optional[str] = None
  aspsp_country: Optional[str] = None
  psu_type: Optional[str] = "personal"


@router.get("/dashboard")
def banca_dashboard(db: Session = Depends(get_db)) -> Dict[str, Any]:
  return banca_service.get_dashboard(db)


@router.get("/connect-profile")
def banca_connect_profile() -> Dict[str, Any]:
  from ..services.bank_connect_otp_service import get_bank_env_profile
  from ..services.enable_banking_service import get_enable_banking_config

  profile = get_bank_env_profile()
  profile["enable_banking"] = get_enable_banking_config()
  return profile


@router.get("/enable-banking/status")
def banca_enable_banking_status() -> Dict[str, Any]:
  from ..services.enable_banking_service import get_application, get_enable_banking_config

  cfg = get_enable_banking_config()
  out: Dict[str, Any] = {"config": cfg}
  if cfg.get("configured"):
    try:
      out["application"] = get_application()
    except Exception as e:
      out["application_error"] = str(e)
  return out


@router.get("/enable-banking/aspsps")
def banca_enable_banking_aspsps(country: Optional[str] = Query(None)) -> Dict[str, Any]:
  from ..services.enable_banking_service import list_aspsps

  try:
    return {"items": list_aspsps(country=country)}
  except RuntimeError as e:
    raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/accounts/{account_id}/enable-banking/auth")
def banca_enable_banking_auth(
  account_id: int,
  body: Optional[EnableBankingAuthBody] = None,
  db: Session = Depends(get_db),
) -> Dict[str, Any]:
  """Avvia POST /auth Enable Banking e restituisce l'URL di login banca."""
  from ..services.enable_banking_service import begin_enable_banking_connect

  payload = body or EnableBankingAuthBody()
  try:
    return begin_enable_banking_connect(
      db,
      account_id,
      aspsp_name=payload.aspsp_name,
      aspsp_country=payload.aspsp_country,
    )
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e)) from e
  except RuntimeError as e:
    raise HTTPException(status_code=502, detail=str(e)) from e


@router.get("/callback")
def banca_enable_banking_callback(
  code: Optional[str] = Query(None),
  state: Optional[str] = Query(None),
  error: Optional[str] = Query(None),
  error_description: Optional[str] = Query(None),
  db: Session = Depends(get_db),
):
  """Callback OAuth: scambia code → session e importa conti/movimenti."""
  from ..services.enable_banking_service import (
    complete_enable_banking_callback,
    frontend_error_redirect,
  )

  if error:
    msg = error_description or error or "Autorizzazione annullata"
    return RedirectResponse(url=frontend_error_redirect(str(msg)), status_code=302)
  try:
    result = complete_enable_banking_callback(db, code=code or "", state=state)
    return RedirectResponse(url=result["redirect_to"], status_code=302)
  except (ValueError, RuntimeError) as e:
    return RedirectResponse(url=frontend_error_redirect(str(e)), status_code=302)
  except Exception as e:
    return RedirectResponse(url=frontend_error_redirect(f"Errore inatteso: {e}"), status_code=302)


@router.post("/accounts/{account_id}/enable-banking/sync")
def banca_enable_banking_sync(account_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
  from ..services.enable_banking_service import sync_enable_banking_account

  try:
    return sync_enable_banking_account(db, account_id)
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e)) from e
  except RuntimeError as e:
    raise HTTPException(status_code=502, detail=str(e)) from e


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
