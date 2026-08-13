from datetime import datetime

from app.routers.vne import parse_vne_when_text, to_vne_day_date
from app.services.analytics_service import _intensity_to_operators, _slot_label


def test_to_vne_day_date():
    assert to_vne_day_date(datetime(2026, 7, 23).date()) == "23-07-2026 00:00"
    assert to_vne_day_date(datetime(2026, 7, 23).date(), end_of_day=True) == "23-07-2026 23:59"


def test_parse_vne_when_text_formats():
    assert parse_vne_when_text("23-07-2026 14:35") == datetime(2026, 7, 23, 14, 35)
    assert parse_vne_when_text("23/07/2026 09:00:00") == datetime(2026, 7, 23, 9, 0, 0)
    assert parse_vne_when_text("Operazione del: 01-01-2026 08:15") == datetime(2026, 1, 1, 8, 15)
    # Formato reale portale Risacca
    assert parse_vne_when_text("23/7/2026 alle 20:5:3") == datetime(2026, 7, 23, 20, 5, 3)
    assert parse_vne_when_text("23/07/2026 alle 20:05:03") == datetime(2026, 7, 23, 20, 5, 3)
    assert parse_vne_when_text("") is None
    assert parse_vne_when_text("—") is None


def test_slot_and_operators():
    assert _slot_label(12) == "12:00–13:00"
    assert _intensity_to_operators(90, 100) == 4
    assert _intensity_to_operators(10, 100) == 1
