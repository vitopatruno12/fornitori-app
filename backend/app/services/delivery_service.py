from datetime import datetime
from decimal import Decimal
from typing import List, Optional
import re

from sqlalchemy import func, or_
from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.delivery import Delivery
from ..models.supplier import Supplier
from ..schemas.delivery import (
    DeliveryCreate,
    DeliveryBatchCreate,
    DeliveryNotesUpdate,
    DeliveryPriceAnalytics,
    DeliveryPricePoint,
    DeliveryRead,
    DeliveryReadEnriched,
    DeliveryImportRequest,
    DeliveryImportResult,
    DeliveryImportRow,
)
from . import price_list_service
from .vat_service import calculate_vat


def _norm_ddt(value) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def _norm_signature(value) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s[:128] if s else None


def _merge_delivery_note(destination_note: Optional[str], document_note: Optional[str]) -> Optional[str]:
    dest = (destination_note or "").strip()
    doc = (document_note or "").strip()
    parts = []
    if dest:
        parts.append(f"Destinazione scarico: {dest}")
    if doc:
        parts.append(doc)
    return "\n\n".join(parts) if parts else None


def _split_delivery_note(note: Optional[str]) -> dict:
    raw = str(note or "").strip()
    if not raw:
        return {"destination": "", "document_note": ""}
    m = re.match(r"^Destinazione\s+scarico:\s*(.+)$", raw, flags=re.IGNORECASE | re.MULTILINE)
    destination = str(m.group(1) or "").strip() if m else ""
    if not destination:
        return {"destination": "", "document_note": raw}
    lines = raw.splitlines()
    skipping = True
    rest = []
    for ln in lines:
        t = ln.strip()
        if skipping and re.match(r"^Destinazione\s+scarico:", t, flags=re.IGNORECASE):
            continue
        if skipping and t == "":
            continue
        skipping = False
        rest.append(ln)
    return {"destination": destination, "document_note": "\n".join(rest).strip()}


def _ensure_supplier_ddt_unique(db: Session, supplier_id: int, ddt_number: Optional[str]) -> None:
    ddt = _norm_ddt(ddt_number)
    if not ddt:
        return
    exists = (
        db.query(Delivery.id)
        .filter(Delivery.supplier_id == supplier_id)
        .filter(func.lower(Delivery.ddt_number) == ddt.lower())
        .first()
    )
    if exists is not None:
        raise HTTPException(
            status_code=400,
            detail=f"DDT '{ddt}' già presente per questo fornitore. Usa un numero DDT univoco.",
        )


def _resolve_listino(
    db: Session, supplier_id: int, product_description: Optional[str], unit_price: Decimal
) -> tuple[Optional[Decimal], Optional[Decimal]]:
    lp = price_list_service.get_unit_price_for_product(db, supplier_id, product_description)
    if lp is None:
        return None, None
    up = unit_price if isinstance(unit_price, Decimal) else Decimal(str(unit_price))
    lpq = lp if isinstance(lp, Decimal) else Decimal(str(lp))
    diff = (up.quantize(Decimal("0.01")) - lpq.quantize(Decimal("0.01"))).quantize(Decimal("0.01"))
    return lpq.quantize(Decimal("0.01")), diff


def list_deliveries(
    db: Session,
    supplier_id: Optional[int] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    product_query: Optional[str] = None,
) -> List[DeliveryReadEnriched]:
    query = db.query(Delivery, Supplier.name).join(Supplier, Delivery.supplier_id == Supplier.id)

    if supplier_id is not None:
        query = query.filter(Delivery.supplier_id == supplier_id)
    if date_from is not None:
        query = query.filter(Delivery.delivery_date >= date_from)
    if date_to is not None:
        query = query.filter(Delivery.delivery_date <= date_to)
    if product_query and product_query.strip():
        q = f"%{product_query.strip()}%"
        query = query.filter(
            or_(
                Delivery.product_description.ilike(q),
                Delivery.note.ilike(q),
                Delivery.anomaly_note.ilike(q),
            )
        )

    rows = query.order_by(Delivery.delivery_date.desc()).all()
    out: List[DeliveryReadEnriched] = []
    for d, supplier_name in rows:
        base = DeliveryRead.model_validate(d, from_attributes=True)
        out.append(DeliveryReadEnriched(**base.model_dump(), supplier_name=supplier_name))
    return out


