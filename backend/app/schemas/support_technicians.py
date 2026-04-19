from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class SupportTechnicianCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=255)
    phone: str = Field(default="", max_length=32)
    specialty: Optional[str] = Field(None, max_length=255)
    sort_order: int = 0


class SupportTechnicianUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=255)
    phone: Optional[str] = Field(None, max_length=32)
    specialty: Optional[str] = None
    sort_order: Optional[int] = None


class SupportTechnicianRead(BaseModel):
    id: int
    full_name: str
    phone: str
    specialty: Optional[str]
    sort_order: int

    model_config = {"from_attributes": True}


ActivityKind = Literal["planned", "completed"]


class TechnicianActivityCreate(BaseModel):
    technician_id: int
    activity_date: date
    time_start: Optional[str] = Field(None, max_length=5)
    time_end: Optional[str] = Field(None, max_length=5)
    location: Optional[str] = Field(None, max_length=512)
    notes: Optional[str] = None
    kind: ActivityKind = "planned"


class TechnicianActivityUpdate(BaseModel):
    technician_id: Optional[int] = None
    activity_date: Optional[date] = None
    time_start: Optional[str] = Field(None, max_length=5)
    time_end: Optional[str] = Field(None, max_length=5)
    location: Optional[str] = Field(None, max_length=512)
    notes: Optional[str] = None
    kind: Optional[ActivityKind] = None


class TechnicianActivityRead(BaseModel):
    id: int
    technician_id: int
    technician_name: Optional[str] = None
    activity_date: date
    time_start: Optional[str]
    time_end: Optional[str]
    location: Optional[str]
    notes: Optional[str]
    kind: str

    model_config = {"from_attributes": True}


class SeedDefaultsResult(BaseModel):
    inserted: int


class SupportTechniciansBulkDeleteResult(BaseModel):
    deleted: int
