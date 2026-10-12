from datetime import date
from decimal import Decimal

from app.services.cassetto_daily_store import (
    cassetto_amount,
    cassetto_detail_lines,
    cassetto_meta,
    cassetto_row_description,
    join_operation_parts,
    upsert_cassetto_days,
)
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


def test_descrizione_cassetto_tiene_il_testo_piu_lungo():
    text = join_operation_parts(
        "SPESA",
        "Comprato straccio",
        "Comprato straccio pagato Carlo",
        "operatore Carlo",
    )
    assert "Comprato straccio pagato Carlo" in text
    assert "Comprato straccio ·" not in text


def test_operazioni_complete_restano_nel_dettaglio(tmp_path, monkeypatch):
    path = tmp_path / "cassetto_daily.json"
    monkeypatch.setenv("CASSETTO_DAILY_PATH", str(path))
    upsert_cassetto_days(
        model_id="model-3",
        days=[
            {
                "day": "2026-10-11",
                "amount_uscita": "15.50",
                "amount_net": "-15.50",
                "count": 2,
                "causali": ["Comprato straccio pagato Carlo"],
                "operazioni": [
                    {
                        "ora": "09:12",
                        "verso": "uscita",
                        "importo": 12.5,
                        "testo": "Comprato straccio pagato Carlo",
                    },
                    {
                        "ora": "18:40",
                        "verso": "uscita",
                        "importo": 3,
                        "testo": "Caffè per il bancone",
                    },
                ],
            }
        ],
    )
    meta = cassetto_meta("via_lattea", date(2026, 10, 11))
    lines = cassetto_detail_lines(meta)
    assert cassetto_row_description(meta) == "Movimenti cassetto · 2 operazioni (A)"
    assert lines[0] == "09:12 · uscita · € 12,50 · Comprato straccio pagato Carlo"
    assert "Caffè per il bancone" in lines[1]
    upsert_cassetto_days(
        model_id="model-3",
        days=[
            {
                "day": "2026-10-11",
                "amount_uscita": "15.50",
                "amount_net": "-15.50",
                "count": 2,
                "causali": ["SPESA"],
            }
        ],
    )
    kept = cassetto_detail_lines(cassetto_meta("via_lattea", date(2026, 10, 11)))
    assert kept[0].endswith("Comprato straccio pagato Carlo")