def price_analytics(
    db: Session, supplier_id: int, product_description: str
) -> DeliveryPriceAnalytics:
    desc = (product_description or "").strip()
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    supplier_name = supplier.name if supplier else None

    q = (
        db.query(Delivery)
        .filter(Delivery.supplier_id == supplier_id)
        .filter(Delivery.product_description.isnot(None))
        .filter(func.lower(Delivery.product_description) == desc.lower())
    )
    deliveries = q.order_by(Delivery.delivery_date.asc()).all()

    if not deliveries:
        return DeliveryPriceAnalytics(
            supplier_id=supplier_id,
            supplier_name=supplier_name,
            product_description=desc,
            last_unit_price=None,
            last_delivery_date=None,
            avg_unit_price=None,
            min_unit_price=None,
            max_unit_price=None,
            delivery_count=0,
            series=[],
        )

    prices = [Decimal(str(d.unit_price)) for d in deliveries]
    last = deliveries[-1]
    avg = sum(prices) / Decimal(len(prices))

    series = [
        DeliveryPricePoint(
            delivery_date=d.delivery_date,
            unit_price=d.unit_price,
            imponibile=d.imponibile,
            total=d.total,
            ddt_number=d.ddt_number,
        )
        for d in deliveries
    ]

    return DeliveryPriceAnalytics(
        supplier_id=supplier_id,
        supplier_name=supplier_name,
        product_description=desc,
        last_unit_price=last.unit_price,
        last_delivery_date=last.delivery_date,
        avg_unit_price=avg.quantize(Decimal("0.01")),
        min_unit_price=min(prices).quantize(Decimal("0.01")),
        max_unit_price=max(prices).quantize(Decimal("0.01")),
        delivery_count=len(deliveries),
        series=series,
    )


def create_delivery(db: Session, data: DeliveryCreate) -> Delivery:
    payload = data.model_dump()
    _ensure_supplier_ddt_unique(db, payload["supplier_id"], payload.get("ddt_number"))

    weight_kg = Decimal(str(payload.get("weight_kg") or 0))
    pieces = payload.get("pieces") or 0
    unit_price = Decimal(str(payload["unit_price"]))
    vat_percent = Decimal(str(payload.get("vat_percent") or "23.0"))

    if weight_kg > 0:
        imponibile = (weight_kg * unit_price).quantize(Decimal("0.01"))
    else:
        imponibile = (Decimal(str(pieces)) * unit_price).quantize(Decimal("0.01"))

    vat_amount, total = calculate_vat(imponibile, vat_percent)
    list_u, diff = _resolve_listino(
        db, payload["supplier_id"], payload.get("product_description"), unit_price
    )

    delivery = Delivery(
        supplier_id=payload["supplier_id"],
        product_id=payload.get("product_id"),
        product_description=payload.get("product_description"),
        user_id=payload.get("user_id"),
        delivery_date=payload.get("delivery_date") or datetime.utcnow(),
        weight_kg=weight_kg or None,
        pieces=pieces or None,
        unit_price=unit_price,
        imponibile=imponibile,
        vat_percent=vat_percent,
        vat_amount=vat_amount,
        total=total,
        note=payload.get("note"),
        invoice_id=payload.get("invoice_id"),
        ddt_number=_norm_ddt(payload.get("ddt_number")),
        order_signed_by=_norm_signature(payload.get("order_signed_by")),
        unloading_signed_by=_norm_signature(payload.get("unloading_signed_by")),
        list_unit_price=list_u,
        price_diff_vs_list=diff,
        anomaly_note=payload.get("anomaly_note"),
    )

    db.add(delivery)
    db.commit()
    db.refresh(delivery)
    return delivery


