from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.attachment import Attachment
from ..schemas.attachment import AttachmentRead

router = APIRouter(prefix="/attachments", tags=["attachments"])


@router.get("/", response_model=List[AttachmentRead])
def list_attachments(
    cash_entry_id: Optional[int] = Query(None),
    invoice_id: Optional[int] = Query(None),
    delivery_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Attachment)
    if cash_entry_id is not None:
        q = q.filter(Attachment.cash_entry_id == cash_entry_id)
    if invoice_id is not None:
        q = q.filter(Attachment.invoice_id == invoice_id)
    if delivery_id is not None:
        q = q.filter(Attachment.delivery_id == delivery_id)
    return q.order_by(Attachment.created_at.desc()).limit(200).all()
