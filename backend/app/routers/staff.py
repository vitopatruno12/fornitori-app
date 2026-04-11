from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import staff as staff_schema
from ..services import staff_service

router = APIRouter(prefix="/staff", tags=["staff"])


@router.get("/members", response_model=List[staff_schema.StaffMemberRead])
def list_members(db: Session = Depends(get_db)):
    return staff_service.list_members(db)


@router.get("/members/{member_id}", response_model=staff_schema.StaffMemberRead)
def get_member(member_id: int, db: Session = Depends(get_db)):
    row = staff_service.get_member(db, member_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipendente non trovato")
    return row


@router.post("/members", response_model=staff_schema.StaffMemberRead, status_code=status.HTTP_201_CREATED)
def create_member(payload: staff_schema.StaffMemberCreate, db: Session = Depends(get_db)):
    return staff_service.create_member(db, payload)


@router.delete("/members/bulk", response_model=staff_schema.StaffMembersBulkDeleteResult)
def delete_all_members_bulk(db: Session = Depends(get_db)):
    """Elimina l’intero elenco dipendenti e tutta la pianificazione associata (CASCADE)."""
    n = staff_service.delete_all_members(db)
    return staff_schema.StaffMembersBulkDeleteResult(deleted=n)


@router.put("/members/{member_id}", response_model=staff_schema.StaffMemberRead)
def update_member(member_id: int, payload: staff_schema.StaffMemberUpdate, db: Session = Depends(get_db)):
    row = staff_service.update_member(db, member_id, payload)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipendente non trovato")
    return row


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_member(member_id: int, db: Session = Depends(get_db)):
    ok = staff_service.delete_member(db, member_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipendente non trovato")


@router.get("/shifts", response_model=List[staff_schema.StaffShiftRead])
def list_shifts(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    db: Session = Depends(get_db),
):
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="Intervallo date non valido")
    return staff_service.list_shifts_range(db, date_from, date_to)


@router.post("/shifts", response_model=staff_schema.StaffShiftRead, status_code=status.HTTP_201_CREATED)
def create_shift(payload: staff_schema.StaffShiftCreate, db: Session = Depends(get_db)):
    try:
        row = staff_service.create_shift(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return staff_service.shift_to_read(db, row)


@router.delete("/shifts/bulk", response_model=staff_schema.StaffShiftsBulkDeleteResult)
def delete_shifts_bulk(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    db: Session = Depends(get_db),
):
    """Elimina tutte le voci nel periodo (es. intera settimana visibile in Personale)."""
    try:
        n = staff_service.delete_shifts_between(db, date_from, date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return staff_schema.StaffShiftsBulkDeleteResult(deleted=n)


@router.put("/shifts/{shift_id}", response_model=staff_schema.StaffShiftRead)
def update_shift(shift_id: int, payload: staff_schema.StaffShiftUpdate, db: Session = Depends(get_db)):
    try:
        row = staff_service.update_shift(db, shift_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voce non trovata")
    return staff_service.shift_to_read(db, row)


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shift(shift_id: int, db: Session = Depends(get_db)):
    ok = staff_service.delete_shift(db, shift_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voce non trovata")
