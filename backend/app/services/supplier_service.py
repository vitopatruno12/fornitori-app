from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import func, cast
from sqlalchemy.types import Numeric
from sqlalchemy.orm import Session

from ..models.cash_entry import CashEntry
from ..models.delivery import Delivery
from ..models.invoice import Invoice
from ..models.supplier import Supplier
from ..models.supplier_price_list import SupplierPriceList
from ..schemas import supplier as supplier_schema
from ..schemas.supplier import SupplierRead, SupplierWithStats


def list_suppliers(db: Session) -> List[Supplier]:
  return db.query(Supplier).order_by(Supplier.name).all()


def list_suppliers_with_stats(db: Session) -> List[SupplierWithStats]:
  suppliers = db.query(Supplier).order_by(Supplier.name).all()
  now = datetime.now(timezone.utc)
  out: List[SupplierWithStats] = []
  for s in suppliers:
    tot_fatt = (
      db.query(func.coalesce(func.sum(Invoice.total), 0))
      .filter(Invoice.supplier_id == s.id)
      .scalar()
    )
    tot_da_pag = (
      db.query(func.coalesce(func.sum(Invoice.total), 0))
      .filter(Invoice.supplier_id == s.id, Invoice.is_paid.is_(False))
      .scalar()
    )
    paid_amt = func.coalesce(Invoice.amount_paid, 0)
    residual_expr = cast(Invoice.total, Numeric) - cast(paid_amt, Numeric)
    saldo_aperto = (
      db.query(func.coalesce(func.sum(residual_expr), 0))
      .filter(Invoice.supplier_id == s.id)
      .filter(residual_expr > 0.009)
      .scalar()
    )
    ult_cons = (
      db.query(func.max(Delivery.delivery_date))
      .filter(Delivery.supplier_id == s.id)
      .scalar()
    )
    ult_fatt = (
      db.query(func.max(Invoice.invoice_date))
      .filter(Invoice.supplier_id == s.id)
      .scalar()
    )
    scad = (
      db.query(func.count(Invoice.id))
      .filter(
        Invoice.supplier_id == s.id,
        Invoice.is_paid.is_(False),
        Invoice.due_date.isnot(None),
        Invoice.due_date < now,
      )
      .scalar()
    )
    listino_n = (
      db.query(func.count(SupplierPriceList.id))
      .filter(SupplierPriceList.supplier_id == s.id)
      .scalar()
    )
    base = SupplierRead.model_validate(s).model_dump()
    base.update({
      "totale_fatture": float(tot_fatt or 0),
      "totale_da_pagare": float(tot_da_pag or 0),
      "saldo_aperto": float(saldo_aperto or 0),
      "ultima_consegna": ult_cons,
      "ultima_fattura": ult_fatt,
      "scadenze_aperte": int(scad or 0),
      "listino_righe": int(listino_n or 0),
    })
    out.append(SupplierWithStats(**base))
  return out


def get_supplier(db: Session, supplier_id: int) -> Optional[Supplier]:
  return db.query(Supplier).filter(Supplier.id == supplier_id).first()


def create_supplier(db: Session, data: supplier_schema.SupplierCreate) -> Supplier:
  supplier = Supplier(**data.model_dump())
  db.add(supplier)
  db.commit()
  db.refresh(supplier)
  return supplier


def update_supplier(
  db: Session,
  supplier_id: int,
  data: supplier_schema.SupplierUpdate,
) -> Optional[Supplier]:
  supplier = get_supplier(db, supplier_id)
  if not supplier:
    return None

  for field, value in data.model_dump(exclude_unset=True).items():
    setattr(supplier, field, value)

  db.commit()
  db.refresh(supplier)
  return supplier


def delete_supplier(db: Session, supplier_id: int) -> bool:
  supplier = get_supplier(db, supplier_id)
  if not supplier:
    return False

  # Ordine: scarichi (possono riferire fatture), fatture, prezzario, stacca cassa — poi fornitore
  db.query(Delivery).filter(Delivery.supplier_id == supplier_id).delete(synchronize_session=False)
  db.query(Invoice).filter(Invoice.supplier_id == supplier_id).delete(synchronize_session=False)
  db.query(SupplierPriceList).filter(SupplierPriceList.supplier_id == supplier_id).delete(
    synchronize_session=False
  )
  db.query(CashEntry).filter(CashEntry.supplier_id == supplier_id).update(
    {CashEntry.supplier_id: None},
    synchronize_session=False,
  )
  db.delete(supplier)
  db.commit()
  return True


def delete_all_suppliers(db: Session) -> int:
  """Elimina tutti i fornitori e i dati collegati (scarichi, fatture, prezzario; stacca fornitore dalla cassa)."""
  n = db.query(Supplier).count()
  db.query(Delivery).delete(synchronize_session=False)
  db.query(Invoice).delete(synchronize_session=False)
  db.query(CashEntry).filter(CashEntry.supplier_id.isnot(None)).update(
    {CashEntry.supplier_id: None},
    synchronize_session=False,
  )
  db.query(SupplierPriceList).delete(synchronize_session=False)
  db.query(Supplier).delete(synchronize_session=False)
  db.commit()
  return int(n)