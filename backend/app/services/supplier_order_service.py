from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from ..models.supplier import Supplier
from ..models.supplier_order import SupplierOrder, SupplierOrderItem
from sqlalchemy.exc import IntegrityError

from ..schemas.supplier_order import (
    SupplierOrderCreate,
    SupplierOrderItemRead,
    SupplierOrderRead,
    SupplierOrderUpdate,
)


def _merchandise_summary(items: list) -> str:
  parts = []
  for it in items:
    desc = getattr(it, "product_description", None) or (it.get("product_description") if isinstance(it, dict) else "")
    desc = (desc or "").strip()
    if not desc:
      continue
    pieces = getattr(it, "pieces", None) if not isinstance(it, dict) else it.get("pieces")
    wk = getattr(it, "weight_kg", None) if not isinstance(it, dict) else it.get("weight_kg")
    qty_bits = []
    if pieces is not None:
      qty_bits.append(f"{int(pieces)} pz")
    if wk is not None:
      try:
        w = float(wk)
        if w > 0:
          txt = ("%.3f" % w).rstrip("0").rstrip(".")
          qty_bits.append(f"{txt} kg")
      except (TypeError, ValueError):
        pass
    if qty_bits:
      parts.append(f"{desc} ({', '.join(qty_bits)})")
    else:
      parts.append(desc)
  return ", ".join(parts)[:4000] if parts else ""


def _get_supplier(db: Session, supplier_id: int) -> Supplier:
  sup = db.query(Supplier).filter(Supplier.id == supplier_id).first()
  if not sup:
    raise HTTPException(status_code=404, detail="Fornitore non trovato")
  return sup


def _next_sequence_number(db: Session, supplier_id: int) -> int:
  rows = db.query(SupplierOrder.sequence_number).filter(SupplierOrder.supplier_id == supplier_id).all()
  used = {r[0] for r in rows if r[0] is not None}
  n = 1
  while n in used:
    n += 1
  return n


def order_to_read(db: Session, order: SupplierOrder) -> SupplierOrderRead:
  name = order.supplier_name_snapshot
  if not name:
    sup = db.query(Supplier).filter(Supplier.id == order.supplier_id).first()
    name = sup.name if sup else None
  items = [SupplierOrderItemRead.model_validate(x) for x in (order.items or [])]
  seq = getattr(order, "sequence_number", None)
  return SupplierOrderRead(
      id=order.id,
      supplier_id=order.supplier_id,
      sequence_number=int(seq) if seq is not None else order.id,
      supplier_name=name,
      order_date=order.order_date,
      vat_percent=order.vat_percent,
      note=order.note,
      note_internal=getattr(order, "note_internal", None),
      expected_delivery_date=getattr(order, "expected_delivery_date", None),
      delivery_location=getattr(order, "delivery_location", None),
      order_signed_by=getattr(order, "order_signed_by", None),
      unloading_signed_by=getattr(order, "unloading_signed_by", None),
      status=order.status or "pending",
      merchandise_summary=order.merchandise_summary,
      created_at=order.created_at,
      items=items,
  )


def create_order(db: Session, dto: SupplierOrderCreate) -> SupplierOrderRead:
  sup = _get_supplier(db, dto.supplier_id)
  summary = _merchandise_summary(dto.items)
  loc = (dto.delivery_location or "").strip()
  order_sig = (dto.order_signed_by or "").strip()
  unload_sig = (dto.unloading_signed_by or "").strip()
  last_error: Optional[Exception] = None
  for _ in range(8):
    seq = _next_sequence_number(db, dto.supplier_id)
    order = SupplierOrder(
        supplier_id=dto.supplier_id,
        sequence_number=seq,
        order_date=dto.order_date,
        vat_percent=dto.vat_percent,
        note=dto.note,
        note_internal=dto.note_internal.strip() if dto.note_internal else None,
        expected_delivery_date=dto.expected_delivery_date,
        delivery_location=loc[:128] if loc else None,
        order_signed_by=order_sig[:128] if order_sig else None,
        unloading_signed_by=unload_sig[:128] if unload_sig else None,
        status=dto.status,
        supplier_name_snapshot=(sup.name or "")[:255] if sup.name else None,
        merchandise_summary=summary or None,
    )
    db.add(order)
    try:
      db.flush()
    except IntegrityError as e:
      db.rollback()
      last_error = e
      order = None  # type: ignore
      continue
    for it in dto.items:
      db.add(
          SupplierOrderItem(
              order_id=order.id,
              product_description=it.product_description.strip(),
              pieces=it.pieces,
              weight_kg=it.weight_kg,
              note=it.note.strip() if it.note else None,
          )
      )
    db.commit()
    db.refresh(order)
    order = get_order(db, order.id)
    return order_to_read(db, order)
  if last_error:
    raise HTTPException(
        status_code=409,
        detail="Impossibile assegnare il numero ordine (concorrenza). Riprova.",
    ) from last_error
  raise HTTPException(
      status_code=409,
      detail="Impossibile assegnare il numero ordine (concorrenza). Riprova.",
  )


