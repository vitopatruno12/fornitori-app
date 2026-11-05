"""Sala Gazza condivisa: un tavolo non cancella l'altro, il pagato libera e tiene il contatore."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.gazza_sala_sheet import GazzaSalaSheet
from app.services import gazza_sala_service as sala


def _db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[GazzaSalaSheet.__table__])
    return sessionmaker(bind=engine)()


def test_due_camerieri_aggiornano_tavoli_diversi():
    db = _db()
    sala.save_table(
        db,
        "2026-11-05",
        "cena",
        {"table_id": 1, "status": "occupato", "reservation_name": "Rossi", "clients": "4", "waiter": "Luca"},
    )
    sheet = sala.save_table(
        db,
        "2026-11-05",
        "cena",
        {"table_id": 3, "status": "occupato", "reservation_name": "Bianchi", "clients": "2", "waiter": "Anna"},
    )
    by_id = {row["table_id"]: row for row in sheet["tables"]}
    assert by_id[1]["reservation_name"] == "Rossi"
    assert by_id[1]["waiter"] == "Luca"
    assert by_id[3]["reservation_name"] == "Bianchi"
    assert by_id[2]["status"] == "libero"
    assert len(sheet["tables"]) == 15


def test_pagato_libera_il_tavolo_e_somma_il_contatore():
    db = _db()
    sala.save_table(
        db,
        "2026-11-05",
        "pranzo",
        {
            "table_id": 4,
            "status": "conto",
            "reservation_name": "Verdi",
            "clients": "3",
            "waiter": "Marco",
            "paid": "42.50",
            "payment_type": "carta",
            "paid_total": "10",
        },
    )
    done = sala.mark_table_paid(db, "2026-11-05", "pranzo", 4)
    row = done["row"]
    assert row["status"] == "libero"
    assert row["reservation_name"] == ""
    assert row["paid"] == ""
    assert row["paid_total"] == "52.5"
    assert len(done["history"]) == 1
    assert done["history"][0]["reservation_name"] == "Verdi"
    assert done["history"][0]["paid"] == "42.5"
    assert done["history"][0]["payment_type"] == "carta"


def test_importa_solo_se_il_foglio_e_vuoto():
    db = _db()
    first = sala.import_if_empty(
        db,
        "2026-11-05",
        "cena",
        [{"table_id": 2, "status": "occupato", "reservation_name": "Neri"}],
        [],
    )
    assert first["imported"] is True
    second = sala.import_if_empty(
        db,
        "2026-11-05",
        "cena",
        [{"table_id": 2, "status": "occupato", "reservation_name": "Altro"}],
        [],
    )
    assert second["imported"] is False
    assert second["tables"][1]["reservation_name"] == "Neri"


def test_azzera_mantiene_lo_storico():
    db = _db()
    sala.save_table(db, "2026-11-05", "cena", {"table_id": 5, "status": "occupato", "paid": "8"})
    sala.mark_table_paid(db, "2026-11-05", "cena", 5)
    cleared = sala.reset_sheet(db, "2026-11-05", "cena")
    assert all(row["status"] == "libero" and row["paid_total"] == "" for row in cleared["tables"])
    assert len(cleared["history"]) == 1
