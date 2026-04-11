from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from ..database import Base


class SupplierOrder(Base):
  __tablename__ = "supplier_orders"

  id = Column(Integer, primary_key=True, index=True)
  supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
  order_date = Column(Date, nullable=False)
  vat_percent = Column(Numeric(5, 2), nullable=False, server_default="23")
  note = Column(Text, nullable=True)
  note_internal = Column(Text, nullable=True)
  expected_delivery_date = Column(Date, nullable=True)
  status = Column(String(20), nullable=False, server_default="pending")
  supplier_name_snapshot = Column(String(255), nullable=True)
  merchandise_summary = Column(Text, nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now())

  items = relationship(
      "SupplierOrderItem",
      back_populates="order",
      cascade="all, delete-orphan",
      order_by="SupplierOrderItem.id",
  )


class SupplierOrderItem(Base):
  __tablename__ = "supplier_order_items"

  id = Column(Integer, primary_key=True, index=True)
  order_id = Column(Integer, ForeignKey("supplier_orders.id", ondelete="CASCADE"), nullable=False, index=True)
  product_description = Column(String(255), nullable=False)
  pieces = Column(Integer, nullable=True)
  weight_kg = Column(Numeric(10, 3), nullable=True)
  note = Column(Text, nullable=True)

  order = relationship("SupplierOrder", back_populates="items")
