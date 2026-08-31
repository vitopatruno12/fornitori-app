from decimal import Decimal

from app.services.pos_payment_classifier import classify_payment, merge_payment_fields


def test_classify_cash_only():
    ptype, cash, card = classify_payment(cash_amount=Decimal("12.50"))
    assert ptype == "cash"
    assert cash == Decimal("12.50")
    assert card is None


def test_classify_card_only():
    ptype, cash, card = classify_payment(card_amount=Decimal("9.00"))
    assert ptype == "card"
    assert cash is None
    assert card == Decimal("9.00")


def test_classify_mixed():
    ptype, cash, card = classify_payment(cash_amount=Decimal("5"), card_amount=Decimal("7"))
    assert ptype == "mixed"
    assert cash == Decimal("5.00")
    assert card == Decimal("7.00")


def test_classify_from_label():
    ptype, cash, card = classify_payment(total_amount=Decimal("18.50"), label="Bancomat")
    assert ptype == "card"
    assert card == Decimal("18.50")


def test_merge_payment_fields():
    merged = merge_payment_fields(
        {
            "amount_eur": Decimal("20.00"),
            "payment_label": "Contanti",
        }
    )
    assert merged["payment_type"] == "cash"
    assert merged["cash_amount_eur"] == Decimal("20.00")