def update_order(db: Session, order_id: int, dto: SupplierOrderUpdate) -> SupplierOrderRead:
  order = get_order(db, order_id)
  if not order:
    raise HTTPException(status_code=404, detail="Ordine non trovato")
  sup = _get_supplier(db, dto.supplier_id)
  summary = _merchandise_summary(dto.items)
  prev_supplier_id = order.supplier_id
  order.supplier_id = dto.supplier_id
  if dto.supplier_id != prev_supplier_id:
    order.sequence_number = _next_sequence_number(db, dto.supplier_id)
  order.order_date = dto.order_date
  order.vat_percent = dto.vat_percent
  order.note = dto.note
  order.note_internal = dto.note_internal.strip() if dto.note_internal else None
  order.expected_delivery_date = dto.expected_delivery_date
  loc_upd = (dto.delivery_location or "").strip()
  order_sig_upd = (dto.order_signed_by or "").strip()
  unload_sig_upd = (dto.unloading_signed_by or "").strip()
  order.delivery_location = loc_upd[:128] if loc_upd else None
  order.order_signed_by = order_sig_upd[:128] if order_sig_upd else None
  order.unloading_signed_by = unload_sig_upd[:128] if unload_sig_upd else None
  order.status = dto.status
  order.supplier_name_snapshot = (sup.name or "")[:255] if sup.name else None
  order.merchandise_summary = summary or None
  for row in list(order.items or []):
    db.delete(row)
  db.flush()
  for it in dto.items:
    db.add(
        SupplierOrderItem(
            order_id=order.id,
            product_description=it.product_description.strip(),
            pieces=it.pieces,
            weight_kg=it.weight_kg,
            note=it.note.strip() if it.note else None,
        )
    )
  db.commit()
  db.refresh(order)
  order = get_order(db, order.id)
  return order_to_read(db, order)


def delete_order(db: Session, order_id: int) -> None:
  order = get_order(db, order_id)
  if not order:
    raise HTTPException(status_code=404, detail="Ordine non trovato")
  db.delete(order)
  db.commit()


def delete_all_orders(db: Session, supplier_id: Optional[int] = None) -> int:
  if supplier_id is not None:
    order_ids = [
        oid for (oid,) in db.query(SupplierOrder.id).filter(SupplierOrder.supplier_id == supplier_id).all()
    ]
    if not order_ids:
      return 0
    db.query(SupplierOrderItem).filter(SupplierOrderItem.order_id.in_(order_ids)).delete(synchronize_session=False)
    n = db.query(SupplierOrder).filter(SupplierOrder.id.in_(order_ids)).delete(synchronize_session=False)
    db.commit()
    return int(n)
  db.query(SupplierOrderItem).delete(synchronize_session=False)
  n = db.query(SupplierOrder).delete(synchronize_session=False)
  db.commit()
  return int(n)


def get_order(db: Session, order_id: int) -> Optional[SupplierOrder]:
  return (
      db.query(SupplierOrder)
      .options(joinedload(SupplierOrder.items))
      .filter(SupplierOrder.id == order_id)
      .first()
  )


def get_order_read(db: Session, order_id: int) -> Optional[SupplierOrderRead]:
  o = get_order(db, order_id)
  return order_to_read(db, o) if o else None


def list_orders(
    db: Session,
    supplier_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    status: Optional[str] = None,
    limit: int = 200,
) -> List[SupplierOrderRead]:
  q = db.query(SupplierOrder).options(joinedload(SupplierOrder.items)).order_by(SupplierOrder.created_at.desc())
  if supplier_id is not None:
    q = q.filter(SupplierOrder.supplier_id == supplier_id)
  if date_from is not None:
    q = q.filter(SupplierOrder.order_date >= date_from)
  if date_to is not None:
    q = q.filter(SupplierOrder.order_date <= date_to)
  if status in ("pending", "sent"):
    q = q.filter(SupplierOrder.status == status)
  rows = q.limit(limit).all()
  return [order_to_read(db, o) for o in rows]


def list_pending_overdue_expected_delivery(
    db: Session,
    limit: int = 12,
) -> List[SupplierOrderRead]:
  """Ordini ancora pending con data consegna prevista già passata (promemoria dashboard)."""
  today = datetime.now(timezone.utc).date()
  q = (
      db.query(SupplierOrder)
      .options(joinedload(SupplierOrder.items))
      .filter(SupplierOrder.status == "pending")
      .filter(SupplierOrder.expected_delivery_date.isnot(None))
      .filter(SupplierOrder.expected_delivery_date < today)
      .order_by(SupplierOrder.expected_delivery_date.asc())
  )
  rows = q.limit(limit).all()
  return [order_to_read(db, o) for o in rows]
