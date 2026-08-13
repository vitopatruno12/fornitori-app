from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import carriers as sch
from ..services import carrier_service as svc

router = APIRouter(prefix="/carriers", tags=["carriers"])


@router.get("", response_model=List[sch.CarrierRead])
def list_carriers(
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
):
    return svc.list_carriers(db, active_only=active_only)


@router.post("", response_model=sch.CarrierRead, status_code=status.HTTP_201_CREATED)
def create_carrier(payload: sch.CarrierCreate, db: Session = Depends(get_db)):
    return svc.create_carrier(db, payload)


@router.get("/{carrier_id}", response_model=sch.CarrierDetailRead)
def get_carrier(carrier_id: int, db: Session = Depends(get_db)):
    row = svc.get_carrier(db, carrier_id)
    if not row:
        raise HTTPException(status_code=404, detail="Trasportatore non trovato")
    return sch.CarrierDetailRead(
        id=row.id,
        name=row.name,
        phone=row.phone,
        email=row.email,
        is_active=row.is_active,
        out_of_service=row.out_of_service,
        in_service=row.in_service,
        rest_day=row.rest_day,
        van_label=row.van_label,
        van_plate=row.van_plate,
        notes=row.notes,
        sort_order=row.sort_order,
        created_at=row.created_at,
        maintenance_logs=svc.list_maintenance(db, carrier_id),
        fuel_expenses=svc.list_fuel(db, carrier_id),
        other_expenses=svc.list_other_expenses(db, carrier_id),
    )


@router.put("/{carrier_id}", response_model=sch.CarrierRead)
def update_carrier(carrier_id: int, payload: sch.CarrierUpdate, db: Session = Depends(get_db)):
    row = svc.update_carrier(db, carrier_id, payload)
    if not row:
        raise HTTPException(status_code=404, detail="Trasportatore non trovato")
    return row


@router.post("/{carrier_id}/in-service", response_model=sch.CarrierRead)
def set_in_service(
    carrier_id: int,
    value: bool = Query(True),
    db: Session = Depends(get_db),
):
    try:
        row = svc.set_in_service(db, carrier_id, value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not row:
        raise HTTPException(status_code=404, detail="Trasportatore non trovato")
    return row


@router.delete("/{carrier_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_carrier(carrier_id: int, db: Session = Depends(get_db)):
    if not svc.delete_carrier(db, carrier_id):
        raise HTTPException(status_code=404, detail="Trasportatore non trovato")


@router.get("/{carrier_id}/maintenance", response_model=List[sch.CarrierMaintenanceRead])
def list_maintenance(carrier_id: int, db: Session = Depends(get_db)):
    if not svc.get_carrier(db, carrier_id):
        raise HTTPException(status_code=404, detail="Trasportatore non trovato")
    return svc.list_maintenance(db, carrier_id)


@router.post(
    "/{carrier_id}/maintenance",
    response_model=sch.CarrierMaintenanceRead,
    status_code=status.HTTP_201_CREATED,
)
def create_maintenance(
    carrier_id: int, payload: sch.CarrierMaintenanceCreate, db: Session = Depends(get_db)
):
    try:
        return svc.create_maintenance(db, carrier_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/maintenance/{log_id}", response_model=sch.CarrierMaintenanceRead)
def update_maintenance(log_id: int, payload: sch.CarrierMaintenanceUpdate, db: Session = Depends(get_db)):
    row = svc.update_maintenance(db, log_id, payload)
    if not row:
        raise HTTPException(status_code=404, detail="Scheda manutenzione non trovata")
    return row


@router.delete("/maintenance/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_maintenance(log_id: int, db: Session = Depends(get_db)):
    if not svc.delete_maintenance(db, log_id):
        raise HTTPException(status_code=404, detail="Scheda manutenzione non trovata")


@router.get("/{carrier_id}/fuel-expenses", response_model=List[sch.CarrierFuelRead])
def list_fuel(carrier_id: int, db: Session = Depends(get_db)):
    if not svc.get_carrier(db, carrier_id):
        raise HTTPException(status_code=404, detail="Trasportatore non trovato")
    return svc.list_fuel(db, carrier_id)


@router.post(
    "/{carrier_id}/fuel-expenses",
    response_model=sch.CarrierFuelRead,
    status_code=status.HTTP_201_CREATED,
)
def create_fuel(carrier_id: int, payload: sch.CarrierFuelCreate, db: Session = Depends(get_db)):
    try:
        return svc.create_fuel(db, carrier_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/fuel-expenses/{expense_id}", response_model=sch.CarrierFuelRead)
def update_fuel(expense_id: int, payload: sch.CarrierFuelUpdate, db: Session = Depends(get_db)):
    row = svc.update_fuel(db, expense_id, payload)
    if not row:
        raise HTTPException(status_code=404, detail="Spesa carburante non trovata")
    return row


@router.delete("/fuel-expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fuel(expense_id: int, db: Session = Depends(get_db)):
    if not svc.delete_fuel(db, expense_id):
        raise HTTPException(status_code=404, detail="Spesa carburante non trovata")


@router.get("/{carrier_id}/other-expenses", response_model=List[sch.CarrierOtherExpenseRead])
def list_other(carrier_id: int, db: Session = Depends(get_db)):
    if not svc.get_carrier(db, carrier_id):
        raise HTTPException(status_code=404, detail="Trasportatore non trovato")
    return svc.list_other_expenses(db, carrier_id)


@router.post(
    "/{carrier_id}/other-expenses",
    response_model=sch.CarrierOtherExpenseRead,
    status_code=status.HTTP_201_CREATED,
)
def create_other(
    carrier_id: int, payload: sch.CarrierOtherExpenseCreate, db: Session = Depends(get_db)
):
    try:
        return svc.create_other_expense(db, carrier_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/other-expenses/{expense_id}", response_model=sch.CarrierOtherExpenseRead)
def update_other(expense_id: int, payload: sch.CarrierOtherExpenseUpdate, db: Session = Depends(get_db)):
    row = svc.update_other_expense(db, expense_id, payload)
    if not row:
        raise HTTPException(status_code=404, detail="Spesa non trovata")
    return row


@router.delete("/other-expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_other(expense_id: int, db: Session = Depends(get_db)):
    if not svc.delete_other_expense(db, expense_id):
        raise HTTPException(status_code=404, detail="Spesa non trovata")
