from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import staff as staff_schema
from ..services import staff_service

router = APIRouter(prefix="/staff", tags=["staff"])


@router.get("/members", response_model=List[staff_schema.StaffMemberRead])
def list_members(db: Session = Depends(get_db)):
    return staff_service.list_members(db)


@router.get("/members/{member_id}", response_model=staff_schema.StaffMemberRead)
def get_member(member_id: int, db: Session = Depends(get_db)):
    row = staff_service.get_member(db, member_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipendente non trovato")
    return row


@router.post("/members", response_model=staff_schema.StaffMemberRead, status_code=status.HTTP_201_CREATED)
def create_member(payload: staff_schema.StaffMemberCreate, db: Session = Depends(get_db)):
    return staff_service.create_member(db, payload)


@router.delete("/members/bulk", response_model=staff_schema.StaffMembersBulkDeleteResult)
def delete_all_members_bulk(
    name: Optional[str] = Query(None, min_length=1, max_length=255),
    code: Optional[str] = Query(None, min_length=6, max_length=6),
    db: Session = Depends(get_db),
):
    """Elimina l’intero elenco dipendenti e tutta la pianificazione associata (CASCADE)."""
    try:
        n = staff_service.delete_all_members(db, locale_name=name, access_code=code)
    except ValueError as e:
        msg = str(e)
        if "Codice" in msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    return staff_schema.StaffMembersBulkDeleteResult(deleted=n)


@router.put("/members/{member_id}", response_model=staff_schema.StaffMemberRead)
def update_member(member_id: int, payload: staff_schema.StaffMemberUpdate, db: Session = Depends(get_db)):
    row = staff_service.update_member(db, member_id, payload)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipendente non trovato")
    return row


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_member(
    member_id: int,
    name: Optional[str] = Query(None, min_length=1, max_length=255),
    code: Optional[str] = Query(None, min_length=6, max_length=6),
    db: Session = Depends(get_db),
):
    try:
        ok = staff_service.delete_member(db, member_id, locale_name=name, access_code=code)
    except ValueError as e:
        msg = str(e)
        if "Codice" in msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipendente non trovato")


@router.get("/shifts", response_model=List[staff_schema.StaffShiftRead])
def list_shifts(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    db: Session = Depends(get_db),
):
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="Intervallo date non valido")
    return staff_service.list_shifts_range(db, date_from, date_to)


