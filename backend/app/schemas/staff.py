from datetime import date, time
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

EntryKind = Literal["shift", "permission", "absence", "sick"]


def _strip_opt(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    s = v.strip()
    return s if s else None


class StaffMemberCreate(BaseModel):
    name: str = Field(default="", max_length=255)
    first_name: Optional[str] = Field(None, max_length=120)
    last_name: Optional[str] = Field(None, max_length=120)
    email: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=64)
    city: Optional[str] = Field(None, max_length=128)
    birth_date: Optional[date] = None
    sort_order: int = 0
    is_active: bool = True

    @model_validator(mode="after")
    def name_from_parts(self):
        fn = _strip_opt(self.first_name)
        ln = _strip_opt(self.last_name)
        nm = self.name.strip() if self.name else ""
        combined = f"{fn or ''} {ln or ''}".strip()
        if combined:
            self.name = combined[:255]
        elif nm:
            self.name = nm[:255]
        else:
            raise ValueError("Indicare nome e cognome oppure nome completo")
        self.first_name = fn
        self.last_name = ln
        self.email = _strip_opt(self.email)
        self.phone = _strip_opt(self.phone)
        self.city = _strip_opt(self.city)
        return self


class StaffMemberUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    first_name: Optional[str] = Field(None, max_length=120)
    last_name: Optional[str] = Field(None, max_length=120)
    email: Optional[str] = None
    phone: Optional[str] = None
    city: Optional[str] = None
    birth_date: Optional[date] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None

    @field_validator("email", "phone", "city", "first_name", "last_name", mode="before")
    @classmethod
    def empty_to_none(cls, v):
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v.strip() if isinstance(v, str) else v


class StaffMemberRead(BaseModel):
    id: int
    name: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    city: Optional[str] = None
    birth_date: Optional[date] = None
    sort_order: int
    is_active: bool

    class Config:
        from_attributes = True


class StaffShiftCreate(BaseModel):
    staff_member_id: int
    work_date: date
    time_start: Optional[time] = None
    time_end: Optional[time] = None
    entry_kind: EntryKind = "shift"
    notes: Optional[str] = None

    @field_validator("time_start", "time_end", mode="before")
    @classmethod
    def empty_str_to_none(cls, v):
        if v == "":
            return None
        return v


class StaffShiftUpdate(BaseModel):
    staff_member_id: Optional[int] = None
    work_date: Optional[date] = None
    time_start: Optional[time] = None
    time_end: Optional[time] = None
    entry_kind: Optional[EntryKind] = None
    notes: Optional[str] = None

    @field_validator("time_start", "time_end", mode="before")
    @classmethod
    def empty_str_to_none(cls, v):
        if v == "":
            return None
        return v


class StaffShiftRead(BaseModel):
    id: int
    staff_member_id: int
    staff_member_name: str
    work_date: date
    time_start: Optional[time] = None
    time_end: Optional[time] = None
    entry_kind: str
    notes: Optional[str] = None

    class Config:
        from_attributes = True


class StaffShiftsBulkDeleteResult(BaseModel):
    deleted: int


class StaffMembersBulkDeleteResult(BaseModel):
    deleted: int
