from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.delivery import (
    DeliveryCreate,
    DeliveryBatchCreate,
    DeliveryRead,
    DeliveryReadEnriched,
    DeliveryPriceAnalytics,
)
from ..services import delivery_service


router = APIRouter(prefix="/deliveries", tags=["deliveries"])


@router.get("/price-analytics", response_model=DeliveryPriceAnalytics)
def get_price_analytics(
    supplier_id: int = Query(..., description="Fornitore"),
    product_description: str = Query(..., min_length=1, description="Tipo merce (come registrato in consegna)"),
    db: Session = Depends(get_db),
):
    return delivery_service.price_analytics(db, supplier_id=supplier_id, product_description=product_description)


@router.get("/", response_model=List[DeliveryReadEnriched])
def list_deliveries(
    supplier_id: Optional[int] = Query(default=None),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    product_query: Optional[str] = Query(default=None, description="Cerca in merce, note, anomalie"),
    db: Session = Depends(get_db),
):
    return delivery_service.list_deliveries(
        db,
        supplier_id=supplier_id,
        date_from=date_from,
        date_to=date_to,
        product_query=product_query,
    )


@router.post("/", response_model=DeliveryRead)
def create_delivery(payload: DeliveryCreate, db: Session = Depends(get_db)):
    return delivery_service.create_delivery(db, payload)


@router.post("/batch", response_model=List[DeliveryRead])
def create_delivery_batch(payload: DeliveryBatchCreate, db: Session = Depends(get_db)):
    return delivery_service.create_delivery_batch(db, payload)


@router.delete("/all", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_deliveries(db: Session = Depends(get_db)):
    delivery_service.delete_all_deliveries(db)
