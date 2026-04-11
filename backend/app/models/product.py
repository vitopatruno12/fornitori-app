from sqlalchemy import Column, Integer, String, Text

from ..database import Base


class Product(Base):
  __tablename__ = "products"

  id = Column(Integer, primary_key=True, index=True)
  name = Column(String(255), nullable=False)
  category = Column(String(100), nullable=True)
  unit_of_measure = Column(String(50), nullable=True)  # es. kg, pezzi
  note = Column(Text, nullable=True)

