from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import supplier as supplier_schema
from ..services import supplier_service


router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@router.get("/", response_model=List[supplier_schema.SupplierWithStats])
def list_suppliers(db: Session = Depends(get_db)):
  return supplier_service.list_suppliers_with_stats(db)


@router.get("/{supplier_id}", response_model=supplier_schema.SupplierRead)
def get_supplier(supplier_id: int, db: Session = Depends(get_db)):
  supplier = supplier_service.get_supplier(db, supplier_id)
  if not supplier:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Supplier not found")
  return supplier


@router.post("/", response_model=supplier_schema.SupplierRead, status_code=status.HTTP_201_CREATED)
def create_supplier(payload: supplier_schema.SupplierCreate, db: Session = Depends(get_db)):
  return supplier_service.create_supplier(db, payload)


@router.put("/{supplier_id}", response_model=supplier_schema.SupplierRead)
def update_supplier(supplier_id: int, payload: supplier_schema.SupplierUpdate, db: Session = Depends(get_db)):
  supplier = supplier_service.update_supplier(db, supplier_id, payload)
  if not supplier:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Supplier not found")
  return supplier


@router.delete("/all", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_suppliers(db: Session = Depends(get_db)):
  supplier_service.delete_all_suppliers(db)


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier(supplier_id: int, db: Session = Depends(get_db)):
  deleted = supplier_service.delete_supplier(db, supplier_id)
  if not deleted:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Supplier not found")