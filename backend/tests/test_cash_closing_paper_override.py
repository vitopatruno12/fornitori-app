from datetime import date
from decimal import Decimal

from app.services.cash_closing_sync import _paper_amounts


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
