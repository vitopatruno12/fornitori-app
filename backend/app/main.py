import logging
import os
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from . import models  # noqa: F401
from .database import Base, engine
from .routers import suppliers, deliveries, invoices, cash, price_list, dashboard, reference, customers, attachments, ai, supplier_orders, staff, support_technicians, vne, aruba, sdi

# Logging di base per Render/uvicorn: assicura che i WARNING/ERROR
# del nostro logger arrivino sempre nel log del servizio.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("app.startup")

# Modalità tollerante in deploy: se True, le inizializzazioni DB falliscono
# senza killare il processo (il servizio resta su e /health risponde, così
# si possono ispezionare i log su Render).
ALLOW_STARTUP_DB_FAILURE = os.getenv("ALLOW_STARTUP_DB_FAILURE", "true").strip().lower() in ("1", "true", "yes")


def _log_startup_exception(prefix: str, exc: Exception) -> None:
    logger.error("%s (%s): %s", prefix, type(exc).__name__, exc)
    logger.error("Traceback:\n%s", traceback.format_exc())


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        Base.metadata.create_all(bind=engine)
        _ensure_support_technicians_columns()
        _ensure_supplier_orders_delivery_location_column()
        _ensure_supplier_orders_sequence_number_column()
        _ensure_order_delivery_signature_columns()
    except OperationalError as e:
        _log_startup_exception(
            "PostgreSQL: connessione o autenticazione fallita. "
            "Controlla DATABASE_URL su Render (Internal URL del DB) e che il servizio Postgres sia attivo. "
            "Se serve SSL imposta DATABASE_SSL_REQUIRE=true.",
            e,
        )
        if not ALLOW_STARTUP_DB_FAILURE:
            raise
    except SQLAlchemyError as e:
        _log_startup_exception(
            "Inizializzazione database fallita. "
            "ProgrammingError (sqlalche.me/e/20/e3q8): verifica DATABASE_URL, "
            "password URL-encoded e che il target sia Postgres.",
            e,
        )
        if not ALLOW_STARTUP_DB_FAILURE:
            raise
    except Exception as e:  # pylint: disable=broad-except
        _log_startup_exception("Errore generico durante init DB", e)
        if not ALLOW_STARTUP_DB_FAILURE:
            raise
    try:
        _check_critical_schema_columns()
    except Exception as e:  # pylint: disable=broad-except
        _log_startup_exception("Schema check fallito (non bloccante)", e)
    yield


app = FastAPI(lifespan=lifespan)

