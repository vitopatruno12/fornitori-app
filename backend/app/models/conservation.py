"""Pacchetti di conservazione sostitutiva (documenti + indici + hash)."""
from sqlalchemy import Column, DateTime, Integer, Numeric, String, Text, ForeignKey
from sqlalchemy.sql import func

from ..database import Base


class ConservationPackage(Base):
  __tablename__ = "conservation_packages"

  id = Column(Integer, primary_key=True, index=True)
  company = Column(String(64), nullable=False, index=True)
  label = Column(String(255), nullable=True)
  period_from = Column(DateTime(timezone=True), nullable=True)
  period_to = Column(DateTime(timezone=True), nullable=True)
  # bozza | pronto | esportato | inviato_conservatore | conservato | errore
  status = Column(String(32), nullable=False, server_default="bozza", index=True)
  document_count = Column(Integer, nullable=False, server_default="0")
  package_hash = Column(String(64), nullable=True)
  package_path = Column(String(500), nullable=True)
  index_json_path = Column(String(500), nullable=True)
  note = Column(Text, nullable=True)
  built_at = Column(DateTime(timezone=True), nullable=True)
  exported_at = Column(DateTime(timezone=True), nullable=True)
  sent_at = Column(DateTime(timezone=True), nullable=True)
  conserved_at = Column(DateTime(timezone=True), nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now())
  updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ConservationPackageItem(Base):
  __tablename__ = "conservation_package_items"

  id = Column(Integer, primary_key=True, index=True)
  package_id = Column(Integer, ForeignKey("conservation_packages.id"), nullable=False, index=True)
  source_kind = Column(String(32), nullable=False)  # atlas | issued | sdi | electronic
  source_id = Column(Integer, nullable=False)
  invoice_number = Column(String(128), nullable=True)
  invoice_date = Column(DateTime(timezone=True), nullable=True)
  supplier_name = Column(String(512), nullable=True)
  customer_vat = Column(String(32), nullable=True)
  total_amount = Column(Numeric(12, 2), nullable=True)
  file_role = Column(String(16), nullable=False)  # xml | pdf | other
  original_filename = Column(String(255), nullable=True)
  stored_relpath = Column(String(500), nullable=True)
  content_sha256 = Column(String(64), nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now())
