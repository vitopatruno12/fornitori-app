from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr


class UserBase(BaseModel):
  first_name: str
  last_name: str
  email: EmailStr
  role: str = "operator"


class UserCreate(UserBase):
  password: str


class UserRead(UserBase):
  id: int
  created_at: datetime

  class Config:
    from_attributes = True