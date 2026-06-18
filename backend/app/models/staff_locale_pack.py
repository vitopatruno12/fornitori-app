from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from ..database import Base


class StaffLocalePack(Base):
    """Lista dipendenti salvata per nome locale (condivisa tra browser/PC)."""

    __tablename__ = "staff_locale_packs"

    id = Column(Integer, primary_key=True, index=True)
    locale_name = Column(String(255), nullable=False, unique=True, index=True)
    members_json = Column(Text, nullable=False, server_default="[]")
    access_code = Column(String(6), nullable=True, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
