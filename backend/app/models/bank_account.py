from sqlalchemy import Boolean, Column, DateTime, Integer, Numeric, String, Text, func

from ..database import Base


class BankAccount(Base):
  """Conto corrente gestito nel modulo Banca."""

  __tablename__ = "bank_accounts"

  id = Column(Integer, primary_key=True, index=True)
  bank_name = Column(String(160), nullable=False)
  account_name = Column(String(160), nullable=False, default="Conto corrente")
  iban = Column(String(34), nullable=True)
  # Società Atlas (mediazione_a|…); vuoto = condiviso per mastrini finché non si assegnano le altre banche
  company = Column(String(64), nullable=True, index=True)
  # Codice mastro Passcom (default 1100 Banca c/c)
  ledger_code = Column(String(16), nullable=False, default="1100")
  saldo_disponibile = Column(Numeric(14, 2), nullable=False, default=0)
  saldo_contabile = Column(Numeric(14, 2), nullable=False, default=0)
  connection_status = Column(String(32), nullable=False, default="disconnected")  # connected|disconnected|pending|error
  last_sync_at = Column(DateTime(timezone=True), nullable=True)
  # Enable Banking (AIS)
  eb_session_id = Column(String(64), nullable=True)
  eb_account_uid = Column(String(64), nullable=True)
  eb_aspsp_name = Column(String(120), nullable=True)
  eb_aspsp_country = Column(String(2), nullable=True)
  is_active = Column(Boolean, nullable=False, default=True)
  notes = Column(Text, nullable=True)
  created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
  updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
