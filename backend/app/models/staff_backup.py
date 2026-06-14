from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from ..database import Base


class StaffBackup(Base):
    """Backup sezione Personale (pianificazione, ore/costi) — condiviso tra PC/browser."""

    __tablename__ = "staff_backups"
    __table_args__ = (UniqueConstraint("section", "backup_key", name="uq_staff_backups_section_key"),)

    id = Column(Integer, primary_key=True, index=True)
    section = Column(String(32), nullable=False, index=True)
    backup_key = Column(String(255), nullable=False, index=True)
    payload_json = Column(Text, nullable=False, server_default="{}")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