def create_delivery_batch(db: Session, data: DeliveryBatchCreate) -> List[Delivery]:
    payload = data.model_dump()
    supplier_id = payload["supplier_id"]
    delivery_date = payload.get("delivery_date") or datetime.utcnow()
    note = payload.get("note")
    ddt_number = _norm_ddt(payload.get("ddt_number"))
    _ensure_supplier_ddt_unique(db, supplier_id, ddt_number)
    order_signed_by = _norm_signature(payload.get("order_signed_by"))
    unloading_signed_by = _norm_signature(payload.get("unloading_signed_by"))
    carrier_id = payload.get("carrier_id")
    items = payload["items"]
    vat_percent = Decimal(str(payload.get("vat_percent") or "23.0"))

    if not items:
        return []

    created = []
    for item in items:
        weight_kg = Decimal(str(item.get("weight_kg") or 0))
        pieces = item.get("pieces") or 0
        unit_price = Decimal(str(item["unit_price"]))

        if weight_kg > 0:
            imponibile = (weight_kg * unit_price).quantize(Decimal("0.01"))
        else:
            imponibile = (Decimal(str(pieces)) * unit_price).quantize(Decimal("0.01"))

        vat_amount, total = calculate_vat(imponibile, vat_percent)
        prod_desc = item.get("product_description")
        list_u, diff = _resolve_listino(db, supplier_id, prod_desc, unit_price)
        anomaly_note = item.get("anomaly_note")

        delivery = Delivery(
            supplier_id=supplier_id,
            product_id=None,
            product_description=prod_desc,
            user_id=None,
            delivery_date=delivery_date,
            weight_kg=weight_kg or None,
            pieces=pieces or None,
            unit_price=unit_price,
            imponibile=imponibile,
            vat_percent=vat_percent,
            vat_amount=vat_amount,
            total=total,
            note=note,
            invoice_id=None,
            ddt_number=ddt_number,
            order_signed_by=order_signed_by,
            unloading_signed_by=unloading_signed_by,
            list_unit_price=list_u,
            price_diff_vs_list=diff,
            anomaly_note=anomaly_note,
            carrier_id=carrier_id,
        )
        db.add(delivery)
        created.append(delivery)

    db.commit()
    for d in created:
        db.refresh(d)
    return created


def delete_all_deliveries(db: Session) -> int:
    n = db.query(Delivery).delete(synchronize_session=False)
    db.commit()
    return int(n)


def delete_delivery(db: Session, delivery_id: int) -> None:
    delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
    if not delivery:
        raise HTTPException(status_code=404, detail="Consegna non trovata")
    db.delete(delivery)
    db.commit()


def update_delivery_notes(db: Session, delivery_id: int, data: DeliveryNotesUpdate) -> Delivery:
    delivery = db.query(Delivery).filter(Delivery.id == delivery_id).first()
    if not delivery:
        raise HTTPException(status_code=404, detail="Consegna non trovata")

    payload = data.model_dump(exclude_unset=True)

    if "product_description" in payload:
        desc = payload.get("product_description")
        delivery.product_description = (str(desc).strip() if desc is not None else "") or None

    if "destination_note" in payload or "note" in payload:
        current = _split_delivery_note(delivery.note)
        if "destination_note" in payload:
            destination_note = str(payload.get("destination_note") or "").strip()
        else:
            destination_note = current.get("destination") or ""
        if "note" in payload:
            document_note = str(payload.get("note") or "").strip()
        else:
            document_note = current.get("document_note") or ""
        delivery.note = _merge_delivery_note(destination_note, document_note)

    if "anomaly_note" in payload:
        anomaly_note = payload.get("anomaly_note")
        anomaly_note = anomaly_note.strip() if isinstance(anomaly_note, str) else anomaly_note
        delivery.anomaly_note = anomaly_note or None

    qty_changed = False
    if "weight_kg" in payload:
        w = payload.get("weight_kg")
        delivery.weight_kg = Decimal(str(w)) if w is not None and str(w) != "" else None
        qty_changed = True
    if "pieces" in payload:
        p = payload.get("pieces")
        delivery.pieces = int(p) if p is not None and str(p) != "" else None
        qty_changed = True
    if "unit_price" in payload:
        up = payload.get("unit_price")
        if up is not None and str(up) != "":
            delivery.unit_price = Decimal(str(up))
            qty_changed = True

    if qty_changed or "product_description" in payload:
        weight_kg = Decimal(str(delivery.weight_kg or 0))
        pieces = delivery.pieces or 0
        unit_price = Decimal(str(delivery.unit_price or 0))
        vat_percent = Decimal(str(delivery.vat_percent or "23.0"))
        if weight_kg > 0:
            imponibile = (weight_kg * unit_price).quantize(Decimal("0.01"))
        else:
            imponibile = (Decimal(str(pieces)) * unit_price).quantize(Decimal("0.01"))
        vat_amount, total = calculate_vat(imponibile, vat_percent)
        delivery.imponibile = imponibile
        delivery.vat_amount = vat_amount
        delivery.total = total
        list_u, diff = _resolve_listino(
            db, delivery.supplier_id, delivery.product_description, unit_price
        )
        delivery.list_unit_price = list_u
        delivery.price_diff_vs_list = diff

    db.add(delivery)
    db.commit()
    db.refresh(delivery)
    return delivery


