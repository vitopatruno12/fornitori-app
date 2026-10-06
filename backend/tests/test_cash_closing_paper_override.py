from datetime import date
from decimal import Decimal

from app.services.cash_closing_sync import _paper_amounts
from app.services.paper_closing_overrides import apply_paper_closing_daily, apply_paper_closing_hit


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


def test_storico_zanardelli_5_oct_incasso_is_cash_plus_pos_from_lettura():
    hit = apply_paper_closing_hit(
        "via_zanardelli",
        date(2026, 10, 5),
        {"cash_eur": Decimal("803.90"), "card_eur": Decimal("2312.35"), "quote_eur": Decimal("831.87"), "incasso": Decimal("3116.25")},
    )
    assert hit["cash_eur"] == Decimal("1366.10")
    assert hit["card_eur"] == Decimal("2312.35")
    assert hit["quote_eur"] == Decimal("831.87")
    assert hit["incasso"] == Decimal("3678.45")


def test_storico_other_days_keep_gdb_hit():
    original = {"cash_eur": Decimal("100.00"), "card_eur": Decimal("200.00"), "quote_eur": Decimal("30.00"), "incasso": Decimal("300.00")}
    by_day = apply_paper_closing_daily("model-4", {date(2026, 10, 4): original})
    assert by_day[date(2026, 10, 4)] is original



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
