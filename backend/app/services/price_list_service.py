from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models.supplier_price_list import SupplierPriceList
from ..schemas.price_list import PriceListItemCreate


def get_unit_price_for_product(
    db: Session, supplier_id: int, product_description: Optional[str]
) -> Optional[Decimal]:
    """Prezzo listino per descrizione merce (match esatto dopo strip)."""
    if not product_description or not str(product_description).strip():
        return None
    desc = str(product_description).strip()
    row = (
        db.query(SupplierPriceList)
        .filter(
            SupplierPriceList.supplier_id == supplier_id,
            SupplierPriceList.product_description == desc,
        )
        .first()
    )
    return row.unit_price if row else None


def list_by_supplier(db: Session, supplier_id: int) -> List[SupplierPriceList]:
    return (
        db.query(SupplierPriceList)
        .filter(SupplierPriceList.supplier_id == supplier_id)
        .order_by(SupplierPriceList.product_description.asc())
        .all()
    )


def create_or_update(db: Session, data: PriceListItemCreate) -> SupplierPriceList:
    existing = (
        db.query(SupplierPriceList)
        .filter(
            SupplierPriceList.supplier_id == data.supplier_id,
            SupplierPriceList.product_description == data.product_description.strip(),
        )
        .first()
    )
    if existing:
        existing.unit_price = data.unit_price
        db.commit()
        db.refresh(existing)
        return existing

    item = SupplierPriceList(
        supplier_id=data.supplier_id,
        product_description=data.product_description.strip(),
        unit_price=data.unit_price,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def create_or_update_many(db: Session, supplier_id: int, items: List[dict]) -> List[SupplierPriceList]:
    saved: List[SupplierPriceList] = []
    for row in items:
        description = (row.get("product_description") or "").strip()
        unit_price = row.get("unit_price")
        if not description or unit_price is None:
            continue

        existing = (
            db.query(SupplierPriceList)
            .filter(
                SupplierPriceList.supplier_id == supplier_id,
                SupplierPriceList.product_description == description,
            )
            .first()
        )
        if existing:
            existing.unit_price = unit_price
            saved.append(existing)
        else:
            item = SupplierPriceList(
                supplier_id=supplier_id,
                product_description=description,
                unit_price=unit_price,
            )
            db.add(item)
            saved.append(item)

    db.commit()
    for item in saved:
        db.refresh(item)
    return saved


def delete_item(db: Session, item_id: int) -> bool:
    item = db.query(SupplierPriceList).filter(SupplierPriceList.id == item_id).first()
    if not item:
        return False
    db.delete(item)
    db.commit()
    return True
