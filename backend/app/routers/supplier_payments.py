from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.supplier_payments import SupplierPaymentsWorkbookRead, SupplierPaymentsWorkbookUpsert
from ..services import supplier_payments_service

router = APIRouter(prefix="/supplier-payments", tags=["supplier-payments"])


@router.get("/workbook", response_model=SupplierPaymentsWorkbookRead)
@router.get("/workbook/", response_model=SupplierPaymentsWorkbookRead, include_in_schema=False)
def get_supplier_payments_workbook(
    workbook_key: str = Query(default=supplier_payments_service.DEFAULT_WORKBOOK_KEY, max_length=64),
    db: Session = Depends(get_db),
):
  return supplier_payments_service.get_workbook(db, workbook_key)


@router.put("/workbook", response_model=SupplierPaymentsWorkbookRead)
@router.put("/workbook/", response_model=SupplierPaymentsWorkbookRead, include_in_schema=False)
def upsert_supplier_payments_workbook(payload: SupplierPaymentsWorkbookUpsert, db: Session = Depends(get_db)):
  return supplier_payments_service.upsert_workbook(db, payload)
