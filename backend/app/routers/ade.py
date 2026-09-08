"""API profili AdE / credenziali Fisconline (UI Impostazioni fatture)."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import config as _config  # noqa: F401 — carica .env (ADE_PROFILES_PATH)
from ..integrations.ade.profiles import profiles_public_list, update_fisconline_credentials

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


@router.get("/profiles")
def list_ade_profiles() -> Dict[str, Any]:
  """Elenco profili AdE senza segreti in chiaro."""
  try:
    items = profiles_public_list()
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Errore lettura profili: {e}") from e
  return {"items": items, "count": len(items)}


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
  return {"ok": True, **result}
