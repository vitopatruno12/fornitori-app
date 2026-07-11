from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field


class WarehouseMovementCreate(BaseModel):
  movement_type: Literal["in", "out"]
  movement_at: datetime
  operator_name: str = Field(..., min_length=1, max_length=128)
  signature: str = Field(..., min_length=1, max_length=128)
  product_description: str = Field(..., min_length=1, max_length=255)
  pieces: Optional[int] = Field(default=None, ge=0)
  weight_kg: Optional[Decimal] = Field(default=None, ge=0)
  volume_liters: Optional[Decimal] = Field(default=None, ge=0)
  merchandise_condition: Optional[str] = Field(default=None, max_length=128)
  location: str = Field(default="Magazzino", max_length=128)
  note: Optional[str] = None


class WarehouseMovementRead(BaseModel):
  id: int
  movement_type: str
  movement_at: datetime
  operator_name: str
  signature: str
  product_description: str
  pieces: Optional[int] = None
  weight_kg: Optional[Decimal] = None
  volume_liters: Optional[Decimal] = None
  merchandise_condition: Optional[str] = None
  location: str
  note: Optional[str] = None
  created_at: Optional[datetime] = None

  class Config:
    from_attributes = True
