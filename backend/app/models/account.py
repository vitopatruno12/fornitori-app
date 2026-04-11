from sqlalchemy import Column, Integer, String, Boolean

from ..database import Base


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(32), nullable=True, index=True)
    name = Column(String(120), nullable=False)
    account_type = Column(String(20), nullable=False, default="cassa")
    is_active = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
