import logging
import os
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from . import models  # noqa: F401
from .database import Base, engine
from .services.prima_nota_locale_service import ensure_prima_nota_locale_packs_table
from .ai.module import register_ai_module
from .routers import suppliers, deliveries, invoices, cash, price_list, dashboard, analytics, reference, customers, attachments, supplier_orders, staff, support_technicians, carriers, vne, sdi, banca, warehouse, supplier_payments, electronic_invoices, pos_receipts

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
        _ensure_cash_entries_activity_column()
        _ensure_supplier_locales_column()
        _ensure_supplier_multi_contact_columns()
        _ensure_staff_member_hourly_rate_column()
        _ensure_staff_member_section_column()
        _ensure_staff_payroll_months_table()
        _ensure_staff_stipendi_months_table()
        _ensure_staff_locale_packs_table()
        ensure_prima_nota_locale_packs_table()
        _ensure_staff_backups_table()
        _ensure_warehouse_movements_table()
        _ensure_supplier_payments_workbook_table()
        _ensure_supplier_order_items_volume_liters_column()
        _ensure_carriers_tables()
        _ensure_electronic_invoices_tables()
        _ensure_sdi_electronic_invoice_link()
        _ensure_bank_module_tables()
        _ensure_pos_receipts_table()
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


# Dietro Nginx/Caddy (/api → uvicorn): evita 307 verso /suppliers/ senza prefisso /api.
app = FastAPI(lifespan=lifespan, redirect_slashes=False)

# CORS subito dopo la creazione dell'app (prima di mount/router): così tutte le risposte
# (anche errori) passano dal middleware. Con allow_credentials=True + origini fisse il
# browser a volte non riceve l'header; per API senza cookie usiamo * in dev.
#
# Configurazione:
#   CORS_ORIGINS       = "*"  oppure CSV di origin esatti (https://app.vercel.app, ...)
#   CORS_ORIGIN_REGEX  = regex Python per matchare origin dinamici (es. preview Vercel)
# Default (env vuota o assente): "*". I deploy su Vercel hanno URL preview variabili
# (<proj>-<hash>-<team>.vercel.app), quindi per evitare 500 da CORS abilitiamo anche
# un regex di default che copre *.vercel.app.
_cors = (os.getenv("CORS_ORIGINS", "*").strip() or "*")
_cors_regex = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"https://([a-z0-9-]+\.)*vercel\.app",
).strip() or None

if _cors == "*":
    logger.info("CORS: allow_origins=* (credentials disabled), regex=%s", _cors_regex)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_origin_regex=_cors_regex,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    _origins = [o.strip() for o in _cors.split(",") if o.strip()] or [
        "https://localhost:5173",
        "https://127.0.0.1:5173",
    ]
    logger.info("CORS: allow_origins=%s (credentials enabled), regex=%s", _origins, _cors_regex)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_origin_regex=_cors_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Servire i file delle fatture (PDF/immagini) sotto /uploads
_uploads_dir = Path(__file__).resolve().parent / "uploads"
_uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")

# Mostra dettagli errore al client quando richiesto (DEBUG_ERRORS=true). Utile in
# staging/Render per debuggare 500. In produzione meglio false.
EXPOSE_ERROR_DETAILS = os.getenv("DEBUG_ERRORS", "false").strip().lower() in ("1", "true", "yes")


@app.exception_handler(OperationalError)
async def _operational_error_handler(request: Request, exc: OperationalError):
    """DB irraggiungibile/credenziali errate: 503 con messaggio chiaro.

    Importante: tornare una Response qui invece di propagare l'eccezione fa sì
    che la risposta passi dal CORSMiddleware e includa Access-Control-Allow-Origin.
    """
    logger.error("OperationalError su %s: %s", request.url.path, exc)
    payload = {
        "detail": "Database non raggiungibile. Verifica DATABASE_URL e che il Postgres sia attivo.",
        "error": "operational_error",
    }
    if EXPOSE_ERROR_DETAILS:
        payload["debug"] = str(exc)
    return JSONResponse(status_code=503, content=payload)


