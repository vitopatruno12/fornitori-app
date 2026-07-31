from sqlalchemy import Boolean, Column, DateTime, Integer, Numeric, String, Text, func

from ..database import Base


class BankAccount(Base):
  """Conto corrente gestito nel modulo Banca."""

  __tablename__ = "bank_accounts"

  id = Column(Integer, primary_key=True, index=True)
  bank_name = Column(String(160), nullable=False)
  account_name = Column(String(160), nullable=False, default="Conto corrente")
  iban = Column(String(34), nullable=True)
  saldo_disponibile = Column(Numeric(14, 2), nullable=False, default=0)
  saldo_contabile = Column(Numeric(14, 2), nullable=False, default=0)
  connection_status = Column(String(32), nullable=False, default="disconnected")  # connected|disconnected|pending|error
  last_sync_at = Column(DateTime(timezone=True), nullable=True)
  is_active = Column(Boolean, nullable=False, default=True)
  notes = Column(Text, nullable=True)
  created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
  updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
