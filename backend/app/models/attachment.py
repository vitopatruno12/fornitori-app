from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func

from ..database import Base


class Attachment(Base):
    """Allegato collegabile a movimento cassa, fattura, consegna, anagrafiche."""

    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, index=True)
    storage_path = Column(String(500), nullable=False)
    original_name = Column(String(255), nullable=True)
    title = Column(String(255), nullable=True)
    mime_type = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    cash_entry_id = Column(Integer, ForeignKey("cash_entries.id", ondelete="SET NULL"), nullable=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True, index=True)
    delivery_id = Column(Integer, ForeignKey("deliveries.id", ondelete="SET NULL"), nullable=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True)
