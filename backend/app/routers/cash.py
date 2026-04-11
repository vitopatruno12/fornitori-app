import io
from datetime import datetime, date
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.cash import (
    CashEntryCreate,
    CashEntryRead,
    CashEntryWithBalance,
    DailySummary,
    PrimaNotaLinkOptions,
)
from ..services import cash_service

router = APIRouter(prefix="/cash", tags=["cash"])


@router.get("/entries", response_model=List[CashEntryWithBalance])
def list_entries(
    date_from: Optional[str] = Query(None, description="Data inizio (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Data fine (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    dt_from = datetime.fromisoformat(date_from) if date_from else None
    dt_to = datetime.fromisoformat(date_to + "T23:59:59") if date_to else None
    return cash_service.list_entries_with_balance(db, date_from=dt_from, date_to=dt_to)


@router.get("/entries/{entry_id}", response_model=CashEntryRead)
def get_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = cash_service.get_entry(db, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimento non trovato")
    return entry


@router.post("/entries", response_model=CashEntryRead)
def create_entry(data: CashEntryCreate, db: Session = Depends(get_db)):
    return cash_service.create_entry(db, data)


@router.put("/entries/{entry_id}", response_model=CashEntryRead)
def update_entry(entry_id: int, data: CashEntryCreate, db: Session = Depends(get_db)):
    entry = cash_service.update_entry(db, entry_id, data)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimento non trovato")
    return entry


@router.delete("/entries/day", status_code=status.HTTP_204_NO_CONTENT)
def delete_entries_for_day(
    date_str: str = Query(..., description="Data (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Data non valida")
    cash_service.delete_entries_for_day(db, d)


@router.delete("/entries/range", status_code=status.HTTP_204_NO_CONTENT)
def delete_entries_for_range(
    date_from: str = Query(..., description="Data inizio (YYYY-MM-DD)"),
    date_to: str = Query(..., description="Data fine (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    try:
        d_from = date.fromisoformat(date_from)
        d_to = date.fromisoformat(date_to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Intervallo date non valido")
    if d_from > d_to:
        raise HTTPException(status_code=400, detail="Data inizio successiva alla data fine")
    cash_service.delete_entries_for_range(db, d_from, d_to)


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    deleted = cash_service.delete_entry(db, entry_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimento non trovato")


@router.get("/link-options", response_model=PrimaNotaLinkOptions)
def get_prima_nota_link_options(db: Session = Depends(get_db)):
    return cash_service.get_link_options(db)


@router.get("/summary", response_model=DailySummary)
def get_daily_summary(
    date_str: str = Query(..., description="Data (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Data non valida")
    return cash_service.get_daily_summary(db, d)


@router.get("/export/csv")
def export_csv(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    dt_from = datetime.fromisoformat(date_from) if date_from else None
    dt_to = datetime.fromisoformat(date_to + "T23:59:59") if date_to else None
    rows = cash_service.get_entries_for_export(db, date_from=dt_from, date_to=dt_to)

    def _esc(s):
        return (s or "").replace(";", ",")

    buf = io.StringIO()
    buf.write("Data;Tipo;Importo;Descrizione;Conto;Rif. documento fiscale;Note\n")
    for r in rows:
        buf.write(
            f"{r['data'][:10]};{r['tipo']};{r['importo']:.2f};{_esc(r['descrizione'])};{_esc(r['conto'])};{_esc(r['riferimento_documento'])};{_esc(r['note'])}\n"
        )

    buf.seek(0)
    part_from = (date_from or "inizio").replace(":", "-")[:10]
    part_to = (date_to or "oggi").replace(":", "-")[:10] if date_to else "oggi"
    filename = f"prima_nota_{part_from}_{part_to}.csv"
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
