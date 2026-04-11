from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.dashboard import DashboardSummary
from ..services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(db: Session = Depends(get_db)):
    return dashboard_service.get_summary(db)
