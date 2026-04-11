from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel


class DeliveryItemCreate(BaseModel):
  product_description: Optional[str] = None
  weight_kg: Optional[Decimal] = None
  pieces: Optional[int] = None
  unit_price: Decimal
  anomaly_note: Optional[str] = None


class DeliveryBase(BaseModel):
  supplier_id: int
  product_id: Optional[int] = None
  product_description: Optional[str] = None
  user_id: Optional[int] = None
  delivery_date: Optional[datetime] = None
  weight_kg: Optional[Decimal] = None
  pieces: Optional[int] = None
  unit_price: Decimal
  vat_percent: Decimal = Decimal("23.0")
  note: Optional[str] = None
  invoice_id: Optional[int] = None
  ddt_number: Optional[str] = None
  anomaly_note: Optional[str] = None


class DeliveryCreate(DeliveryBase):
  pass


class DeliveryBatchCreate(BaseModel):
  supplier_id: int
  delivery_date: Optional[datetime] = None
  vat_percent: Decimal = Decimal("23.0")
  note: Optional[str] = None
  ddt_number: Optional[str] = None
  items: List[DeliveryItemCreate]


class DeliveryRead(DeliveryBase):
  id: int
  imponibile: Decimal
  vat_amount: Decimal
  total: Decimal
  list_unit_price: Optional[Decimal] = None
  price_diff_vs_list: Optional[Decimal] = None

  class Config:
    from_attributes = True


class DeliveryReadEnriched(DeliveryRead):
  supplier_name: Optional[str] = None


class DeliveryPricePoint(BaseModel):
  delivery_date: datetime
  unit_price: Decimal
  imponibile: Decimal
  total: Decimal
  ddt_number: Optional[str] = None


class DeliveryPriceAnalytics(BaseModel):
  supplier_id: int
  supplier_name: Optional[str] = None
  product_description: str
  last_unit_price: Optional[Decimal] = None
  last_delivery_date: Optional[datetime] = None
  avg_unit_price: Optional[Decimal] = None
  min_unit_price: Optional[Decimal] = None
  max_unit_price: Optional[Decimal] = None
  delivery_count: int
  series: List[DeliveryPricePoint]