@app.exception_handler(SQLAlchemyError)
async def _sqlalchemy_error_handler(request: Request, exc: SQLAlchemyError):
    logger.error("SQLAlchemyError su %s (%s): %s", request.url.path, type(exc).__name__, exc)
    detail = "Errore database."
    err_text = str(exc).lower()
    missing_rel = None
    for marker in ("relation \"", "relation '", 'column "', "column '"):
        if marker in err_text:
            start = err_text.find(marker) + len(marker)
            end = err_text.find(marker[-1], start)
            if end > start:
                missing_rel = err_text[start:end]
                break
    if "warehouse_movements" in err_text or "supplier_payments_workbooks" in err_text or "volume_liters" in err_text:
        detail = (
            "Schema database incompleto (magazzino, pagamenti fornitori o ordini). "
            "Sul server esegui: sudo RESTART_API=1 bash deploy/release-safe.sh "
            "oppure deploy/ensure-warehouse-payments-tables.sh"
        )
    elif "does not exist" in err_text or "undefinedtable" in err_text or "undefinedcolumn" in err_text:
        detail = (
            "Tabella o colonna mancante nel database"
            + (f" ({missing_rel})" if missing_rel else "")
            + ". Applicare le migrazioni in backend/migrations o deploy/ensure-warehouse-payments-tables.sh"
        )
    payload = {"detail": detail, "error": "sqlalchemy_error"}
    if EXPOSE_ERROR_DETAILS:
        payload["debug"] = f"{type(exc).__name__}: {exc}"
    return JSONResponse(status_code=500, content=payload)


@app.exception_handler(Exception)
async def _generic_error_handler(request: Request, exc: Exception):
    """Catchall: assicura JSON + header CORS anche su eccezioni non previste."""
    logger.exception("Errore non gestito su %s", request.url.path)
    payload = {"detail": "Errore interno.", "error": "internal_error"}
    if EXPOSE_ERROR_DETAILS:
        payload["debug"] = f"{type(exc).__name__}: {exc}"
    return JSONResponse(status_code=500, content=payload)


app.include_router(suppliers.router)
app.include_router(deliveries.router)
app.include_router(invoices.router)
app.include_router(cash.router)
app.include_router(price_list.router)
app.include_router(dashboard.router)
app.include_router(analytics.router)
app.include_router(reference.router)
app.include_router(customers.router)
app.include_router(attachments.router)
register_ai_module(app)
app.include_router(supplier_orders.router)
app.include_router(warehouse.router)
app.include_router(supplier_payments.router)
app.include_router(staff.router)
app.include_router(support_technicians.router)
app.include_router(carriers.router)
app.include_router(vne.router)
app.include_router(sdi.router)
app.include_router(electronic_invoices.router)
app.include_router(banca.router)
app.include_router(pos_receipts.router)


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



def _safe_exec_sql(sql: str, *, label: str) -> bool:
    """Esegue SQL in transazione dedicata; False se fallisce (es. ownership index)."""
    try:
        with engine.begin() as conn:
            conn.execute(text(sql))
        return True
    except Exception as e:
        logger.warning("%s: %s", label, e)
        return False


