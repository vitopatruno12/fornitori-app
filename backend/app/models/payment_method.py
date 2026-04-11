from sqlalchemy import Column, Integer, String

from ..database import Base


class PaymentMethod(Base):
    __tablename__ = "payment_methods"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(80), nullable=False, unique=True)
    sort_order = Column(Integer, nullable=False, default=0)
