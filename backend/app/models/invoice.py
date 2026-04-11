from sqlalchemy import Boolean, Column, Integer, String, DateTime, ForeignKey, Numeric, Text
from sqlalchemy.sql import func

from ..database import Base


class Invoice(Base):
  __tablename__ = "invoices"

  id = Column(Integer, primary_key=True, index=True)
  supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
  invoice_number = Column(String(100), nullable=False)
  invoice_date = Column(DateTime(timezone=True), nullable=False)
  imponibile = Column(Numeric(10, 2), nullable=False)
  vat_percent = Column(Numeric(5, 2), nullable=False)
  vat_amount = Column(Numeric(10, 2), nullable=False)
  total = Column(Numeric(10, 2), nullable=False)
  file_path = Column(String(500), nullable=True)
  note = Column(Text, nullable=True)
  is_paid = Column(Boolean, nullable=False, server_default="0")
  due_date = Column(DateTime(timezone=True), nullable=True, index=True)
  amount_paid = Column(Numeric(10, 2), nullable=False, server_default="0")
  cash_entry_id = Column(Integer, ForeignKey("cash_entries.id"), nullable=True, index=True)
  ignored = Column(Boolean, nullable=False, server_default="0")
  created_at = Column(DateTime(timezone=True), server_default=func.now())