def _ensure_electronic_invoices_tables() -> None:
    """Tabelle import XML FatturaPA → fatture passive."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS electronic_invoices (
                      id SERIAL PRIMARY KEY,
                      filename VARCHAR(512),
                      xml_content TEXT NOT NULL,
                      document_hash VARCHAR(64) NOT NULL UNIQUE,
                      document_type VARCHAR(16),
                      invoice_number VARCHAR(128),
                      invoice_date DATE,
                      currency VARCHAR(8),
                      supplier_vat VARCHAR(32),
                      customer_vat VARCHAR(32),
                      total_amount NUMERIC(15, 2),
                      taxable_amount NUMERIC(15, 2),
                      vat_amount NUMERIC(15, 2),
                      status VARCHAR(32) NOT NULL DEFAULT 'IMPORTED',
                      error_message TEXT,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS incoming_invoices (
                      id SERIAL PRIMARY KEY,
                      electronic_invoice_id INTEGER NOT NULL UNIQUE REFERENCES electronic_invoices(id) ON DELETE CASCADE,
                      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
                      atlas_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
                      invoice_number VARCHAR(128) NOT NULL,
                      invoice_date TIMESTAMPTZ NOT NULL,
                      taxable_amount NUMERIC(15, 2) NOT NULL,
                      vat_amount NUMERIC(15, 2) NOT NULL,
                      total_amount NUMERIC(15, 2) NOT NULL,
                      currency VARCHAR(8) NOT NULL DEFAULT 'EUR',
                      status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
                      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS incoming_invoice_lines (
                      id SERIAL PRIMARY KEY,
                      invoice_id INTEGER NOT NULL REFERENCES incoming_invoices(id) ON DELETE CASCADE,
                      line_number INTEGER NOT NULL,
                      description TEXT,
                      quantity NUMERIC(15, 4),
                      unit_price NUMERIC(15, 8),
                      line_total NUMERIC(15, 2),
                      vat_rate NUMERIC(5, 2),
                      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                      UNIQUE (invoice_id, line_number)
                    )
                    """
                )
            )
        # INDEX separati: se la tabella è owned da postgres, CREATE INDEX fallisce
        # ma non deve annullare la creazione tabelle.
        _safe_exec_sql(
            "CREATE INDEX IF NOT EXISTS ix_electronic_invoices_supplier_vat ON electronic_invoices (supplier_vat)",
            label="Index electronic_invoices.supplier_vat",
        )
        _safe_exec_sql(
            "CREATE INDEX IF NOT EXISTS ix_electronic_invoices_invoice_number ON electronic_invoices (invoice_number)",
            label="Index electronic_invoices.invoice_number",
        )
        _safe_exec_sql(
            "CREATE INDEX IF NOT EXISTS ix_incoming_invoices_supplier ON incoming_invoices (supplier_id)",
            label="Index incoming_invoices.supplier_id",
        )
        _safe_exec_sql(
            "CREATE INDEX IF NOT EXISTS ix_incoming_invoices_atlas_invoice ON incoming_invoices (atlas_invoice_id)",
            label="Index incoming_invoices.atlas_invoice_id",
        )
        _safe_exec_sql(
            "CREATE INDEX IF NOT EXISTS ix_incoming_invoice_lines_invoice ON incoming_invoice_lines (invoice_id)",
            label="Index incoming_invoice_lines.invoice_id",
        )
    except Exception as e:
        logger.warning("Impossibile creare tabelle electronic/incoming invoices: %s", e)


def _ensure_sdi_electronic_invoice_link() -> None:
    """Fase 1: sdi_invoices.electronic_invoice_id → electronic_invoices."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    ALTER TABLE sdi_invoices
                      ADD COLUMN IF NOT EXISTS electronic_invoice_id INTEGER
                        REFERENCES electronic_invoices(id) ON DELETE SET NULL
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_sdi_invoices_electronic_invoice_id
                      ON sdi_invoices (electronic_invoice_id)
                    """
                )
            )
    except Exception as e:
        logger.warning("Impossibile aggiungere sdi_invoices.electronic_invoice_id: %s", e)


