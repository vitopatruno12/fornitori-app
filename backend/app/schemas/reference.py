from typing import Optional

from pydantic import BaseModel


class AccountRead(BaseModel):
    id: int
    code: Optional[str] = None
    name: str
    account_type: str
    is_active: bool
    sort_order: int

    class Config:
        from_attributes = True


class PaymentMethodRead(BaseModel):
    id: int
    name: str
    sort_order: int

    class Config:
        from_attributes = True


class CategoryRead(BaseModel):
    id: int
    name: str
    flow: str

    class Config:
        from_attributes = True
