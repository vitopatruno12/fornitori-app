from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.customer import CustomerCreate, CustomerRead
from ..services import customer_service

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("/", response_model=List[CustomerRead])
def list_customers(db: Session = Depends(get_db)):
    return customer_service.list_customers(db)


@router.post("/", response_model=CustomerRead)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db)):
    return customer_service.create_customer(db, payload)
