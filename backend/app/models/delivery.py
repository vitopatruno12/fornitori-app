from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Text
from sqlalchemy.sql import func

from ..database import Base


class Delivery(Base):
  __tablename__ = "deliveries"

  id = Column(Integer, primary_key=True, index=True)
  supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
  product_id = Column(Integer, ForeignKey("products.id"), nullable=True, index=True)
  product_description = Column(String(255), nullable=True)
  user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
  delivery_date = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
  weight_kg = Column(Numeric(10, 3), nullable=True)
  pieces = Column(Integer, nullable=True)
  unit_price = Column(Numeric(10, 2), nullable=False)
  imponibile = Column(Numeric(10, 2), nullable=False)
  vat_percent = Column(Numeric(5, 2), nullable=False)
  vat_amount = Column(Numeric(10, 2), nullable=False)
  total = Column(Numeric(10, 2), nullable=False)
  note = Column(Text, nullable=True)
  invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True, index=True)
  delivery_document_id = Column(Integer, ForeignKey("delivery_documents.id"), nullable=True, index=True)
  ddt_number = Column(String(64), nullable=True, index=True)
  list_unit_price = Column(Numeric(10, 2), nullable=True)
  price_diff_vs_list = Column(Numeric(10, 2), nullable=True)
  anomaly_note = Column(Text, nullable=True)