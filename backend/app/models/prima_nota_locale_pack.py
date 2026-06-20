from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.sql import func

from ..database import Base


class PrimaNotaLocalePack(Base):
    """Codice di accesso per locale Prima Nota (slug attività)."""

    __tablename__ = "prima_nota_locale_packs"

    id = Column(Integer, primary_key=True, index=True)
    activity_slug = Column(String(32), nullable=False, unique=True, index=True)
    label = Column(String(255), nullable=True)
    access_code = Column(String(6), nullable=True, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
