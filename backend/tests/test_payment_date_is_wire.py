"""DATA PAGAMENTO è la data del bonifico. Contanti solo se la cella lo scrive."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.banca_service import _pick_wire_on_payment_date
from app.services.supplier_payments_service import parse_file_payment_date, payment_cell_kind


def test_una_data_non_e_contanti():
    assert payment_cell_kind("12/10/2026") == "data"
    assert payment_cell_kind("2026-07-07") == "data"
    assert payment_cell_kind("07-07-2026") == "data"
    assert parse_file_payment_date("12/10/2026") == date(2026, 10, 12)
    assert payment_cell_kind("CONTANTI") == "contanti"
    assert payment_cell_kind("pagato in contanti") == "contanti"
    assert payment_cell_kind("CARTA") == "carta"
    assert payment_cell_kind("") == "vuoto"


def test_estratto_del_giorno_prende_il_bonifico_che_cita_la_fattura():
    fee = {
        "mov": SimpleNamespace(id=1, amount=Decimal("0.40")),
        "blob": "COMMISSIONE TOMMASI FATTURA 1551",
    }
    wire = {
        "mov": SimpleNamespace(id=2, amount=Decimal("899")),
        "blob": "BONIFICO A FAVORE DI TOMMASI FATTURA 1314 1551",
    }
    other = {
        "mov": SimpleNamespace(id=3, amount=Decimal("465")),
        "blob": "ALTRO FORNITORE FATTURA 9999",
    }
    hit = _pick_wire_on_payment_date(
        [fee, other, wire],
        invoice_number="1551",
        supplier_name="AVICUNICOLA DI TOMMASI LUIGI",
        amount=Decimal("465"),
    )
    assert hit is not None
    assert hit["mov"].id == 2
