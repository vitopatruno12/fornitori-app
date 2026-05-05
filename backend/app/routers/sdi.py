"""
Ricezione PUSH SDI: POST /sdi/receive (equivalente NestJS @Post('receive') sul controller SDI).

Corpo: XML FatturaPA (application/xml o text/xml).
Dedup: SHA-256 del corpo in hex (64 caratteri), colonna dedupe_key.

Opzionale: header X-SDI-Message-Id (identificativo messaggio lato SDI) e SDI_RECEIVE_TOKEN in env
per Authorization: Bearer <token>.
"""
from __future__ import annotations

import hashlib
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..integrations.sdi.storage import save_sdi_xml
from ..integrations.sdi.xml_parser import parse_fatturapa
from ..models.sdi_invoice import SdiInvoice


router = APIRouter(prefix="/sdi", tags=["sdi"])


def _optional_bearer(expected: Optional[str], authorization: Optional[str]) -> None:
    if not expected:
        return
    if not authorization or authorization.strip() != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Token SDI mancante o non valido")


@router.post("/receive")
async def sdi_receive(
    request: Request,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
    x_sdi_message_id: Optional[str] = Header(None, alias="X-SDI-Message-Id"),
) -> Dict[str, Any]:
    _optional_bearer(os.getenv("SDI_RECEIVE_TOKEN", "").strip() or None, authorization)

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Corpo vuoto")

    dedupe_key = hashlib.sha256(body).hexdigest()

    existing = db.query(SdiInvoice).filter(SdiInvoice.dedupe_key == dedupe_key).first()
    if existing:
        return {
            "ok": True,
            "duplicate": True,
            "id": existing.id,
            "dedupe_key": dedupe_key,
            "storage_path": existing.storage_path,
        }

    xml_text = body.decode("utf-8", errors="replace")
    try:
        parsed = parse_fatturapa(xml_text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    storage_path = save_sdi_xml(body, dedupe_key)

    row = SdiInvoice(
        dedupe_key=dedupe_key,
        sdi_message_id=(x_sdi_message_id or "").strip() or None,
        storage_path=storage_path,
        supplier_vat=parsed.get("supplier_vat") or None,
        supplier_name=parsed.get("supplier_name") or None,
        invoice_number=parsed.get("invoice_number") or None,
        invoice_date=parsed.get("invoice_date"),
        receiver_code=parsed.get("receiver_code") or None,
        destination=parsed.get("destination") or None,
        pipeline_status="parsed",
        source="push",
        error_message=None,
    )
    db.add(row)
    try:
        db.commit()
        db.refresh(row)
    except IntegrityError:
        db.rollback()
        existing = db.query(SdiInvoice).filter(SdiInvoice.dedupe_key == dedupe_key).first()
        if existing:
            return {
                "ok": True,
                "duplicate": True,
                "id": existing.id,
                "dedupe_key": dedupe_key,
                "storage_path": existing.storage_path,
            }
        raise

    return {
        "ok": True,
        "duplicate": False,
        "id": row.id,
        "dedupe_key": dedupe_key,
        "storage_path": storage_path,
        "supplier_vat": row.supplier_vat,
        "invoice_number": row.invoice_number,
        "receiver_code": row.receiver_code,
    }
