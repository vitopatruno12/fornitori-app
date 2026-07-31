from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func

from ..database import Base


class BankMovement(Base):
  """Movimento bancario (estratto / sync / inserimento manuale)."""

  __tablename__ = "bank_movements"

  id = Column(Integer, primary_key=True, index=True)
  bank_account_id = Column(Integer, ForeignKey("bank_accounts.id"), nullable=False, index=True)
  movement_date = Column(Date, nullable=False, index=True)
  description = Column(String(512), nullable=True)
  causale = Column(String(256), nullable=True)
  movement_type = Column(String(16), nullable=False)  # entrata | uscita
  amount = Column(Numeric(14, 2), nullable=False)
  counterparty = Column(String(256), nullable=True)
  category = Column(String(120), nullable=True)
  reconciliation_status = Column(String(32), nullable=False, default="unmatched")  # unmatched|matched|difference
  matched_invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)
  matched_cash_entry_id = Column(Integer, ForeignKey("cash_entries.id"), nullable=True)
  difference_amount = Column(Numeric(14, 2), nullable=True)
  source = Column(String(32), nullable=False, default="manual")  # manual|sync|import|cash
  notes = Column(Text, nullable=True)
  created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
  updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
