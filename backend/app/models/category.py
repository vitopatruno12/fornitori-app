from sqlalchemy import Column, Integer, String

from ..database import Base


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    flow = Column(String(20), nullable=False, default="entrambi")
