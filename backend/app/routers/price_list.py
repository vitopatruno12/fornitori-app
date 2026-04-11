from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.price_list import PriceListBatchCreate, PriceListItemCreate, PriceListItemRead
from ..services import price_list_service

router = APIRouter(prefix="/price-list", tags=["price-list"])


@router.get("/", response_model=List[PriceListItemRead])
def list_by_supplier(
    supplier_id: int = Query(..., description="ID fornitore"),
    db: Session = Depends(get_db),
):
    return price_list_service.list_by_supplier(db, supplier_id)


@router.post("/", response_model=PriceListItemRead)
def add_or_update(payload: PriceListItemCreate, db: Session = Depends(get_db)):
    if not payload.product_description or not payload.product_description.strip():
        raise HTTPException(status_code=400, detail="Inserisci il tipo di merce")
    return price_list_service.create_or_update(db, payload)


@router.post("/batch", response_model=List[PriceListItemRead])
def add_or_update_batch(payload: PriceListBatchCreate, db: Session = Depends(get_db)):
    rows = []
    for item in payload.items:
        if item.product_description and item.product_description.strip() and item.unit_price > 0:
            rows.append(
                {
                    "product_description": item.product_description.strip(),
                    "unit_price": item.unit_price,
                }
            )
    if not rows:
        raise HTTPException(status_code=400, detail="Inserisci almeno una merce con prezzo valido")
    return price_list_service.create_or_update_many(db, payload.supplier_id, rows)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: int, db: Session = Depends(get_db)):
    deleted = price_list_service.delete_item(db, item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Voce non trovata")
