from sqlalchemy import Column, Date, DateTime, Integer, Numeric, String, Text
from sqlalchemy.sql import func

from ..database import Base


class StaffPayrollMonth(Base):
    __tablename__ = "staff_payroll_months"

    id = Column(Integer, primary_key=True, index=True)
    year_month = Column(String(7), nullable=False, unique=True, index=True)
    period_from = Column(Date, nullable=False)
    period_to = Column(Date, nullable=False)
    lines_json = Column(Text, nullable=False, server_default="[]")
    total_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
