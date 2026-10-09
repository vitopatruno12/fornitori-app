from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

from app.routers.pos_receipts import LetturaIngestBody, LetturaDayBody, ingest_lettura_daily
from app.services.cassetto_daily_store import cassetto_amount
from app.services.cash_closing_sync import _KIND_META
from app.services.paper_closing_overrides import (
    get_paper_override,
    is_seed_paper_day,
    paper_amounts,
)


def test_nc_is_entrata_in_prima_nota():
    assert _KIND_META["nc"].get("entry_type") == "entrata"


def test_seed_7_ottobre_zanardelli_matches_chiusura_plus_nc():
    day = date(2026, 10, 7)
    assert is_seed_paper_day("via_zanardelli", day)
    z = get_paper_override("via_zanardelli", day)
    assert z["contanti"] == Decimal("776.85")
    assert z["pos"] == Decimal("1702.62")
    assert z["fatture"] == Decimal("80.00")
    assert z["nc"] == Decimal("640.15")
    assert cassetto_amount("via_zanardelli", day) == Decimal("297.10")
    cash, card, quote = paper_amounts(
        "via_zanardelli", day, Decimal("0"), Decimal("0"), Decimal("0")
    )
    assert cash == Decimal("776.85")
    assert card == Decimal("1702.62")
    assert quote == Decimal("640.15")


def test_seed_abba_6_ottobre_pos_senza_fatture():
    a = get_paper_override("via_abba", date(2026, 10, 6))
    assert a["contanti"] == Decimal("2216.99")
    assert a["pos"] == Decimal("2688.08")
    assert a["fatture"] == Decimal("128.73")


def test_seed_day_not_overwritten_by_agent(tmp_path, monkeypatch):
    path = tmp_path / "paper_closings.json"
    monkeypatch.setenv("PAPER_CLOSINGS_PATH", str(path))
    body = LetturaIngestBody(
        model_id="model-4",
        days=[
            LetturaDayBody(
                day="2026-10-07",
                contanti=1.0,
                pos=2.0,
                fatture=3.0,
                nc=4.0,
            )
        ],
    )
    db = MagicMock()
    with patch(
        "app.services.cash_closing_sync.sync_daily_closings_to_prima_nota",
        return_value={"ok": True},
    ), patch(
        "app.services.agent_cassa_status.touch_agent_heartbeat",
        return_value={"ok": True},
    ):
        out = ingest_lettura_daily(body, db=db, _=None)
    assert out["ok"] is True
    ov = get_paper_override("via_zanardelli", date(2026, 10, 7))
    assert ov["contanti"] == Decimal("776.85")
    assert ov["nc"] == Decimal("640.15")
