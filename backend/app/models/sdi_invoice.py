from sqlalchemy import Column, Date, DateTime, Integer, String, Text, func

from ..database import Base


class SdiInvoice(Base):
    """Metadati fattura ricevuta da SDI (XML non in DB — vedi storage_path)."""

    __tablename__ = "sdi_invoices"

    id = Column(Integer, primary_key=True, index=True)
    dedupe_key = Column(String(64), nullable=False, unique=True, index=True)
    sdi_message_id = Column(String(256), nullable=True)
    storage_path = Column(String(1024), nullable=False)
    supplier_vat = Column(String(32), nullable=True, index=True)
    supplier_name = Column(String(512), nullable=True)
    invoice_number = Column(String(128), nullable=True)
    invoice_date = Column(Date, nullable=True)
    receiver_code = Column(String(16), nullable=True)
    destination = Column(Text, nullable=True)
    pipeline_status = Column(String(32), nullable=False, server_default="parsed")
    source = Column(String(16), nullable=False, server_default="push")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
