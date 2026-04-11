from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class SupplierOrderItemCreate(BaseModel):
  product_description: str = Field(..., min_length=1, max_length=255)
  pieces: Optional[int] = Field(default=None, ge=0)
  weight_kg: Optional[Decimal] = Field(default=None, ge=0)
  note: Optional[str] = None


class SupplierOrderCreate(BaseModel):
  supplier_id: int
  order_date: date
  vat_percent: Decimal = Field(default=Decimal("23"), ge=0, le=100)
  note: Optional[str] = None
  note_internal: Optional[str] = None
  expected_delivery_date: Optional[date] = None
  status: Literal["pending", "sent"] = "pending"
  items: List[SupplierOrderItemCreate] = Field(..., min_length=1)


class SupplierOrderUpdate(BaseModel):
  supplier_id: int
  order_date: date
  vat_percent: Decimal = Field(default=Decimal("23"), ge=0, le=100)
  note: Optional[str] = None
  note_internal: Optional[str] = None
  expected_delivery_date: Optional[date] = None
  status: Literal["pending", "sent"] = "pending"
  items: List[SupplierOrderItemCreate] = Field(..., min_length=1)


class SupplierOrderItemRead(BaseModel):
  id: int
  product_description: str
  pieces: Optional[int] = None
  weight_kg: Optional[Decimal] = None
  note: Optional[str] = None

  class Config:
    from_attributes = True


class SupplierOrderRead(BaseModel):
  id: int
  supplier_id: int
  supplier_name: Optional[str] = None
  order_date: date
  vat_percent: Decimal
  note: Optional[str] = None
  note_internal: Optional[str] = None
  expected_delivery_date: Optional[date] = None
  status: str = "pending"
  merchandise_summary: Optional[str] = None
  created_at: Optional[datetime] = None
  items: List[SupplierOrderItemRead] = []

  class Config:
    from_attributes = True
