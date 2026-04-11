from typing import List

from sqlalchemy.orm import Session

from ..models.account import Account
from ..models.category import Category
from ..models.payment_method import PaymentMethod


def list_accounts(db: Session) -> List[Account]:
    return (
        db.query(Account)
        .filter(Account.is_active.is_(True))
        .order_by(Account.sort_order.asc(), Account.name.asc())
        .all()
    )


def list_payment_methods(db: Session) -> List[PaymentMethod]:
    return db.query(PaymentMethod).order_by(PaymentMethod.sort_order.asc(), PaymentMethod.name.asc()).all()


def list_categories(db: Session) -> List[Category]:
    return db.query(Category).order_by(Category.name.asc()).all()
