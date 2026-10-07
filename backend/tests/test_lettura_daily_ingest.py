from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

from app.routers.pos_receipts import LetturaIngestBody, LetturaDayBody, ingest_lettura_daily
from app.services.paper_closing_overrides import (
    get_paper_override,
    paper_amounts,
    upsert_paper_closing,
)


def test_upsert_lettura_split_nc_from_contanti(tmp_path, monkeypatch):
    """CONTANTI/POS solo scontrini; NC preventivi; FATTURE a parte (Zanardelli 7 ott)."""
    path = tmp_path / "paper_closings.json"
    monkeypatch.setenv("PAPER_CLOSINGS_PATH", str(path))
    day = date(2026, 10, 7)
    upsert_paper_closing(
        "via_zanardelli",
        day,
        contanti=776.85,
        pos=1702.62,
        fatture=80.00,
        nc=640.15,
    )
    ov = get_paper_override("via_zanardelli", day)
    assert ov["contanti"] == Decimal("776.85")
    assert ov["pos"] == Decimal("1702.62")
    assert ov["fatture"] == Decimal("80.00")
    assert ov["nc"] == Decimal("640.15")
    cash, card, quote = paper_amounts(
        "via_zanardelli",
        day,
        Decimal("100.00"),
        Decimal("200.00"),
        Decimal("30.00"),
    )
    assert cash == Decimal("776.85")
    assert card == Decimal("1702.62")
    assert quote == Decimal("640.15")


def test_ingest_lettura_daily_saves_nc(tmp_path, monkeypatch):
    path = tmp_path / "paper_closings.json"
    monkeypatch.setenv("PAPER_CLOSINGS_PATH", str(path))
    body = LetturaIngestBody(
        model_id="model-4",
        days=[
            LetturaDayBody(
                day="2026-10-07",
                contanti=776.85,
                bancomat=1750.32,
                pos=1702.62,
                fatture=80.0,
                nc=640.15,
            )
        ],
    )
    db = MagicMock()
    with patch(
        "app.services.cash_closing_sync.sync_daily_closings_to_prima_nota",
        return_value={"ok": True, "created": 4},
    ) as sync, patch(
        "app.services.agent_cassa_status.touch_agent_heartbeat",
        return_value={"ok": True},
    ):
        out = ingest_lettura_daily(body, db=db, _=None)
    assert out["ok"] is True
    assert out["saved"] == 1
    sync.assert_called_once()
    ov = get_paper_override("via_zanardelli", date(2026, 10, 7))
    assert ov["contanti"] == Decimal("776.85")
    assert ov["pos"] == Decimal("1702.62")
    assert ov["fatture"] == Decimal("80.00")
    assert ov["nc"] == Decimal("640.15")
