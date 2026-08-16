from sqlalchemy import Column, DateTime, Integer, Numeric, String, UniqueConstraint, Index
from sqlalchemy.sql import func

from ..database import Base


class PosReceipt(Base):
    """Scontrino / ticket da registratore EasyRetail (o CSV export).

    Una riga = una visita/cliente (scontrino chiuso).
    """

    __tablename__ = "pos_receipts"
    __table_args__ = (
        UniqueConstraint(
            "source",
            "store_key",
            "external_id",
            name="uq_pos_receipts_source_store_external",
        ),
        Index("ix_pos_receipts_when_store", "receipt_at", "store_key"),
        Index("ix_pos_receipts_model_when", "model_id", "receipt_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(32), nullable=False, default="easyretail", index=True)
    store_key = Column(String(64), nullable=False, default="", index=True)
    model_id = Column(String(32), nullable=True, index=True)  # model-1|model-2|model-3
    model_label = Column(String(80), nullable=True)
    external_id = Column(String(120), nullable=False)  # numero scontrino / id univoco
    receipt_at = Column(DateTime(timezone=True), nullable=False, index=True)
    amount_eur = Column(Numeric(12, 2), nullable=True)
    is_void = Column(Integer, nullable=False, default=0)  # 0|1
    raw_store = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