def _ensure_carriers_tables() -> None:
    """Crea tabelle trasportatori e colonna deliveries.carrier_id se assenti."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS carriers (
                      id SERIAL PRIMARY KEY,
                      name VARCHAR(255) NOT NULL,
                      phone VARCHAR(32),
                      email VARCHAR(255),
                      is_active BOOLEAN NOT NULL DEFAULT TRUE,
                      out_of_service BOOLEAN NOT NULL DEFAULT FALSE,
                      in_service BOOLEAN NOT NULL DEFAULT FALSE,
                      rest_day INTEGER,
                      van_label VARCHAR(120),
                      van_plate VARCHAR(32),
                      notes TEXT,
                      sort_order INTEGER NOT NULL DEFAULT 0,
                      created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                    """
                )
            )

            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS carrier_maintenance_logs (
                      id SERIAL PRIMARY KEY,
                      carrier_id INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
                      service_date DATE NOT NULL,
                      description VARCHAR(512) NOT NULL,
                      odometer_km INTEGER,
                      cost NUMERIC(10, 2),
                      workshop VARCHAR(255),
                      notes TEXT,
                      created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS carrier_fuel_expenses (
                      id SERIAL PRIMARY KEY,
                      carrier_id INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
                      expense_date DATE NOT NULL,
                      liters NUMERIC(10, 2),
                      amount_eur NUMERIC(10, 2) NOT NULL,
                      station VARCHAR(255),
                      odometer_km INTEGER,
                      notes TEXT,
                      created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS carrier_other_expenses (
                      id SERIAL PRIMARY KEY,
                      carrier_id INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
                      expense_date DATE NOT NULL,
                      category VARCHAR(120),
                      amount_eur NUMERIC(10, 2) NOT NULL,
                      description VARCHAR(512),
                      notes TEXT,
                      created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS carrier_id INTEGER REFERENCES carriers(id) ON DELETE SET NULL"
                )
            )
    except Exception as e:
        logger.warning("Impossibile verificare/creare tabelle carriers: %s", e)


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


def _ensure_cash_entries_activity_column() -> None:
    """Backward-compat: attività economica su movimenti Prima Nota (migr. 20260519)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    ALTER TABLE cash_entries
                    ADD COLUMN IF NOT EXISTS activity VARCHAR(32)
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_cash_entries_activity
                    ON cash_entries (activity)
                    """
                )
            )
            conn.execute(
                text(
                    """
                    UPDATE cash_entries
                    SET activity = 'via_abba'
                    WHERE activity = 'mediazione'
                    """
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/aggiornare cash_entries.activity: %s",
            e,
        )


def _ensure_supplier_locales_column() -> None:
    """Locali/punti vendita in cui il fornitore è presente (slug CSV, es. risacca,via_lattea)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    ALTER TABLE suppliers
                    ADD COLUMN IF NOT EXISTS locales VARCHAR(255)
                    """
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/aggiornare suppliers.locales: %s",
            e,
        )


def _ensure_supplier_multi_contact_columns() -> None:
    """Telefoni, email, città e categorie merceologiche multiple (JSON)."""
    try:
        with engine.begin() as conn:
            for col in (
                "phones_json TEXT",
                "emails_json TEXT",
                "cities_json TEXT",
                "merchandise_categories_json TEXT",
            ):
                conn.execute(
                    text(
                        f"""
                        ALTER TABLE suppliers
                        ADD COLUMN IF NOT EXISTS {col}
                        """
                    )
                )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/aggiornare suppliers multi-contact: %s",
            e,
        )


def _ensure_staff_member_hourly_rate_column() -> None:
    """Backward-compat: tariffa oraria dipendente (migr. 20260519_staff_hourly_rate.sql)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    ALTER TABLE staff_members
                    ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10, 2)
                    """
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/aggiornare staff_members.hourly_rate: %s",
            e,
        )


def _ensure_staff_member_section_column() -> None:
    """Sezione operativa dipendente + sezioni pack locale (migr. 20260723_staff_member_section.sql)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    ALTER TABLE staff_members
                    ADD COLUMN IF NOT EXISTS section VARCHAR(120)
                    """
                )
            )
            conn.execute(
                text(
                    """
                    ALTER TABLE staff_locale_packs
                    ADD COLUMN IF NOT EXISTS sections_json TEXT NOT NULL DEFAULT '[]'
                    """
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/aggiornare staff section columns: %s",
            e,
        )


def _ensure_staff_payroll_months_table() -> None:
    """Archivio stipendi mensili ore/costo (migr. 20260524_staff_payroll_months.sql)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS staff_payroll_months (
                      id SERIAL PRIMARY KEY,
                      year_month VARCHAR(7) NOT NULL,
                      period_from DATE NOT NULL,
                      period_to DATE NOT NULL,
                      lines_json TEXT NOT NULL DEFAULT '[]',
                      total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
                      notes TEXT,
                      created_at TIMESTAMPTZ DEFAULT NOW(),
                      updated_at TIMESTAMPTZ DEFAULT NOW(),
                      CONSTRAINT uq_staff_payroll_months_year_month UNIQUE (year_month)
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_staff_payroll_months_year_month
                    ON staff_payroll_months (year_month DESC)
                    """
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/creare staff_payroll_months: %s",
            e,
        )


