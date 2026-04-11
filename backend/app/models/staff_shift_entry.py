from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text, Time
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from ..database import Base


class StaffShiftEntry(Base):
    __tablename__ = "staff_shift_entries"

    id = Column(Integer, primary_key=True, index=True)
    staff_member_id = Column(Integer, ForeignKey("staff_members.id", ondelete="CASCADE"), nullable=False, index=True)
    work_date = Column(Date, nullable=False, index=True)
    time_start = Column(Time, nullable=True)
    time_end = Column(Time, nullable=True)
    entry_kind = Column(String(32), nullable=False, server_default="shift")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    member = relationship("StaffMember", back_populates="shifts")
