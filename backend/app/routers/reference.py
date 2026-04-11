from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.reference import AccountRead, CategoryRead, PaymentMethodRead
from ..services import reference_service

router = APIRouter(prefix="/reference", tags=["reference"])


@router.get("/accounts", response_model=List[AccountRead])
def list_accounts(db: Session = Depends(get_db)):
    return reference_service.list_accounts(db)


@router.get("/payment-methods", response_model=List[PaymentMethodRead])
def list_payment_methods(db: Session = Depends(get_db)):
    return reference_service.list_payment_methods(db)


@router.get("/categories", response_model=List[CategoryRead])
def list_categories(db: Session = Depends(get_db)):
    return reference_service.list_categories(db)