def _ensure_staff_stipendi_months_table() -> None:
    """Archivio stipendi mensili Busta/TFR/Fuori (migr. 20260729_staff_stipendi_months.sql)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS staff_stipendi_months (
                      id SERIAL PRIMARY KEY,
                      year_month VARCHAR(7) NOT NULL,
                      period_from DATE NOT NULL,
                      period_to DATE NOT NULL,
                      lines_json TEXT NOT NULL DEFAULT '[]',
                      total_busta NUMERIC(12, 2) NOT NULL DEFAULT 0,
                      total_tfr NUMERIC(12, 2) NOT NULL DEFAULT 0,
                      total_fuori NUMERIC(12, 2) NOT NULL DEFAULT 0,
                      total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
                      notes TEXT,
                      created_at TIMESTAMPTZ DEFAULT NOW(),
                      updated_at TIMESTAMPTZ DEFAULT NOW(),
                      CONSTRAINT uq_staff_stipendi_months_year_month UNIQUE (year_month)
                    )
                    """
                )
            )
        _safe_exec_sql(
            """
            CREATE INDEX IF NOT EXISTS ix_staff_stipendi_months_year_month
            ON staff_stipendi_months (year_month DESC)
            """,
            label="Index staff_stipendi_months.year_month",
        )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/creare staff_stipendi_months: %s",
            e,
        )


def _ensure_staff_locale_packs_table() -> None:
    """Liste dipendenti per locale (condivise tra PC/browser)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS staff_locale_packs (
                      id SERIAL PRIMARY KEY,
                      locale_name VARCHAR(255) NOT NULL,
                      members_json TEXT NOT NULL DEFAULT '[]',
                      updated_at TIMESTAMPTZ DEFAULT NOW(),
                      CONSTRAINT uq_staff_locale_packs_name UNIQUE (locale_name)
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_staff_locale_packs_name
                    ON staff_locale_packs (locale_name)
                    """
                )
            )
            conn.execute(
                text(
                    """
                    ALTER TABLE staff_locale_packs
                    ADD COLUMN IF NOT EXISTS access_code VARCHAR(6)
                    """
                )
            )
            conn.execute(
                text(
                    """
                    ALTER TABLE staff_locale_packs
                    ADD COLUMN IF NOT EXISTS sections_json TEXT NOT NULL DEFAULT '[]'
                    """
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/creare staff_locale_packs: %s",
            e,
        )


def _ensure_staff_backups_table() -> None:
    """Backup pianificazione e ore/costi (condivisi tra PC/browser)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS staff_backups (
                      id SERIAL PRIMARY KEY,
                      section VARCHAR(32) NOT NULL,
                      backup_key VARCHAR(255) NOT NULL,
                      payload_json TEXT NOT NULL DEFAULT '{}',
                      updated_at TIMESTAMPTZ DEFAULT NOW(),
                      CONSTRAINT uq_staff_backups_section_key UNIQUE (section, backup_key)
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_staff_backups_section
                    ON staff_backups (section)
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_staff_backups_key
                    ON staff_backups (backup_key)
                    """
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/creare staff_backups: %s",
            e,
        )


def _ensure_warehouse_movements_table() -> None:
    """Registro entrata/uscita magazzino (migr. 20260710_warehouse_movements.sql)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS warehouse_movements (
                      id SERIAL PRIMARY KEY,
                      movement_type VARCHAR(8) NOT NULL,
                      movement_at TIMESTAMPTZ NOT NULL,
                      operator_name VARCHAR(128) NOT NULL,
                      signature VARCHAR(128) NOT NULL,
                      product_description VARCHAR(255) NOT NULL,
                      pieces INTEGER,
                      weight_kg NUMERIC(10, 3),
                      volume_liters NUMERIC(10, 3),
                      merchandise_condition VARCHAR(128),
                      location VARCHAR(128) NOT NULL DEFAULT 'Magazzino',
                      note TEXT,
                      created_at TIMESTAMPTZ DEFAULT now()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_warehouse_movements_movement_at
                    ON warehouse_movements (movement_at)
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_warehouse_movements_movement_type
                    ON warehouse_movements (movement_type)
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_warehouse_movements_location
                    ON warehouse_movements (location)
                    """
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/creare warehouse_movements: %s",
            e,
        )


