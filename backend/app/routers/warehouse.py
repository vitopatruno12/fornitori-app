from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.warehouse import WarehouseMovementCreate, WarehouseMovementRead
from ..services import warehouse_service

router = APIRouter(prefix="/warehouse/movements", tags=["warehouse"])


@router.post("", response_model=WarehouseMovementRead)
@router.post("/", response_model=WarehouseMovementRead, include_in_schema=False)
def create_warehouse_movement(payload: WarehouseMovementCreate, db: Session = Depends(get_db)):
  return warehouse_service.create_movement(db, payload)


@router.get("", response_model=List[WarehouseMovementRead])
@router.get("/", response_model=List[WarehouseMovementRead], include_in_schema=False)
def list_warehouse_movements(
    movement_type: Optional[Literal["in", "out"]] = Query(default=None),
    location: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    limit: int = Query(default=200, le=500),
    db: Session = Depends(get_db),
):
  return warehouse_service.list_movements(
      db,
      movement_type=movement_type,
      location=location,
      date_from=date_from,
      date_to=date_to,
      limit=limit,
  )


@router.put("/{movement_id}", response_model=WarehouseMovementRead)
def update_warehouse_movement(
    movement_id: int,
    payload: WarehouseMovementCreate,
    db: Session = Depends(get_db),
):
  return warehouse_service.update_movement(db, movement_id, payload)


@router.delete("/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_warehouse_movement(movement_id: int, db: Session = Depends(get_db)):
  warehouse_service.delete_movement(db, movement_id)
