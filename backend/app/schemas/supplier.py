from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr


class SupplierBase(BaseModel):
  name: str
  vat_number: Optional[str] = None
  fiscal_code: Optional[str] = None
  address: Optional[str] = None
  city: Optional[str] = None
  country: Optional[str] = None
  email: Optional[EmailStr] = None
  phone: Optional[str] = None
  contact_person: Optional[str] = None
  iban: Optional[str] = None
  payment_terms: Optional[str] = None
  merchandise_category: Optional[str] = None
  notes: Optional[str] = None
  price_list_label: Optional[str] = None
  is_active: bool = True
  is_expired: bool = False


class SupplierCreate(SupplierBase):
  pass


class SupplierUpdate(BaseModel):
  name: Optional[str] = None
  vat_number: Optional[str] = None
  fiscal_code: Optional[str] = None
  address: Optional[str] = None
  city: Optional[str] = None
  country: Optional[str] = None
  email: Optional[EmailStr] = None
  phone: Optional[str] = None
  contact_person: Optional[str] = None
  iban: Optional[str] = None
  payment_terms: Optional[str] = None
  merchandise_category: Optional[str] = None
  notes: Optional[str] = None
  price_list_label: Optional[str] = None
  is_active: Optional[bool] = None
  is_expired: Optional[bool] = None


class SupplierRead(SupplierBase):
  id: int
  created_at: Optional[datetime] = None

  class Config:
    from_attributes = True


class SupplierWithStats(SupplierRead):
  totale_fatture: float = 0.0
  totale_da_pagare: float = 0.0
  saldo_aperto: float = 0.0
  ultima_consegna: Optional[datetime] = None
  ultima_fattura: Optional[datetime] = None
  scadenze_aperte: int = 0
  listino_righe: int = 0

  class Config:
    from_attributes = True
