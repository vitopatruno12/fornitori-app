from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from ..database import Base


class SupplierPaymentsWorkbook(Base):
  __tablename__ = "supplier_payments_workbooks"

  id = Column(Integer, primary_key=True, index=True)
  workbook_key = Column(String(64), nullable=False, unique=True, index=True)
  title = Column(String(255), nullable=False, server_default="")
  payload_json = Column(Text, nullable=False, server_default="{}")
  updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
