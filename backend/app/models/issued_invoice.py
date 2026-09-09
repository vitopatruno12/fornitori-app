from sqlalchemy import Column, DateTime, Integer, Numeric, String, Text
from sqlalchemy.sql import func

from ..database import Base


class IssuedInvoice(Base):
  """Fatture emesse caricate manualmente (XML / PDF / immagine)."""

  __tablename__ = "issued_invoices"

  id = Column(Integer, primary_key=True, index=True)
  company = Column(String(64), nullable=False, index=True)
  activity = Column(String(64), nullable=True, index=True)
  file_kind = Column(String(16), nullable=False)  # xml | pdf | image
  file_path = Column(String(500), nullable=False)
  original_filename = Column(String(255), nullable=True)
  invoice_number = Column(String(100), nullable=True)
  invoice_date = Column(DateTime(timezone=True), nullable=True)
  total_amount = Column(Numeric(12, 2), nullable=True)
  status = Column(String(32), nullable=False, server_default="caricata")
  note = Column(Text, nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now())
