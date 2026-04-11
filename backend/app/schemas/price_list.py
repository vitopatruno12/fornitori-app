from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel


class PriceListItemBase(BaseModel):
    supplier_id: int
    product_description: str
    unit_price: Decimal


class PriceListItemCreate(PriceListItemBase):
    pass


class PriceListBatchCreate(BaseModel):
    supplier_id: int
    items: List[PriceListItemCreate]


class PriceListItemRead(PriceListItemBase):
    id: int

    class Config:
        from_attributes = True
