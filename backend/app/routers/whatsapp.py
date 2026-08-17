from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.whatsapp_cloud import (
    friendly_whatsapp_error,
    meta_configured,
    normalize_wa_phone,
    send_whatsapp_text,
)

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


class WhatsAppSendIn(BaseModel):
    phone: str = Field(..., min_length=6)
    message: str = Field(..., min_length=1)
    name: Optional[str] = None


class WhatsAppSendOut(BaseModel):
    ok: bool
    mode: str
    phone: str
    name: Optional[str] = None


class WhatsAppSendManyIn(BaseModel):
    messages: List[WhatsAppSendIn]


class WhatsAppSendManyItem(WhatsAppSendOut):
    error: Optional[str] = None


class WhatsAppSendManyOut(BaseModel):
    ok: bool
    sent: int
    failed: int
    results: List[WhatsAppSendManyItem]


@router.get("/status")
def whatsapp_status():
    return {"configured": meta_configured()}


@router.post("/send", response_model=WhatsAppSendOut)
def send_whatsapp(payload: WhatsAppSendIn):
    if not meta_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "WhatsApp automatico non configurato sul server "
                "(WHATSAPP_CLOUD_TOKEN e WHATSAPP_PHONE_NUMBER_ID)."
            ),
        )
    try:
        mode = send_whatsapp_text(payload.phone, payload.message)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=friendly_whatsapp_error(exc)) from exc
    return WhatsAppSendOut(
        ok=True,
        mode=mode,
        phone=normalize_wa_phone(payload.phone),
        name=(payload.name or "").strip() or None,
    )


@router.post("/send-many", response_model=WhatsAppSendManyOut)
def send_whatsapp_many(payload: WhatsAppSendManyIn):
    if not meta_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "WhatsApp automatico non configurato sul server "
                "(WHATSAPP_CLOUD_TOKEN e WHATSAPP_PHONE_NUMBER_ID)."
            ),
        )
    results: List[WhatsAppSendManyItem] = []
    sent = 0
    failed = 0
    for item in payload.messages:
        name = (item.name or "").strip() or None
        try:
            mode = send_whatsapp_text(item.phone, item.message)
            sent += 1
            results.append(
                WhatsAppSendManyItem(
                    ok=True,
                    mode=mode,
                    phone=normalize_wa_phone(item.phone),
                    name=name,
                )
            )
        except RuntimeError as exc:
            failed += 1
            results.append(
                WhatsAppSendManyItem(
                    ok=False,
                    mode="error",
                    phone=normalize_wa_phone(item.phone) or item.phone,
                    name=name,
                    error=friendly_whatsapp_error(exc),
                )
            )
    return WhatsAppSendManyOut(ok=failed == 0 and sent > 0, sent=sent, failed=failed, results=results)