@router.post("/shifts", response_model=staff_schema.StaffShiftRead, status_code=status.HTTP_201_CREATED)
def create_shift(payload: staff_schema.StaffShiftCreate, db: Session = Depends(get_db)):
    try:
        row = staff_service.create_shift(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return staff_service.shift_to_read(db, row)


@router.delete("/shifts/bulk", response_model=staff_schema.StaffShiftsBulkDeleteResult)
def delete_shifts_bulk(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    db: Session = Depends(get_db),
):
    """Elimina tutte le voci nel periodo (es. intera settimana visibile in Personale)."""
    try:
        n = staff_service.delete_shifts_between(db, date_from, date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return staff_schema.StaffShiftsBulkDeleteResult(deleted=n)


@router.put("/shifts/{shift_id}", response_model=staff_schema.StaffShiftRead)
def update_shift(shift_id: int, payload: staff_schema.StaffShiftUpdate, db: Session = Depends(get_db)):
    try:
        row = staff_service.update_shift(db, shift_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voce non trovata")
    return staff_service.shift_to_read(db, row)


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shift(shift_id: int, db: Session = Depends(get_db)):
    ok = staff_service.delete_shift(db, shift_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voce non trovata")


@router.get("/payroll-months", response_model=List[staff_schema.StaffPayrollMonthRead])
def list_payroll_months(db: Session = Depends(get_db)):
    return staff_service.list_payroll_months(db)


@router.get("/payroll-months/{month_id}", response_model=staff_schema.StaffPayrollMonthRead)
def get_payroll_month(month_id: int, db: Session = Depends(get_db)):
    row = staff_service.get_payroll_month(db, month_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mese non trovato")
    return row


@router.post(
    "/payroll-months",
    response_model=staff_schema.StaffPayrollMonthRead,
    status_code=status.HTTP_201_CREATED,
)
def create_payroll_month(payload: staff_schema.StaffPayrollMonthCreate, db: Session = Depends(get_db)):
    try:
        return staff_service.create_payroll_month(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/payroll-months/{month_id}", response_model=staff_schema.StaffPayrollMonthRead)
def update_payroll_month(
    month_id: int,
    payload: staff_schema.StaffPayrollMonthUpdate,
    db: Session = Depends(get_db),
):
    try:
        row = staff_service.update_payroll_month(db, month_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mese non trovato")
    return row


@router.delete("/payroll-months/{month_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_payroll_month(month_id: int, db: Session = Depends(get_db)):
    ok = staff_service.delete_payroll_month(db, month_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mese non trovato")


@router.get("/stipendi-months", response_model=List[staff_schema.StaffStipendiMonthRead])
def list_stipendi_months(db: Session = Depends(get_db)):
    return staff_service.list_stipendi_months(db)


@router.get("/stipendi-months/{month_id}", response_model=staff_schema.StaffStipendiMonthRead)
def get_stipendi_month(month_id: int, db: Session = Depends(get_db)):
    row = staff_service.get_stipendi_month(db, month_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mese stipendi non trovato")
    return row


@router.post(
    "/stipendi-months",
    response_model=staff_schema.StaffStipendiMonthRead,
    status_code=status.HTTP_201_CREATED,
)
def create_stipendi_month(payload: staff_schema.StaffStipendiMonthCreate, db: Session = Depends(get_db)):
    try:
        return staff_service.create_stipendi_month(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/stipendi-months/{month_id}", response_model=staff_schema.StaffStipendiMonthRead)
def update_stipendi_month(
    month_id: int,
    payload: staff_schema.StaffStipendiMonthUpdate,
    db: Session = Depends(get_db),
):
    try:
        row = staff_service.update_stipendi_month(db, month_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mese stipendi non trovato")
    return row


@router.delete("/stipendi-months/{month_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stipendi_month(month_id: int, db: Session = Depends(get_db)):
    ok = staff_service.delete_stipendi_month(db, month_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mese stipendi non trovato")


@router.get("/locale-packs", response_model=List[staff_schema.StaffLocalePackSummary])
def list_locale_packs(db: Session = Depends(get_db)):
    return staff_service.list_locale_packs(db)


@router.get("/locale-packs/detail", response_model=staff_schema.StaffLocalePackRead)
def get_locale_pack(
    name: str = Query(..., min_length=1, max_length=255),
    code: Optional[str] = Query(None, min_length=6, max_length=6),
    db: Session = Depends(get_db),
):
    try:
        row = staff_service.get_locale_pack(db, name, access_code=code)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Locale non trovato")
    return row


@router.put("/locale-packs", response_model=staff_schema.StaffLocalePackRead)
def upsert_locale_pack(payload: staff_schema.StaffLocalePackUpsert, db: Session = Depends(get_db)):
    try:
        return staff_service.upsert_locale_pack(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/access-codes/otp/request", response_model=staff_schema.AccessCodeOtpRequestOut)
def request_access_code_otp(payload: staff_schema.AccessCodeOtpRequestIn, db: Session = Depends(get_db)):
    try:
        return staff_service.request_access_code_otp(db, payload.query, phone=payload.phone)
    except ValueError as e:
        msg = str(e)
        if "Attendi" in msg:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=msg)
        if "non trovato" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@router.post("/access-codes/lookup", response_model=staff_schema.AccessCodeLookupOut)
def lookup_access_codes(payload: staff_schema.AccessCodeLookupIn, db: Session = Depends(get_db)):
    try:
        return staff_service.lookup_access_codes(
            db,
            payload.query,
            otp=payload.otp,
            unlock_password=payload.unlock_password,
        )
    except ValueError as e:
        msg = str(e)
        if "OTP" in msg or "otp" in msg or "Password" in msg or "password" in msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=msg)
        if "non trovato" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@router.delete("/locale-packs", status_code=status.HTTP_204_NO_CONTENT)
def delete_locale_pack(
    name: str = Query(..., min_length=1, max_length=255),
    code: Optional[str] = Query(None, min_length=6, max_length=6),
    db: Session = Depends(get_db),
):
    try:
        ok = staff_service.delete_locale_pack(db, name, access_code=code)
    except ValueError as e:
        msg = str(e)
        if "Codice" in msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Locale non trovato")
    return None


@router.get("/backups", response_model=List[staff_schema.StaffBackupSummary])
def list_backups(section: str = Query(..., min_length=1, max_length=32), db: Session = Depends(get_db)):
    try:
        return staff_service.list_backups(db, section)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/backups/detail", response_model=staff_schema.StaffBackupRead)
def get_backup(
    section: str = Query(..., min_length=1, max_length=32),
    key: str = Query(..., min_length=1, max_length=255),
    db: Session = Depends(get_db),
):
    row = staff_service.get_backup(db, section, key)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup non trovato")
    return row


@router.put("/backups", response_model=staff_schema.StaffBackupRead)
def upsert_backup(payload: staff_schema.StaffBackupUpsert, db: Session = Depends(get_db)):
    try:
        return staff_service.upsert_backup(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
