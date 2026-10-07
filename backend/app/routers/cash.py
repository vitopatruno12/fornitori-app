import io
from datetime import datetime, date
from typing import List, Optional
import logging

from fastapi import APIRouter, Depends, Query, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.cash import (
    CashEntryCreate,
    CashEntryRead,
    CashEntryWithBalance,
    DailySummary,
    PeriodSummary,
    PaperClosingUpsert,
    PrimaNotaLinkOptions,
    PrimaNotaLocalePackRead,
    PrimaNotaLocalePackSummary,
    PrimaNotaLocalePackUpsert,
)
from ..constants.prima_nota_staff_locale import (
    _locale_name_key,
    match_staff_locale_name,
    staff_locale_link_for_activity,
)
from ..services import cash_closing_sync, cash_service, paper_closing_overrides, prima_nota_locale_service, staff_service

router = APIRouter(prefix="/cash", tags=["cash"])
logger = logging.getLogger(__name__)


def _maybe_sync_daily_closings(
    db: Session,
    activity: Optional[str],
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> None:
    try:
        cash_closing_sync.sync_daily_closings_to_prima_nota(
            db,
            activity=None,
            date_from=date_from,
            date_to=date_to,
        )
    except Exception:
        logger.warning("Sync chiusure fiscali Prima Nota fallita", extra={"activity": activity}, exc_info=True)


def _validate_activity(activity: Optional[str]) -> Optional[str]:
    if activity is None:
        return None
    try:
        return cash_service.validate_activity_param(activity)
    except ValueError:
        raise HTTPException(status_code=400, detail="Attività non valida")


def _verify_activity_access(
    db: Session,
    activity: Optional[str],
    access_code: Optional[str] = None,
) -> None:
    try:
        _verify_prima_nota_activity_access(db, activity, access_code)
    except ValueError as exc:
        detail = str(exc) or "Codice locale non valido."
        raise HTTPException(status_code=403, detail=detail)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="Verifica codice locale non disponibile. Riprova tra qualche istante.",
        )


def _verify_prima_nota_activity_access(
    db: Session,
    activity: Optional[str],
    access_code: Optional[str] = None,
) -> None:
    """Verifica codice: prima Personale (locale collegato), poi pack Prima Nota custom."""
    act = str(activity or "").strip().lower()
    if not act:
        return
    preferred_staff = staff_locale_link_for_activity(act)
    if preferred_staff:
        summaries = staff_service.list_locale_packs(db)
        names = [row.locale_name for row in summaries]
        staff_name = match_staff_locale_name(preferred_staff, names, act)
        hit = None
        for row in summaries:
            if _locale_name_key(row.locale_name) == _locale_name_key(staff_name):
                hit = row
                staff_name = row.locale_name
                break
        if hit and hit.requires_access_code:
            try:
                staff_service._verify_locale_access_code(db, staff_name, access_code)
                return
            except ValueError:
                # If the Staff locale rejects the code, fallback to Prima Nota custom pack.
                # This allows locales linked to Staff to still be opened with their Prima Nota code.
                pass
    prima_nota_locale_service.verify_activity_access(db, activity, access_code)


@router.get("/locale-packs", response_model=List[PrimaNotaLocalePackSummary])
def list_locale_packs(db: Session = Depends(get_db)):
    try:
        return prima_nota_locale_service.list_locale_packs(db)
    except SQLAlchemyError:
        db.rollback()
        return []


@router.get("/locale-packs/{activity_slug}/access-code")
def reveal_locale_access_code(activity_slug: str, db: Session = Depends(get_db)):
    return {"access_code": prima_nota_locale_service.reveal_activity_access_code(db, activity_slug)}


@router.get("/locale-packs/{activity_slug}", response_model=PrimaNotaLocalePackRead)
def get_locale_pack(
    activity_slug: str,
    code: Optional[str] = Query(None, min_length=6, max_length=6),
    db: Session = Depends(get_db),
):
    try:
        row = prima_nota_locale_service.get_locale_pack(db, activity_slug, access_code=code)
    except ValueError:
        raise HTTPException(status_code=403, detail="Codice locale non valido.")
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Locale non trovato")
    return row


