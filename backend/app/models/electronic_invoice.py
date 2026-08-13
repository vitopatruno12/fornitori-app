from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func

from ..database import Base


class ElectronicInvoice(Base):
  """XML FatturaPA importato (hash SHA-256 per deduplica)."""

  __tablename__ = "electronic_invoices"

  id = Column(Integer, primary_key=True, index=True)
  filename = Column(String(512), nullable=True)
  xml_content = Column(Text, nullable=False)
  document_hash = Column(String(64), nullable=False, unique=True, index=True)

  document_type = Column(String(16), nullable=True)
  invoice_number = Column(String(128), nullable=True)
  invoice_date = Column(Date, nullable=True)
  currency = Column(String(8), nullable=True)

  supplier_vat = Column(String(32), nullable=True, index=True)
  customer_vat = Column(String(32), nullable=True)

  total_amount = Column(Numeric(15, 2), nullable=True)
  taxable_amount = Column(Numeric(15, 2), nullable=True)
  vat_amount = Column(Numeric(15, 2), nullable=True)

  # IMPORTED | PARSED | ERROR
  status = Column(String(32), nullable=False, server_default="IMPORTED")
  error_message = Column(Text, nullable=True)

  created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
  updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class IncomingInvoice(Base):
  """Fattura passiva derivata da XML elettronico."""

  __tablename__ = "incoming_invoices"

  id = Column(Integer, primary_key=True, index=True)
  electronic_invoice_id = Column(
    Integer,
    ForeignKey("electronic_invoices.id", ondelete="CASCADE"),
    nullable=False,
    unique=True,
  )
  supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True)
  atlas_invoice_id = Column(Integer, ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True, index=True)

  invoice_number = Column(String(128), nullable=False)
  invoice_date = Column(DateTime(timezone=True), nullable=False)

  taxable_amount = Column(Numeric(15, 2), nullable=False)
  vat_amount = Column(Numeric(15, 2), nullable=False)
  total_amount = Column(Numeric(15, 2), nullable=False)
  currency = Column(String(8), nullable=False, server_default="EUR")

  # RECEIVED | IMPORTED | REGISTERED | CANCELLED
  status = Column(String(32), nullable=False, server_default="RECEIVED")

  created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
  updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class IncomingInvoiceLine(Base):
  """Riga fattura passiva (valori XML, senza ricalcolo arbitrario)."""

  __tablename__ = "incoming_invoice_lines"
  __table_args__ = (UniqueConstraint("invoice_id", "line_number", name="uq_incoming_invoice_line"),)

  id = Column(Integer, primary_key=True, index=True)
  invoice_id = Column(Integer, ForeignKey("incoming_invoices.id", ondelete="CASCADE"), nullable=False, index=True)
  line_number = Column(Integer, nullable=False)
  description = Column(Text, nullable=True)
  quantity = Column(Numeric(15, 4), nullable=True)
  unit_price = Column(Numeric(15, 8), nullable=True)
  line_total = Column(Numeric(15, 2), nullable=True)
  vat_rate = Column(Numeric(5, 2), nullable=True)
  created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
