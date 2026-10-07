from datetime import date
from decimal import Decimal

from app.services.cash_closing_sync import _paper_amounts
from app.services.paper_closing_overrides import (
    apply_paper_closing_daily,
    apply_paper_closing_hit,
    has_paper_override,
)


def test_zanardelli_5_oct_uses_lettura_operatore_cash_and_pos():
    cash, card, quote = _paper_amounts(
        "via_zanardelli",
        date(2026, 10, 5),
        Decimal("803.90"),
        Decimal("2312.35"),
        Decimal("831.87"),
    )
    assert cash == Decimal("1366.10")
    assert card == Decimal("2312.35")
    assert quote == Decimal("831.87")


def test_zanardelli_6_oct_uses_lettura_operatore_pos_senza_fatture():
    assert has_paper_override("via_zanardelli", date(2026, 10, 6))
    cash, card, quote = _paper_amounts(
        "via_zanardelli",
        date(2026, 10, 6),
        Decimal("1035.15"),
        Decimal("2016.77"),
        Decimal("538.72"),
    )
    assert cash == Decimal("1403.15")
    # BANCOMAT lettura 2016,77 − FATTURE 143,99 = POS elettronico 1872,78
    assert card == Decimal("1872.78")
    assert quote == Decimal("538.72")


def test_other_days_keep_agent_amounts():
    cash, card, quote = _paper_amounts(
        "via_zanardelli",
        date(2026, 10, 4),
        Decimal("100.00"),
        Decimal("200.00"),
        Decimal("30.00"),
    )
    assert cash == Decimal("100.00")
    assert card == Decimal("200.00")
    assert quote == Decimal("30.00")


def test_storico_zanardelli_6_oct_incasso_is_lettura_cash_plus_pos_senza_fatture():
    hit = apply_paper_closing_hit(
        "via_zanardelli",
        date(2026, 10, 6),
        {
            "cash_eur": Decimal("1035.15"),
            "card_eur": Decimal("2016.77"),
            "quote_eur": Decimal("538.72"),
            "invoice_eur": Decimal("0.00"),
            "incasso": Decimal("3051.92"),
        },
    )
    assert hit["cash_eur"] == Decimal("1403.15")
    assert hit["card_eur"] == Decimal("1872.78")
    assert hit["invoice_eur"] == Decimal("143.99")
    assert hit["incasso"] == Decimal("3275.93")
    assert hit.get("paper_closing") is True


def test_storico_other_days_keep_gdb_hit():
    original = {
        "cash_eur": Decimal("100.00"),
        "card_eur": Decimal("200.00"),
        "quote_eur": Decimal("30.00"),
        "incasso": Decimal("300.00"),
    }
    by_day = apply_paper_closing_daily("model-4", {date(2026, 10, 4): original})
    assert by_day[date(2026, 10, 4)] is original


def test_abba_6_oct_uses_lettura_operatore_contanti():
    assert has_paper_override("via_abba", date(2026, 10, 6))
    cash, card, quote = _paper_amounts(
        "via_abba",
        date(2026, 10, 6),
        Decimal("1800.00"),
        Decimal("2816.81"),
        Decimal("100.00"),
    )
    assert cash == Decimal("2216.99")
    assert card == Decimal("2816.81")
    assert quote == Decimal("100.00")


def test_storico_abba_6_oct_incasso_is_lettura_cash_plus_pos():
    hit = apply_paper_closing_hit(
        "via_abba",
        date(2026, 10, 6),
        {
            "cash_eur": Decimal("1800.00"),
            "card_eur": Decimal("2816.81"),
            "quote_eur": Decimal("100.00"),
            "invoice_eur": Decimal("0.00"),
            "incasso": Decimal("4616.81"),
        },
    )
    assert hit["cash_eur"] == Decimal("2216.99")
    assert hit["card_eur"] == Decimal("2816.81")
    assert hit["invoice_eur"] == Decimal("128.73")
    assert hit["incasso"] == Decimal("5033.80")
    assert hit.get("paper_closing") is True
