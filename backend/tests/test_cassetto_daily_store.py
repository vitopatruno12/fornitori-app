from datetime import date
from decimal import Decimal

from app.services.cassetto_daily_store import cassetto_amount, upsert_cassetto_days
from app.services.cash_closing_sync import _KIND_META


def test_cassetto_daily_store_roundtrip(tmp_path, monkeypatch):
    path = tmp_path / "cassetto_daily.json"
    monkeypatch.setenv("CASSETTO_DAILY_PATH", str(path))
    out = upsert_cassetto_days(
        model_id="model-4",
        days=[
            {
                "day": "2026-10-06",
                "amount_uscita": "45.50",
                "amount_net": "-45.50",
                "count": 2,
                "causali": ["LAVANDERIA", "SPESA"],
            }
        ],
    )
    assert out["saved"] == 1
    assert cassetto_amount("via_zanardelli", date(2026, 10, 6)) == Decimal("45.50")
    assert cassetto_amount("via_zanardelli", date(2026, 10, 5)) == Decimal("0.00")


def test_cassetto_kind_is_uscita_in_prima_nota():
    meta = _KIND_META["cassetto"]
    assert meta["conto"] == "MOVIMENTO_CASSETTO"
    assert meta.get("entry_type") == "uscita"
