from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from ..database import Base


class SupportTechnician(Base):
    __tablename__ = "support_technicians"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(255), nullable=False)
    phone = Column(String(32), nullable=False)
    specialty = Column(String(255), nullable=True)
    sort_order = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    activities = relationship(
        "TechnicianActivity",
        back_populates="technician",
        cascade="all, delete-orphan",
    )


class TechnicianActivity(Base):
    __tablename__ = "technician_activities"

    id = Column(Integer, primary_key=True, index=True)
    technician_id = Column(Integer, ForeignKey("support_technicians.id", ondelete="CASCADE"), nullable=False, index=True)
    activity_date = Column(Date, nullable=False, index=True)
    time_start = Column(String(5), nullable=True)
    time_end = Column(String(5), nullable=True)
    location = Column(String(512), nullable=True)
    notes = Column(Text, nullable=True)
    kind = Column(String(32), nullable=False, server_default="planned")  # planned | completed

    technician = relationship("SupportTechnician", back_populates="activities")


class TechnicianInvoiceFile(Base):
    """PDF fattura tecnico caricato dall'utente (archivio sotto /uploads)."""

    __tablename__ = "technician_invoice_files"

    id = Column(Integer, primary_key=True, index=True)
    technician_id = Column(Integer, ForeignKey("support_technicians.id", ondelete="SET NULL"), nullable=True, index=True)
    period_from = Column(Date, nullable=False)
    period_to = Column(Date, nullable=False)
    invoice_number = Column(String(64), nullable=True)
    storage_path = Column(String(500), nullable=False)
    original_name = Column(String(255), nullable=True)
    mime_type = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
