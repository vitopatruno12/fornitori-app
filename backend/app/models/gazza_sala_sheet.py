from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from ..database import Base


class GazzaSalaSheet(Base):
    """Foglio sala Gazza Ladra condiviso tra postazione e palmari (data + fascia)."""

    __tablename__ = "gazza_sala_sheets"
    __table_args__ = (UniqueConstraint("service_date", "fascia", name="uq_gazza_sala_date_fascia"),)

    id = Column(Integer, primary_key=True, index=True)
    service_date = Column(String(10), nullable=False, index=True)
    fascia = Column(String(16), nullable=False, index=True)
    tables_json = Column(Text, nullable=False, server_default="[]")
    history_json = Column(Text, nullable=False, server_default="[]")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
