from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func

from ..database import Base


class Supplier(Base):
  __tablename__ = "suppliers"

  id = Column(Integer, primary_key=True, index=True)
  name = Column(String(255), nullable=False, index=True)
  vat_number = Column(String(50), unique=True, nullable=True, index=True)
  fiscal_code = Column(String(32), nullable=True, index=True)
  address = Column(String(255), nullable=True)
  city = Column(String(100), nullable=True)
  country = Column(String(100), nullable=True)
  email = Column(String(255), nullable=True)
  phone = Column(String(50), nullable=True)
  contact_person = Column(String(255), nullable=True)
  iban = Column(String(34), nullable=True)
  payment_terms = Column(Text, nullable=True)
  merchandise_category = Column(String(120), nullable=True)
  notes = Column(Text, nullable=True)
  price_list_label = Column(String(255), nullable=True)
  is_active = Column(Boolean, nullable=False, server_default="1")
  is_expired = Column(Boolean, nullable=False, server_default="0")
  created_at = Column(DateTime(timezone=True), server_default=func.now())