def _ensure_supplier_payments_workbook_table() -> None:
    """Workbook pagamenti fornitori (migr. 20260710_supplier_payments_workbook.sql)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS supplier_payments_workbooks (
                      id SERIAL PRIMARY KEY,
                      workbook_key VARCHAR(64) NOT NULL,
                      title VARCHAR(255) NOT NULL DEFAULT '',
                      payload_json TEXT NOT NULL DEFAULT '{}',
                      updated_at TIMESTAMPTZ DEFAULT now(),
                      CONSTRAINT uq_supplier_payments_workbook_key UNIQUE (workbook_key)
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_supplier_payments_workbook_key
                    ON supplier_payments_workbooks (workbook_key)
                    """
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/creare supplier_payments_workbooks: %s",
            e,
        )


def _ensure_supplier_order_items_volume_liters_column() -> None:
    """Backward-compat: litri per riga ordine (migr. 20260710_supplier_order_items_volume_liters.sql)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE supplier_order_items ADD COLUMN IF NOT EXISTS volume_liters NUMERIC(10, 3)"
                )
            )
    except Exception as e:
        logger.warning(
            "Impossibile verificare/aggiornare supplier_order_items.volume_liters: %s",
            e,
        )


def _ensure_bank_module_tables() -> None:
    """Conti e movimenti banca (migr. 20260723_bank_module.sql)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS bank_accounts (
                      id SERIAL PRIMARY KEY,
                      bank_name VARCHAR(160) NOT NULL,
                      account_name VARCHAR(160) NOT NULL DEFAULT 'Conto corrente',
                      iban VARCHAR(34),
                      saldo_disponibile NUMERIC(14, 2) NOT NULL DEFAULT 0,
                      saldo_contabile NUMERIC(14, 2) NOT NULL DEFAULT 0,
                      connection_status VARCHAR(32) NOT NULL DEFAULT 'disconnected',
                      last_sync_at TIMESTAMPTZ,
                      is_active BOOLEAN NOT NULL DEFAULT TRUE,
                      notes TEXT,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS bank_movements (
                      id SERIAL PRIMARY KEY,
                      bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
                      movement_date DATE NOT NULL,
                      description VARCHAR(512),
                      causale VARCHAR(256),
                      movement_type VARCHAR(16) NOT NULL,
                      amount NUMERIC(14, 2) NOT NULL,
                      counterparty VARCHAR(256),
                      category VARCHAR(120),
                      reconciliation_status VARCHAR(32) NOT NULL DEFAULT 'unmatched',
                      matched_invoice_id INTEGER REFERENCES invoices(id),
                      matched_cash_entry_id INTEGER REFERENCES cash_entries(id),
                      difference_amount NUMERIC(14, 2),
                      source VARCHAR(32) NOT NULL DEFAULT 'manual',
                      notes TEXT,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
        _safe_exec_sql(
            "CREATE INDEX IF NOT EXISTS ix_bank_movements_account ON bank_movements (bank_account_id)",
            label="Index bank_movements.bank_account_id",
        )
        _safe_exec_sql(
            "CREATE INDEX IF NOT EXISTS ix_bank_movements_date ON bank_movements (movement_date DESC)",
            label="Index bank_movements.movement_date",
        )
        _safe_exec_sql(
            "CREATE INDEX IF NOT EXISTS ix_bank_movements_status ON bank_movements (reconciliation_status)",
            label="Index bank_movements.reconciliation_status",
        )
    except Exception as e:
        logger.warning("Impossibile verificare/creare tabelle banca: %s", e)


def _ensure_pos_receipts_table() -> None:
    """Scontrini POS (migr. 20260816_pos_receipts.sql)."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS pos_receipts (
                      id SERIAL PRIMARY KEY,
                      source VARCHAR(32) NOT NULL DEFAULT 'easyretail',
                      store_key VARCHAR(64) NOT NULL DEFAULT '',
                      model_id VARCHAR(32),
                      model_label VARCHAR(80),
                      external_id VARCHAR(120) NOT NULL,
                      receipt_at TIMESTAMPTZ NOT NULL,
                      amount_eur NUMERIC(12, 2),
                      is_void INTEGER NOT NULL DEFAULT 0,
                      raw_store VARCHAR(120),
                      created_at TIMESTAMPTZ DEFAULT NOW(),
                      CONSTRAINT uq_pos_receipts_source_store_external UNIQUE (source, store_key, external_id)
                    )
                    """
                )
            )
        for sql, label in (
            ("CREATE INDEX IF NOT EXISTS ix_pos_receipts_source ON pos_receipts (source)", "Index pos_receipts.source"),
            ("CREATE INDEX IF NOT EXISTS ix_pos_receipts_store_key ON pos_receipts (store_key)", "Index pos_receipts.store_key"),
            ("CREATE INDEX IF NOT EXISTS ix_pos_receipts_model_id ON pos_receipts (model_id)", "Index pos_receipts.model_id"),
            ("CREATE INDEX IF NOT EXISTS ix_pos_receipts_receipt_at ON pos_receipts (receipt_at)", "Index pos_receipts.receipt_at"),
            ("CREATE INDEX IF NOT EXISTS ix_pos_receipts_when_store ON pos_receipts (receipt_at, store_key)", "Index pos_receipts.when_store"),
            ("CREATE INDEX IF NOT EXISTS ix_pos_receipts_model_when ON pos_receipts (model_id, receipt_at)", "Index pos_receipts.model_when"),
        ):
            _safe_exec_sql(sql, label=label)
    except Exception as e:
        logger.warning("Impossibile verificare/creare pos_receipts: %s", e)


