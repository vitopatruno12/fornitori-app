from sqlalchemy import Column, Integer, String, Numeric, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func

from ..database import Base


class SupplierPriceList(Base):
    __tablename__ = "supplier_price_list"

    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
    product_description = Column(String(255), nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)

    __table_args__ = (UniqueConstraint("supplier_id", "product_description", name="uq_supplier_product"),)
