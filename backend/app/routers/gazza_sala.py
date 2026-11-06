from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import gazza_sala_service

router = APIRouter(prefix="/gazza-sala", tags=["gazza-sala"])


class SalaRowIn(BaseModel):
    table_id: int
    status: str = "libero"
    clients: str = ""
    reservation_name: str = ""
    invoice_number: str = ""
    payment_type: str = ""
    paid: str = ""
    waiter: str = ""
    paid_total: str = ""
    clear_counter: bool = False


class SalaTableUpdate(BaseModel):
    date: str
    fascia: str
    row: SalaRowIn


class SalaPaidIn(BaseModel):
    date: str
    fascia: str
    table_id: int = Field(..., ge=1, le=15)
    row: Optional[SalaRowIn] = None


class SalaResetIn(BaseModel):
    date: str
    fascia: str


class SalaHistoryDeleteIn(BaseModel):
    date: str
    fascia: str
    id: str = Field(..., min_length=1, max_length=80)


class SalaImportIn(BaseModel):
    date: str
    fascia: str
    tables: List[Any] = []
    history: List[Any] = []


def _value_error(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


@router.get("")
def read_sheet(
    date: str = Query(..., min_length=10, max_length=10),
    fascia: str = Query(..., min_length=3, max_length=16),
    db: Session = Depends(get_db),
):
    try:
        return gazza_sala_service.get_sheet(db, date, fascia)
    except ValueError as exc:
        raise _value_error(exc) from exc


@router.put("/tavolo")
def save_table(payload: SalaTableUpdate, db: Session = Depends(get_db)):
    try:
        return gazza_sala_service.save_table(db, payload.date, payload.fascia, payload.row.model_dump())
    except ValueError as exc:
        raise _value_error(exc) from exc


@router.post("/pagato")
def mark_paid(payload: SalaPaidIn, db: Session = Depends(get_db)):
    try:
        source = payload.row.model_dump() if payload.row is not None else None
        return gazza_sala_service.mark_table_paid(db, payload.date, payload.fascia, payload.table_id, source)
    except ValueError as exc:
        raise _value_error(exc) from exc


@router.post("/storico/elimina")
def delete_history(payload: SalaHistoryDeleteIn, db: Session = Depends(get_db)):
    try:
        return gazza_sala_service.delete_history_entry(db, payload.date, payload.fascia, payload.id)
    except ValueError as exc:
        raise _value_error(exc) from exc


@router.post("/azzera")
def reset_sheet(payload: SalaResetIn, db: Session = Depends(get_db)):
    try:
        return gazza_sala_service.reset_sheet(db, payload.date, payload.fascia)
    except ValueError as exc:
        raise _value_error(exc) from exc


@router.post("/importa")
def import_sheet(payload: SalaImportIn, db: Session = Depends(get_db)):
    try:
        return gazza_sala_service.import_if_empty(
            db,
            payload.date,
            payload.fascia,
            payload.tables,
            payload.history,
        )
    except ValueError as exc:
        raise _value_error(exc) from exc
