from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field


class CarrierCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    phone: Optional[str] = Field(None, max_length=32)
    email: Optional[str] = Field(None, max_length=255)
    is_active: bool = True
    out_of_service: bool = False
    in_service: bool = False
    rest_day: Optional[int] = Field(None, ge=0, le=6)
    van_label: Optional[str] = Field(None, max_length=120)
    van_plate: Optional[str] = Field(None, max_length=32)
    notes: Optional[str] = None
    sort_order: int = 0


class CarrierUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    phone: Optional[str] = Field(None, max_length=32)
    email: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None
    out_of_service: Optional[bool] = None
    in_service: Optional[bool] = None
    rest_day: Optional[int] = Field(None, ge=0, le=6)
    van_label: Optional[str] = Field(None, max_length=120)
    van_plate: Optional[str] = Field(None, max_length=32)
    notes: Optional[str] = None
    sort_order: Optional[int] = None


class CarrierRead(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    is_active: bool
    out_of_service: bool
    in_service: bool
    rest_day: Optional[int] = None
    van_label: Optional[str] = None
    van_plate: Optional[str] = None
    notes: Optional[str] = None
    sort_order: int = 0
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class CarrierMaintenanceCreate(BaseModel):
    service_date: date
    description: str = Field(..., min_length=1, max_length=512)
    odometer_km: Optional[int] = None
    cost: Optional[Decimal] = None
    workshop: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None


class CarrierMaintenanceUpdate(BaseModel):
    service_date: Optional[date] = None
    description: Optional[str] = Field(None, min_length=1, max_length=512)
    odometer_km: Optional[int] = None
    cost: Optional[Decimal] = None
    workshop: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None


class CarrierMaintenanceRead(BaseModel):
    id: int
    carrier_id: int
    service_date: date
    description: str
    odometer_km: Optional[int] = None
    cost: Optional[Decimal] = None
    workshop: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class CarrierFuelCreate(BaseModel):
    expense_date: date
    amount_eur: Decimal
    liters: Optional[Decimal] = None
    station: Optional[str] = Field(None, max_length=255)
    odometer_km: Optional[int] = None
    notes: Optional[str] = None


class CarrierFuelUpdate(BaseModel):
    expense_date: Optional[date] = None
    amount_eur: Optional[Decimal] = None
    liters: Optional[Decimal] = None
    station: Optional[str] = Field(None, max_length=255)
    odometer_km: Optional[int] = None
    notes: Optional[str] = None


class CarrierFuelRead(BaseModel):
    id: int
    carrier_id: int
    expense_date: date
    liters: Optional[Decimal] = None
    amount_eur: Decimal
    station: Optional[str] = None
    odometer_km: Optional[int] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class CarrierOtherExpenseCreate(BaseModel):
    expense_date: date
    amount_eur: Decimal
    category: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = Field(None, max_length=512)
    notes: Optional[str] = None


class CarrierOtherExpenseUpdate(BaseModel):
    expense_date: Optional[date] = None
    amount_eur: Optional[Decimal] = None
    category: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = Field(None, max_length=512)
    notes: Optional[str] = None


class CarrierOtherExpenseRead(BaseModel):
    id: int
    carrier_id: int
    expense_date: date
    category: Optional[str] = None
    amount_eur: Decimal
    description: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class CarrierDetailRead(CarrierRead):
    maintenance_logs: List[CarrierMaintenanceRead] = []
    fuel_expenses: List[CarrierFuelRead] = []
    other_expenses: List[CarrierOtherExpenseRead] = []
