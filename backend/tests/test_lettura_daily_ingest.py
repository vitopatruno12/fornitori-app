from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

from app.routers.pos_receipts import LetturaIngestBody, LetturaDayBody, ingest_lettura_daily
from app.services.easyretail_gdb_service import lettura_includes_document, strip_total_mirror
from app.services.paper_closing_overrides import clamp_inflated_lettura
from app.services.cassetto_daily_store import cassetto_amount
from app.services.cash_closing_sync import _KIND_META
from app.services.paper_closing_overrides import (
    get_paper_override,
    is_seed_paper_day,
    paper_amounts,
)


def test_riga_totale_non_gonfia_i_contanti():
    # Scontrino tutto carta: la riga CONTANTI ripete il totale e va tolta.
    kept = strip_total_mirror(
        [
            (True, Decimal("100.00"), "contanti"),
            (False, Decimal("100.00"), "carta"),
        ],
        Decimal("100.00"),
    )
    assert [p for _, _, p in kept] == ["carta"]
    # Misto vero: 10 contanti + 20 carta = documento, si tengono entrambi.
    mixed = strip_total_mirror(
        [
            (True, Decimal("10.00"), "contanti"),
            (False, Decimal("20.00"), "carta"),
        ],
        Decimal("30.00"),
    )
    assert [p for _, _, p in mixed] == ["contanti", "carta"]


def test_lettura_8_ottobre_si_abbassa_al_valore_scontrini():
    # Via Lattea: POS = 2× carta + fatture, contanti ≈ incasso intero.
    cash, pos = clamp_inflated_lettura(
        Decimal("1116.58"),
        Decimal("1732.54"),
        cash=Decimal("306.49"),
        card=Decimal("857.45"),
    )
    assert cash == Decimal("306.49")
    assert pos == Decimal("857.45")
    # Zanardelli: il POS è circa il doppio; i contanti non sono l'incasso intero.
    cash_z, pos_z = clamp_inflated_lettura(
        Decimal("1805.40"),
        Decimal("3747.88"),
        cash=Decimal("571.45"),
        card=Decimal("1840.27"),
    )
    assert cash_z == Decimal("1805.40")
    assert pos_z == Decimal("1840.27")
    # Lettura operatore del 6 ottobre: il POS coincide con la carta, non si tocca.
    cash_ok, pos_ok = clamp_inflated_lettura(
        Decimal("2216.99"),
        Decimal("2688.08"),
        cash=Decimal("1183.49"),
        card=Decimal("2688.08"),
    )
    assert cash_ok == Decimal("2216.99")
    assert pos_ok == Decimal("2688.08")


def test_bil_gemello_non_gonfia_la_lettura():
    assert lettura_includes_document("VEN") is True
    assert lettura_includes_document("VEA") is True
    assert lettura_includes_document("") is True
    assert lettura_includes_document("BIL") is False
    assert lettura_includes_document("bil") is False


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


def test_seed_10_ottobre_zanardelli_from_carta():
    day = date(2026, 10, 10)
    z = get_paper_override("via_zanardelli", day)
    assert z["contanti"] == Decimal("1291.80")
    assert z["pos"] == Decimal("1125.56")
    assert z["fatture"] == Decimal("58.46")
    assert cassetto_amount("via_zanardelli", day) == Decimal("156.60")


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
