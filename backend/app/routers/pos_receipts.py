import hmac
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import pos_receipts_service

router = APIRouter(prefix="/pos-receipts", tags=["pos-receipts"])


def _sync_token_ok(provided: Optional[str]) -> bool:
    expected = (os.getenv("EASYRETAIL_SYNC_TOKEN") or os.getenv("POS_RECEIPTS_SYNC_TOKEN") or "").strip()
    if not expected:
        # Dev: allow without token if explicitly enabled
        return (os.getenv("EASYRETAIL_SYNC_ALLOW_OPEN") or "").strip().lower() in ("1", "true", "yes")
    if not provided:
        return False
    return hmac.compare_digest(provided.strip(), expected)


def _require_sync_token(x_atlas_sync_token: Optional[str] = Header(None, alias="X-Atlas-Sync-Token")):
    if not _sync_token_ok(x_atlas_sync_token):
        raise HTTPException(
            status_code=401,
            detail="Token sync mancante o non valido (header X-Atlas-Sync-Token / EASYRETAIL_SYNC_TOKEN)",
        )


def _require_sync_token_or_server_gdb(x_atlas_sync_token: Optional[str] = Header(None, alias="X-Atlas-Sync-Token")):
    """Ingest richiede token; sync-gdb sul server abilitato può partire senza header."""
    if _sync_token_ok(x_atlas_sync_token):
        return
    from ..services.easyretail_gdb_service import gdb_config_from_env

    cfg = gdb_config_from_env()
    if cfg.get("enabled") and cfg.get("dsn"):
        return
    raise HTTPException(
        status_code=401,
        detail="Token sync mancante o sync GDB server non abilitata",
    )


@router.get("/stats")
def pos_receipts_stats(db: Session = Depends(get_db)):
    return pos_receipts_service.pos_receipt_stats(db)


@router.get("/template.csv")
def pos_receipts_template():
    return PlainTextResponse(
        pos_receipts_service.csv_template(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="easyretail_scontrini_template.csv"'},
    )


@router.post("/import-csv")
async def import_pos_receipts_csv(
    file: UploadFile = File(..., description="CSV/TSV export scontrini EasyRetail"),
    model_id: Optional[str] = Form(None, description="model-1|model-2|model-3 se il CSV non ha colonna negozio"),
    db: Session = Depends(get_db),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="File vuoto")
    name = file.filename or "scontrini.csv"
    if not name.lower().endswith((".csv", ".tsv", ".txt")):
        raise HTTPException(status_code=400, detail="Carica un file CSV/TSV (esporta da EasyRetail)")
    try:
        return pos_receipts_service.import_csv_bytes(
            db,
            raw,
            default_model_id=(model_id or "").strip() or None,
            filename=name,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Import fallito: {e}") from e


class IngestBody(BaseModel):
    receipts: List[Dict[str, Any]] = Field(default_factory=list)
    model_id: Optional[str] = None


class SyncGdbBody(BaseModel):
    dsn: Optional[str] = None
    model_id: Optional[str] = None
    lookback_hours: Optional[int] = None


class PurgeModelBody(BaseModel):
    model_id: str = Field(..., description="model-1|model-2|model-3 da eliminare")
    confirm: str = Field(..., description='Deve essere esattamente "DELETE"')


@router.post("/ingest")
def ingest_pos_receipts(
    body: IngestBody,
    db: Session = Depends(get_db),
    _: None = Depends(_require_sync_token),
):
    """Riceve scontrini dall'agent GDB sul PC cassa (JSON)."""
    items = list(body.receipts or [])
    if body.model_id:
        for it in items:
            if isinstance(it, dict) and not it.get("model_id"):
                it["model_id"] = body.model_id
    try:
        return pos_receipts_service.ingest_receipt_dicts(db, items)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Ingest fallito: {e}") from e


@router.post("/sync-gdb")
def sync_pos_receipts_from_gdb(
    body: SyncGdbBody,
    db: Session = Depends(get_db),
    _: None = Depends(_require_sync_token_or_server_gdb),
):
    """Sync diretta GDB→ATLAS (solo se il server vede il file Firebird)."""
    try:
        return pos_receipts_service.sync_from_easyretail_gdb(
            db,
            dsn=(body.dsn or None),
            model_id=(body.model_id or None),
            lookback_hours=body.lookback_hours,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Sync GDB fallita: {e}") from e


@router.get("/sync-status")
def pos_receipts_sync_status():
    from ..services import easyretail_gdb_service as gdb

    cfg = gdb.gdb_config_from_env()
    token_set = bool((os.getenv("EASYRETAIL_SYNC_TOKEN") or os.getenv("POS_RECEIPTS_SYNC_TOKEN") or "").strip())
    return {
        "gdb_sync_enabled": cfg["enabled"],
        "gdb_dsn_configured": bool(cfg["dsn"]),
        "gdb_interval_sec": cfg["interval_sec"],
        "gdb_lookback_hours": cfg["lookback_hours"],
        "model_id": cfg.get("model_id"),
        "fbclient_resolved": gdb.resolve_fbclient(cfg.get("fbclient")),
        "sync_token_configured": token_set,
        "mode": "server-gdb" if cfg["enabled"] and cfg["dsn"] else "agent-push",
    }


@router.post("/purge-model")
def purge_pos_receipts_model(
    body: PurgeModelBody,
    db: Session = Depends(get_db),
    _: None = Depends(_require_sync_token),
):
    """Elimina scontrini di un model_id (cleanup import con model sbagliato)."""
    if (body.confirm or "").strip() != "DELETE":
        raise HTTPException(status_code=400, detail='confirm deve essere "DELETE"')
    try:
        return pos_receipts_service.purge_receipts_by_model(db, model_id=body.model_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Purge fallita: {e}") from e
