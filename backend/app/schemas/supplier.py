from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from ..constants.prima_nota import LEGACY_ACTIVITY_ALIASES, PRIMA_NOTA_ACTIVITIES, is_valid_activity_slug


def normalize_supplier_locales(raw: Optional[str]) -> Optional[str]:
  if raw is None:
    return None
  text = str(raw).strip()
  if not text:
    return None
  known = set(PRIMA_NOTA_ACTIVITIES)
  slugs: list[str] = []
  for part in text.split(","):
    slug = part.strip().lower()
    if not slug:
      continue
    if slug in LEGACY_ACTIVITY_ALIASES:
      slug = LEGACY_ACTIVITY_ALIASES[slug]
    if slug in known or is_valid_activity_slug(slug):
      if slug not in slugs:
        slugs.append(slug)
  return ",".join(slugs) if slugs else None


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
  phones_json: Optional[str] = None
  emails_json: Optional[str] = None
  cities_json: Optional[str] = None
  merchandise_categories_json: Optional[str] = None
  notes: Optional[str] = None
  price_list_label: Optional[str] = None
  locales: Optional[str] = None
  is_active: bool = True
  is_expired: bool = False

  @field_validator("locales", mode="before")
  @classmethod
  def _normalize_locales(cls, value):
    return normalize_supplier_locales(value)


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
  phones_json: Optional[str] = None
  emails_json: Optional[str] = None
  cities_json: Optional[str] = None
  merchandise_categories_json: Optional[str] = None
  notes: Optional[str] = None
  price_list_label: Optional[str] = None
  locales: Optional[str] = None
  is_active: Optional[bool] = None
  is_expired: Optional[bool] = None

  @field_validator("locales", mode="before")
  @classmethod
  def _normalize_locales(cls, value):
    return normalize_supplier_locales(value)


class SupplierRead(SupplierBase):
  id: int
  created_at: Optional[datetime] = None

  @field_validator("email", mode="before")
  @classmethod
  def _sanitize_legacy_email(cls, value):
    if value is None:
      return None
    text = str(value).strip()
    if not text:
      return None
    try:
      from pydantic import TypeAdapter, EmailStr

      TypeAdapter(EmailStr).validate_python(text)
      return text
    except Exception:
      return None

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


class SupplierInvoiceParseOut(BaseModel):
  suggested_fields: dict
  missing_fields: list[str] = []
  warnings: list[str] = []
  source_text: str = ""
  file_type: str = ""
  invoice_number: Optional[str] = None
  invoice_date: Optional[str] = None
  confidence: float = 0.0
