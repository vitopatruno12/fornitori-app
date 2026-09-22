from typing import Any, Dict

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.supplier_payments import SupplierPaymentsWorkbookRead, SupplierPaymentsWorkbookUpsert
from ..services import pagamenti_watch_agent, supplier_payments_service

router = APIRouter(prefix="/supplier-payments", tags=["supplier-payments"])


@router.get("/workbooks")
def list_supplier_payments_workbooks(db: Session = Depends(get_db)) -> Dict[str, Any]:
  """Catalogo file fornitori per società (menu a tendina)."""
  items = supplier_payments_service.list_workbook_catalog(db)
  return {"items": items, "count": len(items)}


@router.post("/migrate-risacca-to-mediazione")
def migrate_risacca_to_mediazione(db: Session = Depends(get_db)) -> Dict[str, Any]:
  """Sposta forzatamente il file storico da Risacca a Mediazione."""
  moved = supplier_payments_service.migrate_legacy_risacca_workbook_to_mediazione(db)
  med = supplier_payments_service.get_workbook(db, "mediazione_2026")
  ris = supplier_payments_service.get_workbook(db, "risacca_2026")
  return {
    "ok": True,
    "migrated": moved,
    "mediazione_title": med.title,
    "mediazione_key": med.workbook_key,
    "risacca_title": ris.title,
    "message": (
      "Dati spostati sotto File fornitori Mediazione."
      if moved
      else "Nessuno spostamento necessario (già sotto Mediazione o Risacca vuota)."
    ),
  }


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


@router.delete("/workbook")
@router.delete("/workbook/", include_in_schema=False)
@router.post("/workbook/delete")
def delete_supplier_payments_workbook(
    workbook_key: str = Query(default=supplier_payments_service.DEFAULT_WORKBOOK_KEY, max_length=64),
    reseed: bool = Query(default=True, description="Reinizializza dal template dopo l'eliminazione"),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
  """Elimina il file Excel/registro pagamenti salvato (opzionalmente lo ricrea vuoto dal template)."""
  return supplier_payments_service.delete_workbook(db, workbook_key, reseed=reseed)


@router.get("/watch-agent")
def get_pagamenti_watch_agent() -> Dict[str, Any]:
  """Ultimo controllo periodico file Pagamenti + movimenti banca."""
  return pagamenti_watch_agent.read_status()


@router.post("/watch-agent/run")
def run_pagamenti_watch_agent(
  force: bool = Query(default=False, description="Aggiorna anche senza variazioni"),
  db: Session = Depends(get_db),
) -> Dict[str, Any]:
  """Esegue ora il controllo (stesso lavoro del timer mar/ven)."""
  return pagamenti_watch_agent.run_watch(db, force=force)
