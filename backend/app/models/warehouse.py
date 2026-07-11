from sqlalchemy import Column, DateTime, Integer, Numeric, String, Text
from sqlalchemy.sql import func

from ..database import Base


class WarehouseMovement(Base):
  __tablename__ = "warehouse_movements"

  id = Column(Integer, primary_key=True, index=True)
  movement_type = Column(String(8), nullable=False, index=True)
  movement_at = Column(DateTime(timezone=True), nullable=False, index=True)
  operator_name = Column(String(128), nullable=False)
  signature = Column(String(128), nullable=False)
  product_description = Column(String(255), nullable=False)
  pieces = Column(Integer, nullable=True)
  weight_kg = Column(Numeric(10, 3), nullable=True)
  volume_liters = Column(Numeric(10, 3), nullable=True)
  merchandise_condition = Column(String(128), nullable=True)
  location = Column(String(128), nullable=False, server_default="Magazzino", index=True)
  note = Column(Text, nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now())
