"""Sala Gazza condivisa: un tavolo non cancella l'altro, il pagato resta completo sul foglio."""

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


def test_pagato_lascia_i_dati_sul_foglio_e_somma_il_contatore():
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
            "invoice_number": "56",
            "waiter": "Marco",
            "paid": "42.50",
            "payment_type": "carta",
            "paid_total": "10",
        },
    )
    done = sala.mark_table_paid(db, "2026-11-05", "pranzo", 4)
    row = done["row"]
    assert row["status"] == "pagato"
    assert row["reservation_name"] == "Verdi"
    assert row["clients"] == "3"
    assert row["invoice_number"] == "56"
    assert row["waiter"] == "Marco"
    assert row["payment_type"] == "carta"
    assert row["paid"] == "42.5"
    assert row["paid_total"] == "52.5"
    assert len(done["history"]) == 1
    assert done["history"][0]["reservation_name"] == "Verdi"
    assert done["history"][0]["invoice_number"] == "56"
    assert done["history"][0]["paid"] == "42.5"
    assert done["history"][0]["payment_type"] == "carta"


def test_pagato_usa_i_dati_inviati_dal_palmare():
    db = _db()
    done = sala.mark_table_paid(
        db,
        "2026-11-06",
        "pranzo",
        1,
        {
            "table_id": 1,
            "status": "occupato",
            "reservation_name": "Rossi",
            "clients": "5",
            "invoice_number": "56",
            "waiter": "Erico",
            "payment_type": "contanti",
            "paid": "150",
            "paid_total": "0",
        },
    )
    row = done["row"]
    assert row["status"] == "pagato"
    assert row["reservation_name"] == "Rossi"
    assert row["clients"] == "5"
    assert row["invoice_number"] == "56"
    assert row["waiter"] == "Erico"
    assert row["payment_type"] == "contanti"
    assert row["paid"] == "150.0"
    assert row["paid_total"] == "150.0"
    assert done["tables"][2]["status"] == "libero"


def test_salvataggio_non_azzera_il_contatore():
    db = _db()
    sala.save_table(
        db,
        "2026-11-06",
        "pranzo",
        {"table_id": 1, "status": "pagato", "reservation_name": "Rossi", "paid": "150", "paid_total": "150"},
    )
    sheet = sala.save_table(
        db,
        "2026-11-06",
        "pranzo",
        {
            "table_id": 1,
            "status": "occupato",
            "reservation_name": "Calo",
            "clients": "4",
            "waiter": "Simone",
            "paid": "250",
            "payment_type": "carta",
            "paid_total": "",
        },
    )
    row = sheet["tables"][0]
    assert row["reservation_name"] == "Calo"
    assert row["paid_total"] == "150.0"
    done = sala.mark_table_paid(db, "2026-11-06", "pranzo", 1)
    assert done["row"]["reservation_name"] == "Calo"
    assert done["row"]["waiter"] == "Simone"
    assert done["row"]["paid"] == "250.0"
    assert done["row"]["paid_total"] == "400.0"
    assert done["row"]["status"] == "pagato"


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
