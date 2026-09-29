"""Score riconciliazione bonifico ↔ fattura (pagamenti ritardati)."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.banca_service import score_movement_invoice


def _inv(**kwargs):
  base = dict(
    id=1,
    invoice_number="FT-2026-0042",
    invoice_date=date(2026, 1, 10),
    due_date=date(2026, 3, 10),
    total=Decimal("1250.00"),
    amount_paid=Decimal("0"),
    supplier_name="Acme Forniture Srl",
    supplier_vat="01234567890",
  )
  base.update(kwargs)
  return SimpleNamespace(**base)


def _mov(**kwargs):
  base = dict(
    id=10,
    movement_type="uscita",
    amount=Decimal("1250.00"),
    movement_date=date(2026, 3, 12),
    description="Bonifico SEPA",
    causale="",
    counterparty="ACME FORNITURE SRL",
    notes="",
  )
  base.update(kwargs)
  return SimpleNamespace(**base)


def test_delayed_payment_amount_and_party_is_auto():
  inv = _inv()
  # Pagata ~2 mesi dopo la fattura, vicino alla scadenza
  mov = _mov(movement_date=date(2026, 3, 15))
  blob = f"{mov.description} {mov.causale} {mov.counterparty}"
  sc = score_movement_invoice(inv, mov, blob)
  assert sc["band"] == "auto"
  assert sc["breakdown"]["amount"] == 40
  assert sc["breakdown"]["party"] == 30


def test_delayed_payment_within_one_year_still_auto():
  inv = _inv(invoice_date=date(2026, 1, 10), due_date=None)
  mov = _mov(movement_date=date(2026, 10, 20))  # ~9 mesi dopo
  blob = f"{mov.description} {mov.counterparty}"
  sc = score_movement_invoice(inv, mov, blob)
  assert sc["band"] == "auto"
  assert sc["score"] >= 80


def test_amount_and_invoice_number_in_causale_is_auto():
  inv = _inv()
  mov = _mov(
    counterparty="",
    causale="Pagamento fattura FT-2026-0042",
    description="Bonifico a fornitore",
  )
  blob = f"{mov.description} {mov.causale}"
  sc = score_movement_invoice(inv, mov, blob)
  assert sc["band"] == "auto"
  assert sc["breakdown"]["number"] == 20
  assert sc["breakdown"]["amount"] == 40


def test_payment_before_invoice_not_auto():
  inv = _inv(invoice_date=date(2026, 6, 1))
  mov = _mov(movement_date=date(2026, 1, 1))
  blob = f"{mov.description} {mov.counterparty}"
  sc = score_movement_invoice(inv, mov, blob)
  assert sc["band"] != "auto"


def test_wrong_amount_not_auto_without_other_signals():
  inv = _inv()
  mov = _mov(amount=Decimal("999.00"), causale="Acme Forniture")
  blob = f"{mov.description} {mov.causale} {mov.counterparty}"
  sc = score_movement_invoice(inv, mov, blob)
  assert sc["band"] != "auto"


def test_entrata_score_zero():
  inv = _inv()
  mov = _mov(movement_type="entrata")
  sc = score_movement_invoice(inv, mov, "ACME")
  assert sc["score"] == 0
  assert sc["band"] == "review"
