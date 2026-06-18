from datetime import date, time
from typing import List, Literal, Optional

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
    hourly_rate: Optional[float] = Field(None, ge=0)
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
    hourly_rate: Optional[float] = Field(None, ge=0)
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
    hourly_rate: Optional[float] = None
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


class StaffPayrollMonthLine(BaseModel):
    staff_member_id: int
    name: str = Field(..., max_length=255)
    hours: float = Field(ge=0)
    hourly_rate: float = Field(ge=0)
    amount: float = Field(ge=0)


class StaffPayrollMonthCreate(BaseModel):
    year_month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    period_from: date
    period_to: date
    lines: List[StaffPayrollMonthLine]
    notes: Optional[str] = None

    @model_validator(mode="after")
    def period_order(self):
        if self.period_to < self.period_from:
            raise ValueError("period_to deve essere >= period_from")
        return self


class StaffPayrollMonthUpdate(BaseModel):
    lines: List[StaffPayrollMonthLine]
    notes: Optional[str] = None
    period_from: Optional[date] = None
    period_to: Optional[date] = None


class StaffPayrollMonthRead(BaseModel):
    id: int
    year_month: str
    period_from: date
    period_to: date
    lines: List[StaffPayrollMonthLine]
    total_amount: float
    notes: Optional[str] = None

    class Config:
        from_attributes = True


class StaffLocaleMemberSnapshot(BaseModel):
    name: str = Field(..., max_length=255)
    first_name: Optional[str] = Field(None, max_length=120)
    last_name: Optional[str] = Field(None, max_length=120)
    email: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=64)
    city: Optional[str] = Field(None, max_length=128)
    birth_date: Optional[date] = None
    sort_order: int = 0
    hourly_rate: Optional[float] = Field(None, ge=0)
    is_active: bool = True


class StaffLocalePackSummary(BaseModel):
    locale_name: str
    saved_at: Optional[str] = None
    member_count: int = 0
    requires_access_code: bool = False


class StaffLocalePackRead(BaseModel):
    locale_name: str
    saved_at: Optional[str] = None
    members: List[StaffLocaleMemberSnapshot]
    access_code: Optional[str] = None


class StaffLocalePackUpsert(BaseModel):
    locale_name: str = Field(..., min_length=1, max_length=255)
    members: List[StaffLocaleMemberSnapshot]
    access_code: Optional[str] = Field(None, min_length=6, max_length=6, pattern=r"^\d{6}$")
    regenerate_access_code: bool = False


class StaffBackupSummary(BaseModel):
    section: str
    backup_key: str
    saved_at: Optional[str] = None


class StaffBackupRead(BaseModel):
    section: str
    backup_key: str
    saved_at: Optional[str] = None
    payload: dict


class StaffBackupUpsert(BaseModel):
    section: str = Field(..., pattern=r"^(planning|payroll)$")
    backup_key: str = Field(..., min_length=1, max_length=255)
    payload: dict
