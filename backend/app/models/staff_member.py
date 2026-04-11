from sqlalchemy import Boolean, Column, Date, DateTime, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from ..database import Base


class StaffMember(Base):
    __tablename__ = "staff_members"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    first_name = Column(String(120), nullable=True)
    last_name = Column(String(120), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(64), nullable=True)
    city = Column(String(128), nullable=True)
    birth_date = Column(Date, nullable=True)
    sort_order = Column(Integer, nullable=False, server_default="0")
    is_active = Column(Boolean, nullable=False, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    shifts = relationship("StaffShiftEntry", back_populates="member", cascade="all, delete-orphan")