# CORS subito dopo la creazione dell'app (prima di mount/router): così tutte le risposte
# (anche errori) passano dal middleware. Con allow_credentials=True + origini fisse il
# browser a volte non riceve l'header; per API senza cookie usiamo * in dev.
_cors = os.getenv("CORS_ORIGINS", "*").strip()
if _cors == "*":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    _origins = [o.strip() for o in _cors.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins or ["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Servire i file delle fatture (PDF/immagini) sotto /uploads
_uploads_dir = Path(__file__).resolve().parent / "uploads"
_uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")

app.include_router(suppliers.router)
app.include_router(deliveries.router)
app.include_router(invoices.router)
app.include_router(cash.router)
app.include_router(price_list.router)
app.include_router(dashboard.router)
app.include_router(reference.router)
app.include_router(customers.router)
app.include_router(attachments.router)
app.include_router(ai.router)
app.include_router(supplier_orders.router)
app.include_router(staff.router)
app.include_router(support_technicians.router)
app.include_router(vne.router)
app.include_router(aruba.router)
app.include_router(sdi.router)


def _ensure_support_technicians_columns() -> None:
    """
    Backward-compatibilità: aggiunge colonne orarie se il DB è stato creato
    prima della feature report assistenza tecnici.
    """
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    ALTER TABLE technician_activities
                    ADD COLUMN IF NOT EXISTS time_start VARCHAR(5),
                    ADD COLUMN IF NOT EXISTS time_end VARCHAR(5)
                    """
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/aggiornare colonne orarie technician_activities: %s",
            e,
        )


def _ensure_supplier_orders_delivery_location_column() -> None:
    """Backward-compat: colonna destinazione scarico/spedizione (migr. 20260505)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS delivery_location VARCHAR(128)"
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/aggiornare supplier_orders.delivery_location: %s",
            e,
        )


def _ensure_supplier_orders_sequence_number_column() -> None:
    """Backward-compat: sequence_number ordini per fornitore (migr. 20260506)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS sequence_number INTEGER"
                )
            )
            conn.execute(
                text(
                    """
                    UPDATE supplier_orders o
                    SET sequence_number = sub.rn
                    FROM (
                      SELECT id, ROW_NUMBER() OVER (PARTITION BY supplier_id ORDER BY id ASC) AS rn
                      FROM supplier_orders
                    ) sub
                    WHERE o.id = sub.id
                      AND o.sequence_number IS NULL
                    """
                )
            )
            conn.execute(
                text(
                    """
                    DO $uniq$
                    BEGIN
                      IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'uq_supplier_orders_supplier_sequence'
                      ) AND NOT EXISTS (
                        SELECT 1 FROM pg_indexes
                        WHERE indexname = 'uq_supplier_orders_supplier_sequence'
                      ) THEN
                        CREATE UNIQUE INDEX uq_supplier_orders_supplier_sequence
                        ON supplier_orders (supplier_id, sequence_number);
                      END IF;
                    END
                    $uniq$;
                    """
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/aggiornare supplier_orders.sequence_number: %s",
            e,
        )


def _ensure_order_delivery_signature_columns() -> None:
    """Backward-compat: firme ordine/scarico su ordini e consegne (migr. 20260507)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    ALTER TABLE supplier_orders
                    ADD COLUMN IF NOT EXISTS order_signed_by VARCHAR(128),
                    ADD COLUMN IF NOT EXISTS unloading_signed_by VARCHAR(128)
                    """
                )
            )
            conn.execute(
                text(
                    """
                    ALTER TABLE deliveries
                    ADD COLUMN IF NOT EXISTS order_signed_by VARCHAR(128),
                    ADD COLUMN IF NOT EXISTS unloading_signed_by VARCHAR(128)
                    """
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/aggiornare colonne firma ordine/scarico: %s",
            e,
        )


def _check_critical_schema_columns() -> None:
    """Warn if critical migration columns are missing (non-blocking)."""
    try:
        required = [
            ("invoices", "ignored", "20260406_invoices_ignored_flag.sql"),
            ("cash_entries", "invoice_id", "20260208_core_entities_prima_nota_links.sql"),
            ("cash_entries", "delivery_id", "20260208_core_entities_prima_nota_links.sql"),
            ("cash_entries", "customer_id", "20260208_core_entities_prima_nota_links.sql"),
            ("supplier_orders", "order_date", "20260408_supplier_orders.sql"),
            ("supplier_orders", "status", "20260409_supplier_orders_status_summary.sql"),
            ("supplier_orders", "expected_delivery_date", "20260410_supplier_orders_delivery_internal_note.sql"),
            ("supplier_orders", "delivery_location", "20260505_supplier_orders_delivery_location.sql"),
            ("supplier_orders", "sequence_number", "20260506_supplier_orders_sequence_number.sql"),
            ("supplier_orders", "order_signed_by", "20260507_order_delivery_signatures.sql"),
            ("supplier_orders", "unloading_signed_by", "20260507_order_delivery_signatures.sql"),
            ("deliveries", "order_signed_by", "20260507_order_delivery_signatures.sql"),
            ("deliveries", "unloading_signed_by", "20260507_order_delivery_signatures.sql"),
            ("supplier_order_items", "weight_kg", "20260411_supplier_order_items_weight_kg.sql"),
        ]
        insp = inspect(engine)
        missing = []
        for table, column, migration in required:
            try:
                cols = {c["name"] for c in insp.get_columns(table)}
            except Exception:
                missing.append((table, column, migration))
                continue
            if column not in cols:
                missing.append((table, column, migration))

        if not missing:
            logger.info("Schema check OK: critical migration columns found")
            return

        msg = ", ".join(f"{t}.{c} (migrazione: {m})" for t, c, m in missing)
        logger.warning(
            "Schema check: colonne mancanti rilevate -> %s. "
            "Applicare le migrazioni indicate in backend/migrations o gli script in backend/scripts.",
            msg,
        )
    except Exception as e:
        logger.warning(
            "Schema check saltato (non bloccante): %s",
            e,
        )


@app.get("/health")
def health_check():
    return {"status": "ok"}