def _normalize_supplier_key(name):
  return re.sub(r'\s+', ' ', str(name or '').strip().lower())


def _product_key(value) -> str:
  return re.sub(r'\s+', ' ', str(value or '').strip().lower())


def _apply_file_row(db: Session, delivery: Delivery, row: DeliveryImportRow) -> None:
  """Sovrascrive una riga già salvata con i dati del file. Non cancella altre righe."""
  product = (row.product_description or '').strip()
  if product:
    delivery.product_description = product[:255]
  if row.delivery_date:
    delivery.delivery_date = row.delivery_date
  delivery.weight_kg = Decimal(str(row.weight_kg)) if row.weight_kg is not None else None
  delivery.pieces = int(row.pieces) if row.pieces is not None else None
  unit_price = Decimal(str(row.unit_price if row.unit_price is not None else 0))
  delivery.unit_price = unit_price
  vat_percent = Decimal(str(row.vat_percent or delivery.vat_percent or '23.0'))
  delivery.vat_percent = vat_percent
  weight_kg = Decimal(str(delivery.weight_kg or 0))
  pieces = delivery.pieces or 0
  if weight_kg > 0:
    imponibile = (weight_kg * unit_price).quantize(Decimal('0.01'))
  else:
    imponibile = (Decimal(str(pieces)) * unit_price).quantize(Decimal('0.01'))
  vat_amount, total = calculate_vat(imponibile, vat_percent)
  delivery.imponibile = imponibile
  delivery.vat_amount = vat_amount
  delivery.total = total
  dest = (row.destination or '').strip()
  doc_note = (row.document_note or '').strip()
  if dest or doc_note:
    delivery.note = _merge_delivery_note(dest or None, doc_note or None)
  unloading = _norm_signature(row.unloading_signed_by)
  if unloading:
    delivery.unloading_signed_by = unloading
  anomaly = (row.anomaly_note or '').strip()
  delivery.anomaly_note = anomaly or None
  list_u, diff = _resolve_listino(db, delivery.supplier_id, delivery.product_description, unit_price)
  delivery.list_unit_price = list_u
  delivery.price_diff_vs_list = diff
  db.add(delivery)


