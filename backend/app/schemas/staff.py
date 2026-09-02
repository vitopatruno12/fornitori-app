from datetime import date, time
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

EntryKind = Literal["shift", "permission", "absence", "sick", "ferie", "riposo"]
ALL_DAY_ENTRY_KINDS = ("absence", "sick", "ferie", "riposo")


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
    section: Optional[str] = Field(None, max_length=120)
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
        self.section = _strip_opt(self.section)
        return self


class StaffMemberUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    first_name: Optional[str] = Field(None, max_length=120)
    last_name: Optional[str] = Field(None, max_length=120)
    email: Optional[str] = None
    phone: Optional[str] = None
    city: Optional[str] = None
    section: Optional[str] = None
    birth_date: Optional[date] = None
    sort_order: Optional[int] = None
    hourly_rate: Optional[float] = Field(None, ge=0)
    is_active: Optional[bool] = None

    @field_validator("email", "phone", "city", "first_name", "last_name", "section", mode="before")
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
    section: Optional[str] = None
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


class StaffStipendiMonthLine(BaseModel):
    staff_member_id: Optional[int] = None
    name: str = Field(..., max_length=255)
    busta: float = Field(0, ge=0)
    acconto_tfr: float = Field(0, ge=0)
    fuori: float = Field(0, ge=0)
    tfr_attuale: float = Field(0, ge=0)
    tfr_anticipato: float = Field(0, ge=0)
    nuovo_tfr: Optional[float] = None

    @model_validator(mode="after")
    def compute_nuovo_tfr(self):
        self.nuovo_tfr = round(float(self.tfr_attuale or 0) - float(self.acconto_tfr or 0), 2)
        return self

    @property
    def totale(self) -> float:
        """Totale busta paga: busta + fuori − acconto TFR."""
        return float(self.busta or 0) + float(self.fuori or 0) - float(self.acconto_tfr or 0)


class StaffStipendiMonthCreate(BaseModel):
    locale_name: str = Field("", max_length=255)
    year_month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    period_from: date
    period_to: date
    lines: List[StaffStipendiMonthLine]
    notes: Optional[str] = None

    @model_validator(mode="after")
    def period_order(self):
        if self.period_to < self.period_from:
            raise ValueError("period_to deve essere >= period_from")
        return self


class StaffStipendiMonthUpdate(BaseModel):
    lines: List[StaffStipendiMonthLine]
    notes: Optional[str] = None
    period_from: Optional[date] = None
    period_to: Optional[date] = None


class StaffStipendiMonthRead(BaseModel):
    id: int
    locale_name: str = ""
    year_month: str
    period_from: date
    period_to: date
    lines: List[StaffStipendiMonthLine]
    total_busta: float
    total_tfr: float
    total_fuori: float
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
    section: Optional[str] = Field(None, max_length=120)
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
    sections: List[str] = Field(default_factory=list)
    access_code: Optional[str] = None


class StaffLocalePackUpsert(BaseModel):
    locale_name: str = Field(..., min_length=1, max_length=255)
    members: List[StaffLocaleMemberSnapshot]
    sections: List[str] = Field(default_factory=list)
    access_code: Optional[str] = Field(None, min_length=6, max_length=6, pattern=r"^\d{6}$")
    regenerate_access_code: bool = False

    @model_validator(mode="after")
    def normalize_sections(self):
        cleaned: List[str] = []
        seen = set()
        for raw in self.sections or []:
            name = _strip_opt(raw)
            if not name:
                continue
            key = name.casefold()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(name[:120])
        self.sections = cleaned
        return self


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


class AccessCodeLookupIn(BaseModel):
    query: str = Field(..., min_length=2, max_length=255)
    otp: Optional[str] = Field(default=None, min_length=6, max_length=6)
    unlock_password: Optional[str] = Field(default=None, min_length=1, max_length=128)


class AccessCodeOtpRequestIn(BaseModel):
    query: str = Field(..., min_length=2, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=32)


class AccessCodeOtpRequestOut(BaseModel):
    ok: bool = True
    phone_hint: str
    expires_in_sec: int
    sent: bool = False
    debug_otp: Optional[str] = None
    debug_send_error: Optional[str] = None


class AccessCodeLookupHit(BaseModel):
    source: Literal["personale", "prima_nota"]
    name: str
    access_code: str
    activity_slug: Optional[str] = None
    linked_name: Optional[str] = None


class AccessCodeLookupOut(BaseModel):
    query: str
    hits: List[AccessCodeLookupHit] = Field(default_factory=list)
