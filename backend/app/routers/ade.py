"""API profili AdE / credenziali Fisconline (UI Impostazioni fatture)."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from .. import config as _config  # noqa: F401 — carica .env (ADE_PROFILES_PATH)
from ..integrations.ade.agent_status import default_status, read_status, write_status
from ..integrations.ade.profiles import (
  ensure_profiles_file,
  profiles_public_list,
  resolve_profiles_path,
  update_fisconline_credentials,
)

router = APIRouter(prefix="/ade", tags=["ade"])


class FisconlineCredentialsUpdate(BaseModel):
  fisconline_password: Optional[str] = Field(
    default=None,
    description="Nuova password Fisconline. Omesso = non modificare.",
  )
  fisconline_pin: Optional[str] = Field(
    default=None,
    description="Nuovo PIN Fisconline. Omesso = non modificare.",
  )


class AdeAgentStatusUpdate(BaseModel):
  phase: Optional[str] = None
  mode: Optional[str] = None
  message: Optional[str] = None
  profile_id: Optional[str] = None
  progress: Optional[int] = None
  running: Optional[bool] = None
  ok: Optional[bool] = None
  error: Optional[str] = None
  updated_at: Optional[str] = None
  finished_at: Optional[str] = None


def _optional_bearer(expected: Optional[str], authorization: Optional[str]) -> None:
  tok = (expected or "").strip()
  if not tok:
    return
  auth = (authorization or "").strip()
  if auth.lower().startswith("bearer "):
    got = auth[7:].strip()
  else:
    got = auth
  if got != tok:
    raise HTTPException(status_code=401, detail="Token non valido")


@router.get("/profiles")
def list_ade_profiles() -> Dict[str, Any]:
  """Elenco profili AdE senza segreti in chiaro."""
  try:
    path = ensure_profiles_file()
    items = profiles_public_list(path)
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Errore lettura profili: {e}") from e
  resolved = resolve_profiles_path()
  return {
    "items": items,
    "count": len(items),
    "profiles_path": str(path),
    "profiles_path_exists": path.is_file(),
    "ade_profiles_path_env": (os.getenv("ADE_PROFILES_PATH") or "").strip() or None,
    "resolved_path": str(resolved),
  }


@router.put("/profiles/{profile_id}/credentials")
def put_ade_profile_credentials(profile_id: str, body: FisconlineCredentialsUpdate) -> Dict[str, Any]:
  """Aggiorna password/PIN Fisconline nel file profiles.json usato dall'agent."""
  if body.fisconline_password is None and body.fisconline_pin is None:
    raise HTTPException(status_code=400, detail="Indica almeno password o PIN da aggiornare")
  try:
    result = update_fisconline_credentials(
      profile_id,
      password=body.fisconline_password,
      pin=body.fisconline_pin,
    )
  except FileNotFoundError as e:
    raise HTTPException(status_code=404, detail=str(e)) from e
  except KeyError as e:
    raise HTTPException(status_code=404, detail=str(e)) from e
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e)) from e
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Salvataggio credenziali fallito: {e}") from e
  if body.fisconline_password is not None:
    from ..integrations.ade.password_alerts import dismiss_alert

    dismiss_alert(profile_id)
  return {"ok": True, **result}


class AdePasswordAlertIn(BaseModel):
  profile_id: str
  label: str = ""
  level: str = "expiring"
  message: str = ""
  days_left: Optional[int] = None


@router.get("/password-alerts")
def get_ade_password_alerts() -> Dict[str, Any]:
  """Avvisi password Fisconline letti dal sito Agenzia delle Entrate."""
  from ..integrations.ade.password_alerts import list_alerts

  items = list_alerts()
  return {"items": items, "count": len(items)}


@router.post("/password-alerts")
def post_ade_password_alert(
  body: AdePasswordAlertIn,
  authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
  """L'agent AdE registra l'avviso letto sulla pagina di login."""
  from ..integrations.ade.password_alerts import upsert_alert

  _optional_bearer(os.getenv("SDI_RECEIVE_TOKEN"), authorization)
  try:
    row = upsert_alert(
      profile_id=body.profile_id,
      label=body.label,
      level=body.level,
      message=body.message,
      days_left=body.days_left,
    )
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e)) from e
  return {"ok": True, "item": row}


@router.post("/password-alerts/{profile_id}/dismiss")
def dismiss_ade_password_alert(profile_id: str) -> Dict[str, Any]:
  from ..integrations.ade.password_alerts import dismiss_alert

  dismiss_alert(profile_id)
  return {"ok": True, "profile_id": profile_id}


@router.get("/agent/status")
def get_ade_agent_status() -> Dict[str, Any]:
  """Stato sync AdE (barra caricamento / toast assistente)."""
  try:
    return read_status()
  except Exception:
    return default_status()


@router.post("/agent/run")
def post_ade_agent_run(
  mode: str = "download",
  lookback_days: Optional[int] = None,
  profile_id: Optional[str] = None,
  authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
  """
  Avvia (o mette in coda) lo scarico fatture da Agenzia delle Entrate.
  - Se ADE_RUN_LOCAL=1 sul server: lancia l'agent in background.
  - Altrimenti: il PC ufficio (listener) prende la coda e scarica con Fisconline.
  """
  from ..integrations.ade.agent_status import request_run
  from ..integrations.ade import agent_runner

  # Opzionale: proteggi con lo stesso token SDI se impostato
  _optional_bearer(os.getenv("SDI_RECEIVE_TOKEN") if os.getenv("ADE_RUN_REQUIRE_TOKEN") else None, authorization)

  status = request_run(
    mode=mode,
    lookback_days=lookback_days,
    requested_by="ui",
    profile_id=profile_id,
  )
  local = agent_runner.try_spawn_local()
  return {
    "ok": True,
    "queued": bool(status.get("run_requested") or status.get("running") or local.get("started")),
    "local": local,
    "status": status,
    "message": status.get("message")
    or (
      "Scarico AdE avviato sul server."
      if local.get("started")
      else "Richiesta in coda: il PC ufficio con l'agent AdE la eseguirà a breve."
    ),
  }


@router.put("/agent/status")
def put_ade_agent_status(
  body: AdeAgentStatusUpdate,
  authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
  """Aggiornamento stato da agent PC ufficio."""
  _optional_bearer(os.getenv("SDI_RECEIVE_TOKEN"), authorization)
  fields = {k: v for k, v in body.model_dump().items() if v is not None}
  try:
    return write_status(push_remote=False, **fields)
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Salvataggio stato fallito: {e}") from e