def _append_lines_on_existing_ddt(db: Session, supplier: Supplier, rows: List[DeliveryImportRow]) -> int:
  """Aggiunge righe nuove su un DDT già presente, senza toccare le altre."""
  if not rows:
    return 0
  first = rows[0]
  delivery_date = first.delivery_date or datetime.utcnow()
  note = _merge_delivery_note((first.destination or '').strip() or None, (first.document_note or '').strip() or None)
  unloading = _norm_signature(first.unloading_signed_by)
  vat_percent = Decimal(str(first.vat_percent or '23.0'))
  ddt = _norm_ddt(first.ddt_number)
  created = 0
  for row in rows:
    weight_kg = Decimal(str(row.weight_kg or 0))
    pieces = row.pieces or 0
    unit_price = Decimal(str(row.unit_price if row.unit_price is not None else 0))
    if weight_kg > 0:
      imponibile = (weight_kg * unit_price).quantize(Decimal('0.01'))
    else:
      imponibile = (Decimal(str(pieces)) * unit_price).quantize(Decimal('0.01'))
    vat_amount, total = calculate_vat(imponibile, vat_percent)
    prod_desc = (row.product_description or '').strip() or None
    list_u, diff = _resolve_listino(db, supplier.id, prod_desc, unit_price)
    db.add(Delivery(
      supplier_id=supplier.id,
      product_id=None,
      product_description=prod_desc,
      user_id=None,
      delivery_date=row.delivery_date or delivery_date,
      weight_kg=weight_kg or None,
      pieces=pieces or None,
      unit_price=unit_price,
      imponibile=imponibile,
      vat_percent=vat_percent,
      vat_amount=vat_amount,
      total=total,
      note=note,
      invoice_id=None,
      ddt_number=ddt,
      order_signed_by=None,
      unloading_signed_by=unloading,
      list_unit_price=list_u,
      price_diff_vs_list=diff,
      anomaly_note=(row.anomaly_note or '').strip() or None,
      carrier_id=None,
    ))
    created += 1
  db.commit()
  return created


def _update_existing_ddt_lines(db: Session, existing: List[Delivery], bundle) -> tuple[int, int]:
  """Allinea le righe del file a quelle già salvate. Le righe dello storico assenti dal file restano."""
  pool = list(existing)
  updated = 0
  pending: List[DeliveryImportRow] = []
  for _supplier, row in bundle:
    key = _product_key(row.product_description)
    hit_i = None
    if key:
      for i, delivery in enumerate(pool):
        if _product_key(delivery.product_description) == key:
          hit_i = i
          break
    if hit_i is None:
      pending.append(row)
      continue
    _apply_file_row(db, pool.pop(hit_i), row)
    updated += 1
  if updated == 0 and pending and len(pending) == len(pool):
    for delivery, row in zip(list(pool), list(pending)):
      _apply_file_row(db, delivery, row)
    updated = len(pending)
    pool.clear()
    pending.clear()
  if len(pending) == 1 and len(pool) == 1:
    _apply_file_row(db, pool.pop(), pending.pop())
    updated += 1
  db.commit()
  inserted = 0
  if pending:
    inserted = _append_lines_on_existing_ddt(db, bundle[0][0], pending)
  return updated, inserted


