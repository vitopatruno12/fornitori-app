from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..models.delivery import Delivery
from ..models.supplier import Supplier
from ..schemas.delivery import (
    DeliveryCreate,
    DeliveryBatchCreate,
    DeliveryPriceAnalytics,
    DeliveryPricePoint,
    DeliveryRead,
    DeliveryReadEnriched,
)
from . import price_list_service
from .vat_service import calculate_vat


def _norm_ddt(value) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


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
            list_unit_price=list_u,
            price_diff_vs_list=diff,
            anomaly_note=anomaly_note,
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
