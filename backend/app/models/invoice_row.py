from sqlalchemy import Column, Integer, String, ForeignKey, Numeric, UniqueConstraint

from ..database import Base


class InvoiceRow(Base):
    __tablename__ = "invoice_rows"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    line_no = Column(Integer, nullable=False, default=1)
    description = Column(String(500), nullable=True)
    quantity = Column(Numeric(12, 3), nullable=True)
    unit_price = Column(Numeric(12, 2), nullable=True)
    vat_percent = Column(Numeric(5, 2), nullable=False, default=22.0)
    imponibile = Column(Numeric(12, 2), nullable=False)
    vat_amount = Column(Numeric(12, 2), nullable=False)
    total_line = Column(Numeric(12, 2), nullable=False)

    __table_args__ = (UniqueConstraint("invoice_id", "line_no", name="uq_invoice_row_line"),)
