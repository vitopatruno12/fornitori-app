from datetime import date
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models.carrier import (
    Carrier,
    CarrierFuelExpense,
    CarrierMaintenanceLog,
    CarrierOtherExpense,
)
from ..schemas import carriers as sch


def list_carriers(db: Session, active_only: bool = False) -> List[Carrier]:
    q = db.query(Carrier)
    if active_only:
        q = q.filter(Carrier.is_active.is_(True), Carrier.out_of_service.is_(False))
    return q.order_by(Carrier.sort_order.asc(), Carrier.name.asc(), Carrier.id.asc()).all()


def get_carrier(db: Session, carrier_id: int) -> Optional[Carrier]:
    return db.query(Carrier).filter(Carrier.id == carrier_id).first()


def _clear_in_service(db: Session, except_id: Optional[int] = None) -> None:
    q = db.query(Carrier).filter(Carrier.in_service.is_(True))
    if except_id is not None:
        q = q.filter(Carrier.id != except_id)
    for row in q.all():
        row.in_service = False


def create_carrier(db: Session, payload: sch.CarrierCreate) -> Carrier:
    data = payload.model_dump()
    if data.get("out_of_service"):
        data["is_active"] = False
        data["in_service"] = False
    if data.get("in_service"):
        _clear_in_service(db)
    row = Carrier(**data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_carrier(db: Session, carrier_id: int, payload: sch.CarrierUpdate) -> Optional[Carrier]:
    row = get_carrier(db, carrier_id)
    if not row:
        return None
    data = payload.model_dump(exclude_unset=True)
    if data.get("out_of_service") is True:
        data["is_active"] = False
        data["in_service"] = False
    if data.get("is_active") is False:
        data["in_service"] = False
    if data.get("in_service") is True:
        _clear_in_service(db, except_id=carrier_id)
    for key, value in data.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


def delete_carrier(db: Session, carrier_id: int) -> bool:
    row = get_carrier(db, carrier_id)
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def set_in_service(db: Session, carrier_id: int, value: bool = True) -> Optional[Carrier]:
    row = get_carrier(db, carrier_id)
    if not row:
        return None
    if value:
        if not row.is_active or row.out_of_service:
            raise ValueError("Trasportatore non operativo")
        # Allinea a Date#getDay JS: 0=Domenica … 6=Sabato
        js_today = (date.today().weekday() + 1) % 7
        if row.rest_day is not None and row.rest_day == js_today:
            raise ValueError("Trasportatore in giorno di riposo")
        _clear_in_service(db, except_id=carrier_id)
        row.in_service = True
    else:
        row.in_service = False
    db.commit()
    db.refresh(row)
    return row


def list_maintenance(db: Session, carrier_id: int) -> List[CarrierMaintenanceLog]:
    return (
        db.query(CarrierMaintenanceLog)
        .filter(CarrierMaintenanceLog.carrier_id == carrier_id)
        .order_by(CarrierMaintenanceLog.service_date.desc(), CarrierMaintenanceLog.id.desc())
        .all()
    )


def create_maintenance(
    db: Session, carrier_id: int, payload: sch.CarrierMaintenanceCreate
) -> CarrierMaintenanceLog:
    if not get_carrier(db, carrier_id):
        raise ValueError("Trasportatore non trovato")
    row = CarrierMaintenanceLog(carrier_id=carrier_id, **payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_maintenance(
    db: Session, log_id: int, payload: sch.CarrierMaintenanceUpdate
) -> Optional[CarrierMaintenanceLog]:
    row = db.query(CarrierMaintenanceLog).filter(CarrierMaintenanceLog.id == log_id).first()
    if not row:
        return None
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


def delete_maintenance(db: Session, log_id: int) -> bool:
    row = db.query(CarrierMaintenanceLog).filter(CarrierMaintenanceLog.id == log_id).first()
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def list_fuel(db: Session, carrier_id: int) -> List[CarrierFuelExpense]:
    return (
        db.query(CarrierFuelExpense)
        .filter(CarrierFuelExpense.carrier_id == carrier_id)
        .order_by(CarrierFuelExpense.expense_date.desc(), CarrierFuelExpense.id.desc())
        .all()
    )


def create_fuel(db: Session, carrier_id: int, payload: sch.CarrierFuelCreate) -> CarrierFuelExpense:
    if not get_carrier(db, carrier_id):
        raise ValueError("Trasportatore non trovato")
    row = CarrierFuelExpense(carrier_id=carrier_id, **payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_fuel(db: Session, expense_id: int, payload: sch.CarrierFuelUpdate) -> Optional[CarrierFuelExpense]:
    row = db.query(CarrierFuelExpense).filter(CarrierFuelExpense.id == expense_id).first()
    if not row:
        return None
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


def delete_fuel(db: Session, expense_id: int) -> bool:
    row = db.query(CarrierFuelExpense).filter(CarrierFuelExpense.id == expense_id).first()
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def list_other_expenses(db: Session, carrier_id: int) -> List[CarrierOtherExpense]:
    return (
        db.query(CarrierOtherExpense)
        .filter(CarrierOtherExpense.carrier_id == carrier_id)
        .order_by(CarrierOtherExpense.expense_date.desc(), CarrierOtherExpense.id.desc())
        .all()
    )


def create_other_expense(
    db: Session, carrier_id: int, payload: sch.CarrierOtherExpenseCreate
) -> CarrierOtherExpense:
    if not get_carrier(db, carrier_id):
        raise ValueError("Trasportatore non trovato")
    row = CarrierOtherExpense(carrier_id=carrier_id, **payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_other_expense(
    db: Session, expense_id: int, payload: sch.CarrierOtherExpenseUpdate
) -> Optional[CarrierOtherExpense]:
    row = db.query(CarrierOtherExpense).filter(CarrierOtherExpense.id == expense_id).first()
    if not row:
        return None
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


def delete_other_expense(db: Session, expense_id: int) -> bool:
    row = db.query(CarrierOtherExpense).filter(CarrierOtherExpense.id == expense_id).first()
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
