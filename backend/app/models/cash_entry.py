from sqlalchemy import Column, Integer, String, DateTime, Numeric, ForeignKey, Text
from sqlalchemy.sql import func

from ..database import Base


class CashEntry(Base):
    __tablename__ = "cash_entries"

    id = Column(Integer, primary_key=True, index=True)
    entry_date = Column(DateTime(timezone=True), nullable=False, index=True)
    type = Column(String(20), nullable=False)  # entrata | uscita
    amount = Column(Numeric(12, 2), nullable=False)
    description = Column(String(255), nullable=True)
    note = Column(Text, nullable=True)  # note per commercialista
    conto = Column(String(100), nullable=True)  # Cassa, Conto corrente, etc.
    riferimento_documento = Column(String(100), nullable=True)  # Es. Fattura n. 123
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True, index=True)
    delivery_id = Column(Integer, ForeignKey("deliveries.id"), nullable=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True, index=True)
    payment_method_id = Column(Integer, ForeignKey("payment_methods.id"), nullable=True, index=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
