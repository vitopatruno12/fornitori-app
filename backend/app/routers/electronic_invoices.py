from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.electronic_invoice_import import (
    ElectronicInvoiceImportService,
)


router = APIRouter(
    prefix="/electronic-invoices",
    tags=["Electronic Invoices"],
)


@router.post("/import-xml")
async def import_xml(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="Nome file mancante",
        )

    if not file.filename.lower().endswith(".xml"):
        raise HTTPException(
            status_code=400,
            detail="È richiesto un file XML",
        )

    content = await file.read()

    try:
        xml_content = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="XML non codificato in UTF-8",
        )

    try:
        service = ElectronicInvoiceImportService(db)

        return service.import_xml(
            xml_content=xml_content,
            filename=file.filename,
        )

    except ValueError as exc:
        db.rollback()

        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    except Exception:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="Errore durante importazione fattura",
        )


@router.post("/{incoming_invoice_id}/register")
def register_in_atlas(
    incoming_invoice_id: int,
    db: Session = Depends(get_db),
):
    try:
        service = ElectronicInvoiceImportService(db)

        result = service.create_atlas_invoice_from_incoming(
            incoming_invoice_id
        )

        db.commit()

        return result

    except ValueError as exc:
        db.rollback()

        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    except Exception:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="Errore durante la registrazione della fattura",
        )