def _check_critical_schema_columns() -> None:
    """Warn if critical migration columns are missing (non-blocking)."""
    try:
        required = [
            ("staff_members", "hourly_rate", "20260519_staff_hourly_rate.sql"),
            ("staff_members", "section", "20260723_staff_member_section.sql"),
            ("staff_locale_packs", "sections_json", "20260723_staff_member_section.sql"),
            ("staff_payroll_months", "year_month", "20260524_staff_payroll_months.sql"),
            ("staff_stipendi_months", "year_month", "20260729_staff_stipendi_months.sql"),
            ("invoices", "ignored", "20260406_invoices_ignored_flag.sql"),
            ("cash_entries", "activity", "20260519_cash_entries_activity.sql"),
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
            ("supplier_order_items", "volume_liters", "20260710_supplier_order_items_volume_liters.sql"),
            ("suppliers", "phones_json", "20260712_supplier_multi_contacts.sql"),
            ("suppliers", "emails_json", "20260712_supplier_multi_contacts.sql"),
            ("suppliers", "cities_json", "20260712_supplier_multi_contacts.sql"),
            ("suppliers", "merchandise_categories_json", "20260712_supplier_multi_contacts.sql"),
        ]
        required_tables = [
            ("warehouse_movements", "20260710_warehouse_movements.sql"),
            ("supplier_payments_workbooks", "20260710_supplier_payments_workbook.sql"),
            ("staff_stipendi_months", "20260729_staff_stipendi_months.sql"),
            ("bank_accounts", "20260723_bank_module.sql"),
            ("bank_movements", "20260723_bank_module.sql"),
            ("carriers", "20260812_carriers.sql"),
            ("electronic_invoices", "20260812_electronic_invoices.sql"),
            ("pos_receipts", "20260816_pos_receipts.sql"),
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
        for table, migration in required_tables:
            try:
                if not insp.has_table(table):
                    missing.append((table, "(tabella)", migration))
            except Exception:
                missing.append((table, "(tabella)", migration))

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