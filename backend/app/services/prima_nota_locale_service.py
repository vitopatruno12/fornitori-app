import logging
import random
from typing import List, Optional

from sqlalchemy.exc import ProgrammingError, SQLAlchemyError
from sqlalchemy.orm import Session

from ..constants.prima_nota import is_valid_activity_slug
from ..models.prima_nota_locale_pack import PrimaNotaLocalePack
from ..schemas.cash import (
    PrimaNotaLocalePackRead,
    PrimaNotaLocalePackSummary,
    PrimaNotaLocalePackUpsert,
)

logger = logging.getLogger(__name__)

_table_ready = False


def _normalize_access_code(code: Optional[str]) -> str:
    digits = "".join(ch for ch in str(code or "") if ch.isdigit())
    return digits if len(digits) == 6 else ""


def _generate_access_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def _rollback_db(db: Session) -> None:
    try:
        db.rollback()
    except SQLAlchemyError:
        pass


def _ensure_table(db: Session) -> bool:
    """Crea la tabella al volo se manca (deploy senza restart API o create_all saltato)."""
    global _table_ready
    if _table_ready:
        return True
    try:
        PrimaNotaLocalePack.__table__.create(bind=db.get_bind(), checkfirst=True)
        _table_ready = True
        return True
    except SQLAlchemyError as exc:
        _rollback_db(db)
        logger.warning("Impossibile creare prima_nota_locale_packs: %s", exc)
        return False


def _resolve_access_code(payload: PrimaNotaLocalePackUpsert, existing: Optional[str]) -> str:
    if payload.regenerate_access_code:
        return _generate_access_code()
    if payload.access_code:
        normalized = _normalize_access_code(payload.access_code)
        if not normalized:
            raise ValueError("Codice locale non valido: servono 6 cifre numeriche.")
        return normalized
    if existing:
        normalized = _normalize_access_code(existing)
        if normalized:
            return normalized
    return _generate_access_code()


def _find_pack(db: Session, activity_slug: str) -> Optional[PrimaNotaLocalePack]:
    slug = str(activity_slug or "").strip().lower()
    if not slug or not _ensure_table(db):
        return None
    try:
        return db.query(PrimaNotaLocalePack).filter(PrimaNotaLocalePack.activity_slug == slug).first()
    except ProgrammingError as exc:
        _rollback_db(db)
        logger.warning("Query prima_nota_locale_packs fallita: %s", exc)
        return None
    except SQLAlchemyError:
        _rollback_db(db)
        raise


def pack_to_summary(row: PrimaNotaLocalePack) -> PrimaNotaLocalePackSummary:
    return PrimaNotaLocalePackSummary(
        activity_slug=row.activity_slug,
        label=row.label,
        requires_access_code=bool(_normalize_access_code(row.access_code)),
    )


def pack_to_read(row: PrimaNotaLocalePack, include_access_code: bool = False) -> PrimaNotaLocalePackRead:
    code = _normalize_access_code(row.access_code) or None
    return PrimaNotaLocalePackRead(
        activity_slug=row.activity_slug,
        label=row.label,
        access_code=code if include_access_code else None,
        requires_access_code=bool(code),
    )


def list_locale_packs(db: Session) -> List[PrimaNotaLocalePackSummary]:
    if not _ensure_table(db):
        return []
    try:
        rows = db.query(PrimaNotaLocalePack).order_by(PrimaNotaLocalePack.activity_slug.asc()).all()
        return [pack_to_summary(r) for r in rows]
    except ProgrammingError as exc:
        _rollback_db(db)
        logger.warning("list_locale_packs fallita: %s", exc)
        return []
    except SQLAlchemyError:
        _rollback_db(db)
        raise


def get_locale_pack(
    db: Session,
    activity_slug: str,
    access_code: Optional[str] = None,
) -> Optional[PrimaNotaLocalePackRead]:
    row = _find_pack(db, activity_slug)
    if not row:
        return None
    stored_code = _normalize_access_code(row.access_code)
    if stored_code:
        provided = _normalize_access_code(access_code)
        if provided != stored_code:
            raise ValueError("Codice locale non valido.")
    return pack_to_read(row)


def upsert_locale_pack(db: Session, payload: PrimaNotaLocalePackUpsert) -> PrimaNotaLocalePackRead:
    if not _ensure_table(db):
        raise ValueError("Tabella codici locale non disponibile. Riavvia l'API o verifica il database.")
    slug = str(payload.activity_slug or "").strip().lower()
    if not is_valid_activity_slug(slug):
        raise ValueError("Slug attività non valido.")
    target = _find_pack(db, slug)
    access_code = _resolve_access_code(payload, target.access_code if target else None)
    label = str(payload.label or "").strip() or (target.label if target else None)
    if target:
        target.label = label
        target.access_code = access_code
        row = target
    else:
        row = PrimaNotaLocalePack(activity_slug=slug, label=label, access_code=access_code)
        db.add(row)
    db.commit()
    db.refresh(row)
    return pack_to_read(row, include_access_code=True)


def verify_activity_access(db: Session, activity: Optional[str], access_code: Optional[str] = None) -> None:
    if not activity:
        return
    slug = str(activity).strip().lower()
    if not slug:
        return
    row = _find_pack(db, slug)
    if not row:
        return
    stored_code = _normalize_access_code(row.access_code)
    if not stored_code:
        return
    provided = _normalize_access_code(access_code)
    if provided != stored_code:
        raise ValueError("Codice locale non valido.")
