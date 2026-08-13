from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from ..database import Base


class Carrier(Base):
    """Anagrafica trasportatore (furgone, disponibilità, spese)."""

    __tablename__ = "carriers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    phone = Column(String(32), nullable=True)
    email = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="1")
    out_of_service = Column(Boolean, nullable=False, server_default="0")
    in_service = Column(Boolean, nullable=False, server_default="0")
    rest_day = Column(Integer, nullable=True)  # 0=Dom … 6=Sab (Date#getDay)
    van_label = Column(String(120), nullable=True)
    van_plate = Column(String(32), nullable=True)
    notes = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    maintenance_logs = relationship(
        "CarrierMaintenanceLog",
        back_populates="carrier",
        cascade="all, delete-orphan",
    )
    fuel_expenses = relationship(
        "CarrierFuelExpense",
        back_populates="carrier",
        cascade="all, delete-orphan",
    )
    other_expenses = relationship(
        "CarrierOtherExpense",
        back_populates="carrier",
        cascade="all, delete-orphan",
    )


class CarrierMaintenanceLog(Base):
    __tablename__ = "carrier_maintenance_logs"

    id = Column(Integer, primary_key=True, index=True)
    carrier_id = Column(
        Integer, ForeignKey("carriers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    service_date = Column(Date, nullable=False, index=True)
    description = Column(String(512), nullable=False)
    odometer_km = Column(Integer, nullable=True)
    cost = Column(Numeric(10, 2), nullable=True)
    workshop = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    carrier = relationship("Carrier", back_populates="maintenance_logs")


class CarrierFuelExpense(Base):
    __tablename__ = "carrier_fuel_expenses"

    id = Column(Integer, primary_key=True, index=True)
    carrier_id = Column(
        Integer, ForeignKey("carriers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expense_date = Column(Date, nullable=False, index=True)
    liters = Column(Numeric(10, 2), nullable=True)
    amount_eur = Column(Numeric(10, 2), nullable=False)
    station = Column(String(255), nullable=True)
    odometer_km = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    carrier = relationship("Carrier", back_populates="fuel_expenses")


class CarrierOtherExpense(Base):
    __tablename__ = "carrier_other_expenses"

    id = Column(Integer, primary_key=True, index=True)
    carrier_id = Column(
        Integer, ForeignKey("carriers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expense_date = Column(Date, nullable=False, index=True)
    category = Column(String(120), nullable=True)
    amount_eur = Column(Numeric(10, 2), nullable=False)
    description = Column(String(512), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    carrier = relationship("Carrier", back_populates="other_expenses")
