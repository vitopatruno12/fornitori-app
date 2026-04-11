import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from . import models  # noqa: F401
from .database import Base, engine
from .routers import suppliers, deliveries, invoices, cash, price_list, dashboard, reference, customers, attachments, ai, supplier_orders, staff

logger = logging.getLogger("app.startup")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        Base.metadata.create_all(bind=engine)
    except OperationalError as e:
        logger.error(
            "PostgreSQL: connessione o autenticazione fallita. "
            "Controlla che il servizio sia avviato e che la password in backend/.env (DATABASE_URL) "
            "coincida con l'utente sul server. "
            "Per allineare l'utente locale vedi backend/scripts/dev_postgres_fornitori.sql — Dettaglio: %s",
            e,
        )
        raise
    except SQLAlchemyError as e:
        logger.error("Inizializzazione database fallita: %s", e)
        raise
    _check_critical_schema_columns()
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


def _check_critical_schema_columns() -> None:
    """Warn if critical migration columns are missing (non-blocking)."""
    required = [
        ("invoices", "ignored", "20260406_invoices_ignored_flag.sql"),
        ("cash_entries", "invoice_id", "20260208_core_entities_prima_nota_links.sql"),
        ("cash_entries", "delivery_id", "20260208_core_entities_prima_nota_links.sql"),
        ("cash_entries", "customer_id", "20260208_core_entities_prima_nota_links.sql"),
        ("supplier_orders", "order_date", "20260408_supplier_orders.sql"),
        ("supplier_orders", "status", "20260409_supplier_orders_status_summary.sql"),
        ("supplier_orders", "expected_delivery_date", "20260410_supplier_orders_delivery_internal_note.sql"),
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


@app.get("/health")
def health_check():
    return {"status": "ok"}