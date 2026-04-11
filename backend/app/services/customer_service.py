from typing import List

from sqlalchemy.orm import Session

from ..models.customer import Customer
from ..schemas.customer import CustomerCreate


def list_customers(db: Session) -> List[Customer]:
    return db.query(Customer).order_by(Customer.name.asc()).all()


def create_customer(db: Session, data: CustomerCreate) -> Customer:
    p = data.model_dump()
    c = Customer(
        name=p["name"].strip(),
        vat_number=p.get("vat_number"),
        email=p.get("email"),
        phone=p.get("phone"),
        notes=p.get("notes"),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c
