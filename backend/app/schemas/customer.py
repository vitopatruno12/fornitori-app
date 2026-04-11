from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class CustomerBase(BaseModel):
    name: str
    vat_number: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None


class CustomerCreate(CustomerBase):
    pass


class CustomerRead(CustomerBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True
