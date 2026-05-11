import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from .config import DATABASE_URL


def _database_connect_args() -> dict:
    """
    Molti Postgres gestiti richiedono SSL per connessioni esterne.
    Su Render (Blueprint): la DATABASE_URL interna di solito non richiede sslmode.
    Imposta DATABASE_SSL_REQUIRE=true se il log mostra errori SSL/handshake.
    Disabilita con DATABASE_SSL_DISABLE=true.
    """
    if os.getenv("DATABASE_SSL_DISABLE", "").strip().lower() in ("1", "true", "yes"):
        return {}
    require = os.getenv("DATABASE_SSL_REQUIRE", "").strip().lower()
    if require in ("1", "true", "yes", "require"):
        return {"sslmode": "require"}
    return {}


_ca = _database_connect_args()

engine = create_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    pool_pre_ping=True,
    connect_args=_ca,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()