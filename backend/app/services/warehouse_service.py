from datetime import date, datetime
from typing import List, Literal, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.warehouse import WarehouseMovement
from ..schemas.warehouse import WarehouseMovementCreate, WarehouseMovementRead


def _validate_quantities(payload: WarehouseMovementCreate) -> None:
  has_qty = any(
      v is not None and v != 0
      for v in (payload.pieces, payload.weight_kg, payload.volume_liters)
  )
  if not has_qty and not (payload.note or "").strip():
    raise HTTPException(
        status_code=400,
        detail="Indica almeno pezzi, kg, litri o una nota",
    )


def movement_to_read(row: WarehouseMovement) -> WarehouseMovementRead:
  return WarehouseMovementRead.model_validate(row)


def create_movement(db: Session, payload: WarehouseMovementCreate) -> WarehouseMovementRead:
  _validate_quantities(payload)
  row = WarehouseMovement(
      movement_type=payload.movement_type,
      movement_at=payload.movement_at,
      operator_name=payload.operator_name.strip(),
      signature=payload.signature.strip(),
      product_description=payload.product_description.strip(),
      pieces=payload.pieces,
      weight_kg=payload.weight_kg,
      volume_liters=payload.volume_liters,
      merchandise_condition=(payload.merchandise_condition or "").strip() or None,
      location=(payload.location or "Magazzino").strip() or "Magazzino",
      note=(payload.note or "").strip() or None,
  )
  db.add(row)
  db.commit()
  db.refresh(row)
  return movement_to_read(row)


def list_movements(
    db: Session,
    *,
    movement_type: Optional[Literal["in", "out"]] = None,
    location: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = 200,
) -> List[WarehouseMovementRead]:
  q = db.query(WarehouseMovement)
  if movement_type:
    q = q.filter(WarehouseMovement.movement_type == movement_type)
  if location:
    q = q.filter(WarehouseMovement.location == location.strip())
  if date_from:
    q = q.filter(WarehouseMovement.movement_at >= datetime.combine(date_from, datetime.min.time()))
  if date_to:
    q = q.filter(WarehouseMovement.movement_at <= datetime.combine(date_to, datetime.max.time()))
  rows = q.order_by(WarehouseMovement.movement_at.desc(), WarehouseMovement.id.desc()).limit(limit).all()
  return [movement_to_read(r) for r in rows]


def update_movement(db: Session, movement_id: int, payload: WarehouseMovementCreate) -> WarehouseMovementRead:
  _validate_quantities(payload)
  row = db.query(WarehouseMovement).filter(WarehouseMovement.id == movement_id).first()
  if not row:
    raise HTTPException(status_code=404, detail="Movimento magazzino non trovato")
  row.movement_type = payload.movement_type
  row.movement_at = payload.movement_at
  row.operator_name = payload.operator_name.strip()
  row.signature = payload.signature.strip()
  row.product_description = payload.product_description.strip()
  row.pieces = payload.pieces
  row.weight_kg = payload.weight_kg
  row.volume_liters = payload.volume_liters
  row.merchandise_condition = (payload.merchandise_condition or "").strip() or None
  row.location = (payload.location or "Magazzino").strip() or "Magazzino"
  row.note = (payload.note or "").strip() or None
  db.commit()
  db.refresh(row)
  return movement_to_read(row)


def delete_movement(db: Session, movement_id: int) -> None:
  row = db.query(WarehouseMovement).filter(WarehouseMovement.id == movement_id).first()
  if not row:
    raise HTTPException(status_code=404, detail="Movimento magazzino non trovato")
  db.delete(row)
  db.commit()
