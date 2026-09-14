from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import conservation_service


router = APIRouter(prefix="/conservazione", tags=["conservazione"])


class CreatePackageBody(BaseModel):
  company: str
  label: Optional[str] = None
  period_from: Optional[str] = None
  period_to: Optional[str] = None
  document_keys: Optional[List[str]] = None
  note: Optional[str] = None


class StatusBody(BaseModel):
  status: str = Field(..., description="bozza|pronto|esportato|inviato_conservatore|conservato|errore")
  note: Optional[str] = None


@router.get("/candidates")
def conservation_candidates(
  company: str = Query(...),
  period_from: Optional[str] = Query(None),
  period_to: Optional[str] = Query(None),
  include_issued: bool = Query(True),
  db: Session = Depends(get_db),
):
  return conservation_service.list_candidates(
    db,
    company=company,
    period_from=period_from,
    period_to=period_to,
    include_issued=include_issued,
  )


@router.get("/packages")
def conservation_packages(
  company: Optional[str] = Query(None),
  limit: int = Query(100, ge=1, le=300),
  db: Session = Depends(get_db),
):
  return {"items": conservation_service.list_packages(db, company=company, limit=limit)}


@router.post("/packages")
def create_conservation_package(body: CreatePackageBody, db: Session = Depends(get_db)):
  return conservation_service.create_package(
    db,
    company=body.company,
    label=body.label,
    period_from=body.period_from,
    period_to=body.period_to,
    document_keys=body.document_keys,
    note=body.note,
  )


@router.get("/packages/{package_id}")
def get_conservation_package(package_id: int, db: Session = Depends(get_db)):
  return conservation_service.get_package(db, package_id)


@router.post("/packages/{package_id}/build")
def build_conservation_package(package_id: int, db: Session = Depends(get_db)):
  return conservation_service.build_package(db, package_id)


@router.get("/packages/{package_id}/download")
def download_conservation_package(package_id: int, db: Session = Depends(get_db)):
  path, pkg = conservation_service.resolve_package_zip(db, package_id)
  return FileResponse(
    path,
    media_type="application/zip",
    filename=path.name or f"pacchetto_conservazione_{pkg.id}.zip",
  )


@router.post("/packages/{package_id}/status")
def set_conservation_status(package_id: int, body: StatusBody, db: Session = Depends(get_db)):
  return conservation_service.set_package_status(db, package_id, status=body.status, note=body.note)


@router.delete("/packages/{package_id}", status_code=204)
def delete_conservation_package(package_id: int, db: Session = Depends(get_db)):
  ok = conservation_service.delete_package(db, package_id)
  if not ok:
    raise HTTPException(status_code=404, detail="Pacchetto non trovato")
