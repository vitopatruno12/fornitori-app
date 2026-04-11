from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.sql import func

from ..database import Base


class DeliveryDocument(Base):
    """Testata documento di consegna (DDT); le righe restano in `deliveries` con delivery_document_id opzionale."""

    __tablename__ = "delivery_documents"

    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
    ddt_number = Column(String(64), nullable=True, index=True)
    delivery_date = Column(DateTime(timezone=True), nullable=False, index=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
