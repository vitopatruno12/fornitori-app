from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.bank_account import BankAccount
from ..services import banca_service

router = APIRouter(prefix="/banca", tags=["banca"])


class BankAccountCreate(BaseModel):
  bank_name: str = Field(..., min_length=1, max_length=160)
  account_name: str = "Conto corrente"
  iban: Optional[str] = None
  company: Optional[str] = None
  ledger_code: Optional[str] = "1100"
  saldo_disponibile: float = 0
  saldo_contabile: float = 0
  notes: Optional[str] = None


class BankAccountUpdate(BaseModel):
  bank_name: Optional[str] = None
  account_name: Optional[str] = None
  iban: Optional[str] = None
  company: Optional[str] = None
  ledger_code: Optional[str] = None
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
def banca_connect_profile(
  account_id: Optional[int] = Query(None, description="Profilo credenziali per conto specifico"),
  db: Session = Depends(get_db),
) -> Dict[str, Any]:
  from ..services.bank_connect_otp_service import get_bank_env_profile
  from ..services.enable_banking_service import get_enable_banking_config

  account = None
  if account_id is not None:
    for item in banca_service.list_accounts(db):
      if int(item.get("id") or 0) == int(account_id):
        account = item
        break
  profile = get_bank_env_profile(account)
  profile["enable_banking"] = get_enable_banking_config(account)
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
      psu_type=payload.psu_type or "personal",
    )
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e)) from e
  except RuntimeError as e:
    raise HTTPException(status_code=502, detail=str(e)) from e
  except Exception as e:
    raise HTTPException(
      status_code=502,
      detail=f"Enable Banking auth fallita: {type(e).__name__}: {e}",
    ) from e


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
    bank_kind = ""
    aspsp_name = ""
    app_id = ""
    try:
      from ..services.enable_banking_service import (
        _bank_kind_from_account,
        get_enable_banking_config,
        parse_state,
      )
      from ..services.enable_banking_service import enable_banking_for_account, _account_dict

      account_id = parse_state(state)
      if account_id:
        row = db.query(BankAccount).filter(BankAccount.id == account_id).first()
        bank_kind = _bank_kind_from_account(row)
        aspsp_name = (getattr(row, "eb_aspsp_name", None) or "") if row else ""
        if row:
          with enable_banking_for_account(_account_dict(row)):
            app_id = str(get_enable_banking_config().get("app_id") or "")
          if not aspsp_name:
            if bank_kind == "bcc":
              aspsp_name = "BCC Terra d'Otranto"
            elif bank_kind == "bppb":
              aspsp_name = "Banca Popolare di Puglia e Basilicata"
    except Exception:
      pass
    return RedirectResponse(
      url=frontend_error_redirect(str(msg), aspsp=aspsp_name or None, bank=bank_kind or None, app_id=app_id or None),
      status_code=302,
    )
  try:
    result = complete_enable_banking_callback(db, code=code or "", state=state)
    return RedirectResponse(url=result["redirect_to"], status_code=302)
  except (ValueError, RuntimeError) as e:
    bank_kind = ""
    aspsp_name = ""
    app_id = ""
    try:
      from ..services.enable_banking_service import (
        _bank_kind_from_account,
        get_enable_banking_config,
        parse_state,
        enable_banking_for_account,
        _account_dict,
      )

      account_id = parse_state(state)
      if account_id:
        row = db.query(BankAccount).filter(BankAccount.id == account_id).first()
        bank_kind = _bank_kind_from_account(row)
        aspsp_name = (getattr(row, "eb_aspsp_name", None) or "") if row else ""
        if row:
          with enable_banking_for_account(_account_dict(row)):
            app_id = str(get_enable_banking_config().get("app_id") or "")
          if not aspsp_name:
            if bank_kind == "bcc":
              aspsp_name = "BCC Terra d'Otranto"
            elif bank_kind == "bppb":
              aspsp_name = "Banca Popolare di Puglia e Basilicata"
    except Exception:
      pass
    return RedirectResponse(
      url=frontend_error_redirect(str(e), aspsp=aspsp_name or None, bank=bank_kind or None, app_id=app_id or None),
      status_code=302,
    )
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
def banca_accounts(
  company: Optional[str] = Query(None, description="Filtro società per mastrini (match o conti condivisi)"),
  db: Session = Depends(get_db),
) -> Dict[str, Any]:
  if company:
    return {"items": banca_service.accounts_for_company(db, company)}
  return {"items": banca_service.list_accounts(db)}


@router.post("/accounts")
def banca_create_account(body: BankAccountCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
  return banca_service.create_account(db, body.model_dump())


@router.patch("/accounts/{account_id}")
def banca_update_account(account_id: int, body: BankAccountUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
  try:
    return banca_service.update_account(db, account_id, body.model_dump(exclude_unset=True))
  except ValueError as e:
    raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/accounts/{account_id}/update")
def banca_update_account_post(account_id: int, body: BankAccountUpdate, db: Session = Depends(get_db)) -> Dict[str, Any]:
  try:
    return banca_service.update_account(db, account_id, body.model_dump(exclude_unset=True))
  except ValueError as e:
    raise HTTPException(status_code=404, detail=str(e)) from e


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


@router.post("/accounts/{account_id}/unsync")
def banca_unsync(account_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
  """Scollega Enable Banking e cancella i movimenti del conto (senza eliminare il conto)."""
  try:
    return banca_service.unsync_account(db, account_id)
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
def banca_riconciliazione(
  company: Optional[str] = Query(None, description="Filtro società (come fatture)"),
  db: Session = Depends(get_db),
) -> Dict[str, Any]:
  return banca_service.reconciliation_preview(db, company=company)


@router.post("/riconciliazione/auto")
def banca_riconciliazione_auto(
  company: Optional[str] = Query(None, description="Filtro società (come fatture)"),
  db: Session = Depends(get_db),
) -> Dict[str, Any]:
  """Riconcilia automaticamente i match sicuri (n. documento / importo esatto)."""
  return banca_service.auto_reconcile(db, company=company)


@router.post("/movimenti/{movement_id}/riconcilia")
def banca_riconcilia(movement_id: int, body: ReconcileBody, db: Session = Depends(get_db)) -> Dict[str, Any]:
  try:
    return banca_service.apply_match(db, movement_id, body.invoice_id, body.status)
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e)) from e
