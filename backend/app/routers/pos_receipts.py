from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import pos_receipts_service

router = APIRouter(prefix="/pos-receipts", tags=["pos-receipts"])


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
