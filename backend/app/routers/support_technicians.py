from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.support_technician import SupportTechnician
from ..schemas import support_technicians as sch
from ..services import support_technician_service as svc

router = APIRouter(prefix="/support-technicians", tags=["support-technicians"])


def _activity_read(db: Session, row) -> sch.TechnicianActivityRead:
    tech = db.query(SupportTechnician).filter(SupportTechnician.id == row.technician_id).first()
    return sch.TechnicianActivityRead(
        id=row.id,
        technician_id=row.technician_id,
        technician_name=tech.full_name if tech else None,
        activity_date=row.activity_date,
        time_start=row.time_start,
        time_end=row.time_end,
        location=row.location,
        notes=row.notes,
        kind=row.kind,
    )


@router.get("", response_model=List[sch.SupportTechnicianRead])
def list_technicians(db: Session = Depends(get_db)):
    return svc.list_technicians(db)


@router.post("", response_model=sch.SupportTechnicianRead, status_code=status.HTTP_201_CREATED)
def create_technician(payload: sch.SupportTechnicianCreate, db: Session = Depends(get_db)):
    return svc.create_technician(db, payload)


@router.post("/seed-defaults", response_model=sch.SeedDefaultsResult)
def seed_defaults(db: Session = Depends(get_db)):
    """Inserisce i tecnici predefiniti solo se la tabella è vuota."""
    inserted = svc.seed_defaults(db)
    return sch.SeedDefaultsResult(inserted=inserted)


@router.delete("/bulk", response_model=sch.SupportTechniciansBulkDeleteResult)
def delete_all_technicians(db: Session = Depends(get_db)):
    """Elimina l’intero elenco tecnici e tutte le attività collegate (CASCADE)."""
    n = svc.delete_all_technicians(db)
    return sch.SupportTechniciansBulkDeleteResult(deleted=n)


@router.get("/activities", response_model=List[sch.TechnicianActivityRead])
def list_activities(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    technician_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="Intervallo date non valido")
    return svc.list_activities(db, date_from, date_to, technician_id)


@router.post("/activities", response_model=sch.TechnicianActivityRead, status_code=status.HTTP_201_CREATED)
def create_activity(payload: sch.TechnicianActivityCreate, db: Session = Depends(get_db)):
    try:
        row = svc.create_activity(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _activity_read(db, row)


@router.put("/activities/{activity_id}", response_model=sch.TechnicianActivityRead)
def update_activity(activity_id: int, payload: sch.TechnicianActivityUpdate, db: Session = Depends(get_db)):
    try:
        row = svc.update_activity(db, activity_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not row:
        raise HTTPException(status_code=404, detail="Attività non trovata")
    return _activity_read(db, row)


@router.delete("/activities/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_activity(activity_id: int, db: Session = Depends(get_db)):
    if not svc.delete_activity(db, activity_id):
        raise HTTPException(status_code=404, detail="Attività non trovata")


@router.put("/{technician_id}", response_model=sch.SupportTechnicianRead)
def update_technician(technician_id: int, payload: sch.SupportTechnicianUpdate, db: Session = Depends(get_db)):
    row = svc.update_technician(db, technician_id, payload)
    if not row:
        raise HTTPException(status_code=404, detail="Tecnico non trovato")
    return row


@router.delete("/{technician_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_technician(technician_id: int, db: Session = Depends(get_db)):
    if not svc.delete_technician(db, technician_id):
        raise HTTPException(status_code=404, detail="Tecnico non trovato")
