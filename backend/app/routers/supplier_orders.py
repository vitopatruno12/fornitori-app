from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.supplier_order import SupplierOrderCreate, SupplierOrderRead, SupplierOrderUpdate
from ..services import supplier_order_service
from ..services.order_pdf import build_order_pdf_bytes

router = APIRouter(prefix="/supplier-orders", tags=["supplier-orders"])


@router.post("/", response_model=SupplierOrderRead)
def create_supplier_order(payload: SupplierOrderCreate, db: Session = Depends(get_db)):
    return supplier_order_service.create_order(db, payload)


@router.get("/", response_model=List[SupplierOrderRead])
def list_supplier_orders(
    supplier_id: Optional[int] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    status: Optional[Literal["pending", "sent"]] = Query(default=None),
    limit: int = Query(default=200, le=500),
    db: Session = Depends(get_db),
):
    return supplier_order_service.list_orders(
        db,
        supplier_id=supplier_id,
        date_from=date_from,
        date_to=date_to,
        status=status,
        limit=limit,
    )


@router.get("/{order_id}/pdf")
def download_supplier_order_pdf(order_id: int, db: Session = Depends(get_db)):
    row = supplier_order_service.get_order_read(db, order_id)
    if not row:
        raise HTTPException(status_code=404, detail="Ordine non trovato")
    data = build_order_pdf_bytes(row)
    filename = f"ordine-fornitore-{order_id}.pdf"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{order_id}", response_model=SupplierOrderRead)
def get_supplier_order(order_id: int, db: Session = Depends(get_db)):
    row = supplier_order_service.get_order_read(db, order_id)
    if not row:
        raise HTTPException(status_code=404, detail="Ordine non trovato")
    return row


@router.put("/{order_id}", response_model=SupplierOrderRead)
def update_supplier_order(order_id: int, payload: SupplierOrderUpdate, db: Session = Depends(get_db)):
    return supplier_order_service.update_order(db, order_id, payload)


@router.delete("/{order_id}", status_code=204)
def delete_supplier_order(order_id: int, db: Session = Depends(get_db)):
    supplier_order_service.delete_order(db, order_id)
