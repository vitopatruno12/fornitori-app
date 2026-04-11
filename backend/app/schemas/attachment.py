from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AttachmentRead(BaseModel):
    id: int
    storage_path: str
    original_name: Optional[str] = None
    title: Optional[str] = None
    mime_type: Optional[str] = None
    created_at: datetime
    cash_entry_id: Optional[int] = None
    invoice_id: Optional[int] = None
    delivery_id: Optional[int] = None
    supplier_id: Optional[int] = None
    customer_id: Optional[int] = None

    class Config:
        from_attributes = True
