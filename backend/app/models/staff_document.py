"""Documenti PDF personale: contratti, buste paga, documenti anagrafici."""
from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from ..database import Base


class StaffDocument(Base):
  __tablename__ = "staff_documents"

  id = Column(Integer, primary_key=True, index=True)
  # contratto | busta_paga | documento_personale
  category = Column(String(40), nullable=False, index=True)
  # carta_identita | codice_fiscale | patente | permesso_soggiorno | contratto | busta_paga | altro
  doc_type = Column(String(40), nullable=False, default="altro")
  locale_name = Column(String(120), nullable=True, index=True)
  year_month = Column(String(7), nullable=True, index=True)  # YYYY-MM (buste)
  staff_member_id = Column(Integer, ForeignKey("staff_members.id", ondelete="SET NULL"), nullable=True)

  first_name = Column(String(120), nullable=True)
  last_name = Column(String(120), nullable=True)
  birth_date = Column(Date, nullable=True)
  email = Column(String(255), nullable=True)
  phone = Column(String(64), nullable=True)
  ruolo = Column(String(120), nullable=True)
  document_number = Column(String(80), nullable=True)

  storage_path = Column(String(512), nullable=False)
  original_name = Column(String(255), nullable=True)
  mime_type = Column(String(120), nullable=True)
  notes = Column(Text, nullable=True)

  created_at = Column(DateTime(timezone=True), server_default=func.now())
  updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