def import_delivery_rows(db: Session, data: DeliveryImportRequest) -> DeliveryImportResult:
  """Importa righe da file Excel/ODS. Con update_existing corregge i DDT già presenti."""
  rows = list(data.rows or [])
  if not rows:
    return DeliveryImportResult(ok=True, message='Nessuna riga da importare.')

  suppliers = db.query(Supplier).order_by(Supplier.id.asc()).all()
  by_id = {int(s.id): s for s in suppliers}
  by_name = {_normalize_supplier_key(s.name): s for s in suppliers if s.name}

  existing_ddt = set()
  existing_by = {}
  if data.update_existing:
    for delivery in (
      db.query(Delivery)
      .filter(Delivery.ddt_number.isnot(None))
      .filter(Delivery.ddt_number != '')
      .order_by(Delivery.id.asc())
      .all()
    ):
      if delivery.supplier_id is None or not delivery.ddt_number:
        continue
      key = (int(delivery.supplier_id), str(delivery.ddt_number).strip().lower())
      existing_by.setdefault(key, []).append(delivery)
      existing_ddt.add(key)
  else:
    for sid, ddt in (
      db.query(Delivery.supplier_id, Delivery.ddt_number)
      .filter(Delivery.ddt_number.isnot(None))
      .filter(Delivery.ddt_number != '')
      .all()
    ):
      if sid is None or not ddt:
        continue
      existing_ddt.add((int(sid), str(ddt).strip().lower()))

  groups = {}
  skipped_unknown = 0
  skipped_empty = 0
  skipped_dup = 0

  for row in rows:
    supplier = None
    if row.supplier_id and int(row.supplier_id) in by_id:
      supplier = by_id[int(row.supplier_id)]
    elif row.supplier_name:
      supplier = by_name.get(_normalize_supplier_key(row.supplier_name))
      if supplier is None:
        needle = _normalize_supplier_key(row.supplier_name)
        for key, s in by_name.items():
          if needle and (needle in key or key in needle):
            supplier = s
            break
    if supplier is None:
      skipped_unknown += 1
      continue
    product = (row.product_description or '').strip()
    if not product:
      skipped_empty += 1
      continue
    ddt = _norm_ddt(row.ddt_number)
    sid = int(supplier.id)
    if data.skip_duplicate_ddt and not data.update_existing and ddt and (sid, ddt.lower()) in existing_ddt:
      skipped_dup += 1
      continue
    date_key = '' if data.update_existing else (row.delivery_date.date().isoformat() if row.delivery_date else '')
    gkey = (sid, (ddt or '').lower(), date_key)
    groups.setdefault(gkey, []).append((supplier, row))

  imported_lines = 0
  imported_ddt = 0
  updated_lines = 0
  created_keys = set()

  for (sid, ddt_l, _date_key), bundle in groups.items():
    if not bundle:
      continue
    supplier, first = bundle[0]
    ddt = _norm_ddt(first.ddt_number)
    if data.update_existing and ddt and (sid, ddt.lower()) in existing_by:
      updated, inserted = _update_existing_ddt_lines(db, existing_by[(sid, ddt.lower())], bundle)
      updated_lines += updated
      imported_lines += inserted
      continue
    if data.skip_duplicate_ddt and not data.update_existing and ddt and (sid, ddt.lower()) in existing_ddt:
      skipped_dup += len(bundle)
      continue
    if data.skip_duplicate_ddt and ddt and (sid, ddt.lower()) in created_keys:
      skipped_dup += len(bundle)
      continue

    delivery_date = first.delivery_date or datetime.utcnow()
    dest = (first.destination or '').strip()
    doc_note = (first.document_note or '').strip()
    note = _merge_delivery_note(dest or None, doc_note or None)
    unloading = _norm_signature(first.unloading_signed_by)
    vat_percent = Decimal(str(first.vat_percent or '23.0'))

    items_payload = []
    for _sup, row in bundle:
      items_payload.append({
        'product_description': (row.product_description or '').strip() or None,
        'weight_kg': row.weight_kg,
        'pieces': row.pieces,
        'unit_price': row.unit_price if row.unit_price is not None else Decimal('0'),
        'anomaly_note': (row.anomaly_note or '').strip() or None,
      })

    batch = DeliveryBatchCreate(
      supplier_id=sid,
      delivery_date=delivery_date,
      vat_percent=vat_percent,
      note=note,
      ddt_number=ddt,
      unloading_signed_by=unloading,
      items=items_payload,
    )
    try:
      created = create_delivery_batch(db, batch)
    except HTTPException as exc:
      detail = str(getattr(exc, 'detail', '') or '')
      detail_l = detail.lower()
      if 'ddt' in detail_l and ('presente' in detail_l or 'duplicat' in detail_l):
        skipped_dup += len(bundle)
        continue
      raise
    imported_lines += len(created)
    imported_ddt += 1
    if ddt:
      created_keys.add((sid, ddt.lower()))
      existing_ddt.add((sid, ddt.lower()))

  if data.update_existing:
    bits = [f'Aggiornate {updated_lines} righe già presenti.']
    if imported_lines:
      bits.append(f'Aggiunte {imported_lines} righe nuove ({imported_ddt} DDT).')
    bits.append('Il resto dello storico non è stato cancellato.')
  else:
    bits = [f'Importate {imported_lines} righe ({imported_ddt} DDT).']
  if skipped_dup:
    bits.append(f'Saltati {skipped_dup} duplicati DDT.')
  if skipped_unknown:
    bits.append(f'{skipped_unknown} senza fornitore riconosciuto.')
  if skipped_empty:
    bits.append(f'{skipped_empty} senza prodotto.')

  return DeliveryImportResult(
    ok=True,
    imported_lines=imported_lines,
    imported_ddt=imported_ddt,
    updated_lines=updated_lines,
    skipped_duplicate_ddt=skipped_dup,
    skipped_unknown_supplier=skipped_unknown,
    skipped_empty=skipped_empty,
    message=' '.join(bits),
  )