@router.put("/locale-packs", response_model=PrimaNotaLocalePackRead)
def upsert_locale_pack(payload: PrimaNotaLocalePackUpsert, db: Session = Depends(get_db)):
    try:
        return prima_nota_locale_service.upsert_locale_pack(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/locale-packs/{activity_slug}", status_code=status.HTTP_204_NO_CONTENT)
def delete_locale_pack(
    activity_slug: str,
    code: Optional[str] = Query(None, min_length=6, max_length=6),
    db: Session = Depends(get_db),
):
    try:
        ok = prima_nota_locale_service.delete_locale_pack(db, activity_slug, access_code=code)
    except ValueError:
        raise HTTPException(status_code=403, detail="Codice locale non valido.")
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Locale non trovato")


@router.get("/entries", response_model=List[CashEntryWithBalance])
def list_entries(
    date_from: Optional[str] = Query(None, description="Data inizio (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Data fine (YYYY-MM-DD)"),
    activity: Optional[str] = Query(None, description="Attività: risacca, via_lattea, via_abba, via_zanardelli"),
    code: Optional[str] = Query(None, min_length=6, max_length=6, description="Codice locale a 6 cifre"),
    db: Session = Depends(get_db),
):
    dt_from = datetime.fromisoformat(date_from) if date_from else None
    dt_to = datetime.fromisoformat(date_to + "T23:59:59") if date_to else None
    act = _validate_activity(activity)
    _verify_activity_access(db, act, code)
    _maybe_sync_daily_closings(
        db,
        act,
        date_from=dt_from.date() if dt_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
    )
    return cash_service.list_entries_with_balance(db, date_from=dt_from, date_to=dt_to, activity=act)


@router.get("/entries/{entry_id}", response_model=CashEntryRead)
def get_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = cash_service.get_entry(db, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimento non trovato")
    return entry


@router.post("/entries", response_model=CashEntryRead)
def create_entry(
    data: CashEntryCreate,
    code: Optional[str] = Query(None, min_length=6, max_length=6, description="Codice locale a 6 cifre"),
    db: Session = Depends(get_db),
):
    act = _validate_activity(data.activity)
    _verify_activity_access(db, act, code)
    return cash_service.create_entry(db, data)


@router.put("/entries/{entry_id}", response_model=CashEntryRead)
def update_entry(
    entry_id: int,
    data: CashEntryCreate,
    code: Optional[str] = Query(None, min_length=6, max_length=6, description="Codice locale a 6 cifre"),
    db: Session = Depends(get_db),
):
    act = _validate_activity(data.activity)
    _verify_activity_access(db, act, code)
    entry = cash_service.update_entry(db, entry_id, data)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimento non trovato")
    return entry


@router.delete("/entries/day", status_code=status.HTTP_204_NO_CONTENT)
def delete_entries_for_day(
    date_str: str = Query(..., description="Data (YYYY-MM-DD)"),
    activity: Optional[str] = Query(None, description="Attività: risacca, via_lattea, via_abba, via_zanardelli"),
    code: Optional[str] = Query(None, min_length=6, max_length=6, description="Codice locale a 6 cifre"),
    db: Session = Depends(get_db),
):
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Data non valida")
    act = _validate_activity(activity)
    _verify_activity_access(db, act, code)
    cash_service.delete_entries_for_day(db, d, activity=act)


@router.delete("/entries/range", status_code=status.HTTP_204_NO_CONTENT)
def delete_entries_for_range(
    date_from: str = Query(..., description="Data inizio (YYYY-MM-DD)"),
    date_to: str = Query(..., description="Data fine (YYYY-MM-DD)"),
    activity: Optional[str] = Query(None, description="Attività: risacca, via_lattea, via_abba, via_zanardelli"),
    code: Optional[str] = Query(None, min_length=6, max_length=6, description="Codice locale a 6 cifre"),
    db: Session = Depends(get_db),
):
    try:
        d_from = date.fromisoformat(date_from)
        d_to = date.fromisoformat(date_to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Intervallo date non valido")
    if d_from > d_to:
        raise HTTPException(status_code=400, detail="Data inizio successiva alla data fine")
    act = _validate_activity(activity)
    _verify_activity_access(db, act, code)
    cash_service.delete_entries_for_range(db, d_from, d_to, activity=act)


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: int,
    code: Optional[str] = Query(None, min_length=6, max_length=6, description="Codice locale a 6 cifre"),
    db: Session = Depends(get_db),
):
    entry = cash_service.get_entry(db, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimento non trovato")
    _verify_activity_access(db, getattr(entry, "activity", None), code)
    deleted = cash_service.delete_entry(db, entry_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimento non trovato")


@router.get("/link-options", response_model=PrimaNotaLinkOptions)
def get_prima_nota_link_options(db: Session = Depends(get_db)):
    return cash_service.get_link_options(db)


@router.get("/summary", response_model=DailySummary)
def get_daily_summary(
    date_str: str = Query(..., description="Data (YYYY-MM-DD)"),
    activity: Optional[str] = Query(None, description="Attività: risacca, via_lattea, via_abba, via_zanardelli"),
    code: Optional[str] = Query(None, min_length=6, max_length=6, description="Codice locale a 6 cifre"),
    db: Session = Depends(get_db),
):
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Data non valida")
    act = _validate_activity(activity)
    _verify_activity_access(db, act, code)
    _maybe_sync_daily_closings(db, act, date_from=d, date_to=d)
    return cash_service.get_daily_summary(db, d, activity=act)


@router.get("/summary/range", response_model=PeriodSummary)
def get_range_summary(
    date_from: str = Query(..., description="Data inizio (YYYY-MM-DD)"),
    date_to: str = Query(..., description="Data fine (YYYY-MM-DD)"),
    activity: Optional[str] = Query(None, description="Attività: risacca, via_lattea, via_abba, via_zanardelli"),
    code: Optional[str] = Query(None, min_length=6, max_length=6, description="Codice locale a 6 cifre"),
    db: Session = Depends(get_db),
):
    try:
        d_from = date.fromisoformat(date_from)
        d_to = date.fromisoformat(date_to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Data non valida")
    act = _validate_activity(activity)
    _verify_activity_access(db, act, code)
    _maybe_sync_daily_closings(db, act, date_from=d_from, date_to=d_to)
    return cash_service.get_range_summary(db, d_from, d_to, activity=act)


@router.get("/export/csv")
def export_csv(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    activity: Optional[str] = Query(None),
    code: Optional[str] = Query(None, min_length=6, max_length=6, description="Codice locale a 6 cifre"),
    db: Session = Depends(get_db),
):
    dt_from = datetime.fromisoformat(date_from) if date_from else None
    dt_to = datetime.fromisoformat(date_to + "T23:59:59") if date_to else None
    act = _validate_activity(activity)
    _verify_activity_access(db, act, code)
    rows = cash_service.get_entries_for_export(db, date_from=dt_from, date_to=dt_to, activity=act)

    def _esc(s):
        return (s or "").replace(";", ",")

    buf = io.StringIO()
    buf.write("Data;Tipo;Importo;Descrizione;Conto;Rif. documento fiscale;Note;Attività\n")
    for r in rows:
        buf.write(
            f"{r['data'][:10]};{r['tipo']};{r['importo']:.2f};{_esc(r['descrizione'])};{_esc(r['conto'])};{_esc(r['riferimento_documento'])};{_esc(r['note'])};{_esc(r.get('activity', ''))}\n"
        )

    buf.seek(0)
    part_from = (date_from or "inizio").replace(":", "-")[:10]
    part_to = (date_to or "oggi").replace(":", "-")[:10] if date_to else "oggi"
    filename = f"prima_nota_{part_from}_{part_to}.csv"
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/paper-closings")
def list_paper_closings(
    activity: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    code: Optional[str] = Query(None, min_length=6, max_length=6),
    db: Session = Depends(get_db),
):
    """Letture operatore salvate (CONTANTI / BANCOMAT della carta)."""
    act = _validate_activity(activity)
    _verify_activity_access(db, act, code)
    d_from = date.fromisoformat(date_from) if date_from else None
    d_to = date.fromisoformat(date_to) if date_to else None
    rows = paper_closing_overrides.list_paper_closings(
        activity=act,
        date_from=d_from,
        date_to=d_to,
    )
    return {"ok": True, "rows": rows}


@router.put("/paper-closings")
def upsert_paper_closing(
    body: PaperClosingUpsert,
    code: Optional[str] = Query(None, min_length=6, max_length=6),
    db: Session = Depends(get_db),
):
    """Salva lettura operatore e riscrive la chiusura automatica in Prima Nota."""
    act = _validate_activity(body.activity)
    if not act:
        raise HTTPException(status_code=400, detail="Attività obbligatoria")
    _verify_activity_access(db, act, code)
    try:
        day = date.fromisoformat(body.day[:10])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Data non valida") from exc
    if body.contanti is None and body.pos is None and body.nc is None and body.fatture is None:
        raise HTTPException(status_code=400, detail="Indica contanti e/o POS della lettura")
    try:
        saved = paper_closing_overrides.upsert_paper_closing(
            act,
            day,
            contanti=body.contanti,
            pos=body.pos,
            nc=body.nc,
            fatture=body.fatture,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    sync = cash_closing_sync.sync_daily_closings_to_prima_nota(
        db,
        activity=act,
        date_from=day,
        date_to=day,
        force_days=[day],
    )
    return {"ok": True, "paper": saved, "sync": sync}
