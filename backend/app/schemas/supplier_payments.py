from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SupplierPaymentsSheet(BaseModel):
  name: str
  rows: List[List[Any]]


class SupplierPaymentsWorkbookPayload(BaseModel):
  title: str = ""
  sheets: List[SupplierPaymentsSheet] = Field(default_factory=list)
  highlights: Dict[str, Any] = Field(default_factory=dict)


class SupplierPaymentsWorkbookRead(BaseModel):
  workbook_key: str
  title: str
  sheets: List[SupplierPaymentsSheet]
  highlights: Dict[str, Any] = Field(default_factory=dict)
  updated_at: Optional[datetime] = None
  seeded: bool = False


class SupplierPaymentsWorkbookUpsert(BaseModel):
  workbook_key: str = Field(default="risacca_2026", max_length=64)
  title: Optional[str] = Field(default=None, max_length=255)
  sheets: List[SupplierPaymentsSheet]
  highlights: Optional[Dict[str, Any]] = None
