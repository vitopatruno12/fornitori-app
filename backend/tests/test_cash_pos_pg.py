"""POS PostePay di Gazza: entrata e uscita solo sul registro PG."""

from decimal import Decimal

from app.services.cash_service import COPERTI_CONTO, _is_extra_cassa, _normalize_cash_entry_payload


def test_pos_pg_tiene_uscita():
    payload = _normalize_cash_entry_payload(
        {"conto": "POS", "type": "uscita", "activity": "pg", "amount": "12.50"}
    )
    assert payload["type"] == "uscita"


def test_pos_pg_tiene_entrata():
    payload = _normalize_cash_entry_payload(
        {"conto": "POS", "type": "entrata", "activity": "pg", "amount": "40"}
    )
    assert payload["type"] == "entrata"


def test_pos_altre_sedi_resta_entrata():
    payload = _normalize_cash_entry_payload(
        {"conto": "POS", "type": "uscita", "activity": "via_lattea", "amount": "10"}
    )
    assert payload["type"] == "entrata"


def test_coperti_non_muove_la_cassa():
    assert _is_extra_cassa(COPERTI_CONTO)
    payload = _normalize_cash_entry_payload(
        {"conto": "COPERTI", "type": "uscita", "activity": "pg", "amount": "41.6"}
    )
    assert payload["type"] == "entrata"
    assert payload["amount"] == Decimal("42")
