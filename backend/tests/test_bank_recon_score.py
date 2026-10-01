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


def test_saldo_agosto_carcagni_paga_la_269_e_non_la_stornata():
  """Il bonifico BPPB è il saldo di agosto, non l'importo della sola 269/2026."""
  from app.services.banca_service import allocate_saldo_fatture

  supplier = "CARCAGNI' ANDREA"
  invoices = [
    _inv(id=1, invoice_number="235/2026", invoice_date=date(2026, 8, 3), supplier_name=supplier, total=Decimal("376.43")),
    _inv(id=2, invoice_number="269/2026", invoice_date=date(2026, 8, 31), supplier_name=supplier, total=Decimal("431.76")),
    _inv(id=3, invoice_number="269/BIS", invoice_date=date(2026, 8, 31), supplier_name=supplier, total=Decimal("100.00")),
    _inv(id=4, invoice_number="01/NC", invoice_date=date(2026, 8, 31), supplier_name=supplier, total=Decimal("376.43")),
    _inv(id=5, invoice_number="287/2026", invoice_date=date(2026, 9, 17), supplier_name=supplier, total=Decimal("154.96")),
  ]
  # 431.76 + 100.00 = 531.76 (235 stornata dalla NC)
  description = (
    "BONIFICO DA VOI DISPOSTO A FAVORE DI ANDREA CARCAGNI "
    "NOTE: saldo fatture agosto al netto della nc 01 del 31"
  )
  mov = _mov(
    id=1710,
    amount=Decimal("531.76"),
    movement_date=date(2026, 9, 18),
    counterparty="ANDREA CARCAGNI C. BENEF. IT42B0103016009000063203433 NOTE: saldo fatture",
    description=description,
    causale="",
  )
  fee = _mov(
    id=1711,
    amount=Decimal("0.40"),
    movement_date=date(2026, 9, 18),
    counterparty=mov.counterparty,
    description=description,
  )
  blob = f"{description} {mov.counterparty}"
  meta = [
    {"mov": mov, "blob": blob, "out": {}},
    {"mov": fee, "blob": blob, "out": {}},
  ]
  allocated = allocate_saldo_fatture(invoices, meta)
  assert set(allocated) == {2, 3}
  assert allocated[2]["month_label"] == "agosto"
  assert allocated[2]["meta"]["mov"].id == 1710


def test_extract_invoice_numbers_listed_in_bonifico():
  from app.services.banca_service import extract_invoice_refs

  quoted = (
    "BONIFICO A FAVORE DI RISTORALL S.R.L.U. "
    "NOTE: SALDO FT '8947/01' '7684/01' '7505/01' ADDEBITO BONIFICO"
  )
  assert extract_invoice_refs(quoted) == ["8947/01", "7684/01", "7505/01"]
  dashed = "NOTE: saldo ft 4952-4953-5314 VOSTRA DISPOSIZIONE"
  assert extract_invoice_refs(dashed) == ["4952", "4953", "5314"]
  assert extract_invoice_refs("NOTE: saldo fatture agosto") == []
  assert extract_invoice_refs("NOTE: SALDO FATTURE DAL 17 AL 31 LUGLIO") == []
  assert extract_invoice_refs("NOTE: SALDO FATTURE DA 01 LUGLIO 20") == []
  assert extract_invoice_refs("NOTE: SALDO FATTURE DA 01 LUGLIO 202 6 A 16 LUGLIO") == []
  assert extract_invoice_refs("NOTE: SALDO FATTURA 74 DEL 21 SETTEMBRE") == ["74"]


def test_cited_invoices_attach_when_sum_matches_wire():
  from app.services.banca_service import allocate_cited_invoices

  invoices = [
    _inv(id=1, invoice_number="8947/01", supplier_name="RISTORALL S.R.L.U.", total=Decimal("926.30")),
    _inv(id=2, invoice_number="7684/01", supplier_name="RISTORALL S.R.L.U.", total=Decimal("940.38")),
    _inv(id=3, invoice_number="7505/01", supplier_name="RISTORALL S.R.L.U.", total=Decimal("82.38")),
    _inv(id=4, invoice_number="4952/Vendite", supplier_name="FRAGRANZE MEDITERRANEE SRL", total=Decimal("134.13")),
    _inv(id=5, invoice_number="4953/Vendite", supplier_name="FRAGRANZE MEDITERRANEE SRL", total=Decimal("440.22")),
    _inv(id=6, invoice_number="5314/Vendite", supplier_name="FRAGRANZE MEDITERRANEE SRL", total=Decimal("357.56")),
  ]
  ristorall = _mov(
    id=20,
    amount=Decimal("1949.06"),
    counterparty="RISTORALL S.R.L.U.",
    description="NOTE: SALDO FT '8947/01' '7684/01' '7505/01'",
  )
  fragranze = _mov(
    id=21,
    amount=Decimal("931.91"),
    counterparty="FRAGRANZE MEDITERRANEE SRL",
    description="NOTE: saldo ft 4952-4953-5314",
  )
  fee = _mov(id=22, amount=Decimal("0.40"), counterparty=ristorall.counterparty, description=ristorall.description)
  meta = []
  for mov in (ristorall, fragranze, fee):
    blob = f"{mov.description} {mov.counterparty}"
    meta.append({"mov": mov, "blob": blob, "out": {}})
  allocated = allocate_cited_invoices(invoices, meta)
  assert set(allocated) == {1, 2, 3, 4, 5, 6}
  assert allocated[1]["cited"] is True
  assert allocated[4]["meta"]["mov"].id == 21


def test_truncated_invoice_list_is_not_attached():
  from app.services.banca_service import allocate_cited_invoices

  invoices = [
    _inv(id=1, invoice_number="2180/10/2026", supplier_name="GI.MA. CHEESE SRL", total=Decimal("165.00")),
    _inv(id=2, invoice_number="2181/10/2026", supplier_name="GI.MA. CHEESE SRL", total=Decimal("541.55")),
  ]
  mov = _mov(
    id=30,
    amount=Decimal("1867.98"),
    counterparty="GI.MA. CHEESE S.R.L.",
    description="NOTE: saldo ft '2181/10/2026' '2061/10/20",
  )
  blob = f"{mov.description} {mov.counterparty}"
  allocated = allocate_cited_invoices(invoices, [{"mov": mov, "blob": blob, "out": {}}])
  assert allocated == {}


def test_group_wire_does_not_cover_unnamed_invoice():
  from app.services.banca_service import invoice_named_on_group_wire

  mov = _mov(
    id=50,
    amount=Decimal("1949.06"),
    movement_date=date(2026, 9, 28),
    counterparty="RISTORALL S.R.L.U.",
    description="NOTE: SALDO FT '8947/01' '7684/01' '7505/01'",
    reconciliation_status="matched",
    matched_invoice_id=None,
  )
  blob = f"{mov.description} {mov.counterparty}"
  cited = _inv(id=1, invoice_number="8947/01", supplier_name="RISTORALL S.R.L.U.", total=Decimal("926.30"))
  other = _inv(id=2, invoice_number="10200/01", supplier_name="RISTORALL S.R.L.U.", total=Decimal("134.53"))
  assert invoice_named_on_group_wire(cited, mov, blob) is True
  assert invoice_named_on_group_wire(other, mov, blob) is False


def test_fr_eva_abbreviation_aligns():
  from app.services.banca_service import _party_names_align

  assert _party_names_align("FR. E VA. SRL", "FR. E VA. SRL C. BENEF. IT20O0860316000000000312477")


def test_saldo_ft_agosto_senza_la_parola_fatture():
  from app.services.banca_service import allocate_saldo_fatture

  invoices = [
    _inv(id=1, invoice_number="100", invoice_date=date(2026, 8, 2), supplier_name="DICIANNOVE ZERO SETTE SRLS", total=Decimal("10.00")),
    _inv(id=2, invoice_number="101", invoice_date=date(2026, 8, 3), supplier_name="DICIANNOVE ZERO SETTE SRLS", total=Decimal("15.00")),
  ]
  mov = _mov(
    id=40,
    amount=Decimal("25.00"),
    movement_date=date(2026, 9, 2),
    counterparty="DICIANNOVE ZERO SETTE S.R.L.S.",
    description="NOTE: SALDO FT AGOSTO",
  )
  blob = f"{mov.description} {mov.counterparty}"
  allocated = allocate_saldo_fatture(invoices, [{"mov": mov, "blob": blob, "out": {}}])
  assert set(allocated) == {1, 2}


def test_number_range_in_causale_when_sum_matches():
  from app.services.banca_service import allocate_number_ranges

  invoices = [
    _inv(id=1, invoice_number="7905", supplier_name="INTERNATIONAL FRUIT SRL", total=Decimal("10.00")),
    _inv(id=2, invoice_number="8200", supplier_name="INTERNATIONAL FRUIT SRL", total=Decimal("15.50")),
    _inv(id=3, invoice_number="9000", supplier_name="INTERNATIONAL FRUIT SRL", total=Decimal("99.00")),
  ]
  mov = _mov(
    id=41,
    amount=Decimal("25.50"),
    counterparty="INTERNATIONAL FRUIT SRL",
    description="NOTE: SALDO FT DALLA N 7905 ALLA N 8764",
  )
  blob = f"{mov.description} {mov.counterparty}"
  allocated = allocate_number_ranges(invoices, [{"mov": mov, "blob": blob, "out": {}}])
  assert set(allocated) == {1, 2}


def test_saldo_agosto_unisce_due_societa_se_la_somma_quadra():
  from app.services.banca_service import allocate_saldo_fatture

  invoices = [
    _inv(id=1, invoice_number="A1", invoice_date=date(2026, 8, 2), supplier_name="FR. E VA. SRL", total=Decimal("100.00"), company="mediazione_a"),
    _inv(id=2, invoice_number="A2", invoice_date=date(2026, 8, 3), supplier_name="FR. E VA. SRL", total=Decimal("50.00"), company="mediazione_a"),
    _inv(id=3, invoice_number="Z1", invoice_date=date(2026, 8, 4), supplier_name="FR. E VA. SRL", total=Decimal("80.00"), company="mediazione_z"),
    _inv(id=4, invoice_number="Z2", invoice_date=date(2026, 8, 5), supplier_name="FR. E VA. SRL", total=Decimal("20.00"), company="mediazione_z"),
  ]
  mov = _mov(
    id=711,
    amount=Decimal("250.00"),
    movement_date=date(2026, 9, 11),
    counterparty="FR. E VA. SRL",
    description="NOTE: saldo fatture agosto",
  )
  blob = f"{mov.description} {mov.counterparty}"
  allocated = allocate_saldo_fatture(invoices, [{"mov": mov, "blob": blob, "out": {}}])
  assert set(allocated) == {1, 2, 3, 4}


def test_acconto_cita_la_fattura_e_lascia_il_residuo():
  from app.services.banca_service import _apply_acconto_state, allocate_acconti

  invoice = _inv(
    id=11,
    invoice_number="269/2026",
    total=Decimal("1000.00"),
    supplier_name="CARCAGNI ANDREA",
  )
  first = _mov(
    id=1,
    amount=Decimal("400.00"),
    movement_date=date(2026, 9, 17),
    counterparty="ANDREA CARCAGNI",
    description="ACCONTO FATTURA 269/2026",
  )
  second = _mov(
    id=2,
    amount=Decimal("600.00"),
    movement_date=date(2026, 10, 2),
    counterparty="ANDREA CARCAGNI",
    description="SALDO FATTURA 269/2026",
  )
  other = _mov(
    id=3,
    amount=Decimal("400.00"),
    movement_date=date(2026, 9, 18),
    counterparty="ANDREA CARCAGNI",
    description="PAGAMENTO FORNITORE",
  )
  metas = [
    {"mov": first, "blob": f"{first.description} {first.counterparty}"},
    {"mov": second, "blob": f"{second.description} {second.counterparty}"},
    {"mov": other, "blob": f"{other.description} {other.counterparty}"},
  ]
  partial = allocate_acconti([invoice], [metas[0], metas[2]])
  assert set(partial) == {11}
  assert partial[11]["settled"] is False
  assert partial[11]["residuo"] == Decimal("600.00")
  row = SimpleNamespace(id=11, invoice_number="269/2026", total=Decimal("1000.00"), amount_paid=Decimal("0"), is_paid=False, note="Nota interna")
  assert _apply_acconto_state(row, partial[11]) is False
  assert row.is_paid is False
  assert row.amount_paid == Decimal("400.00")
  assert "Residuo da saldare" in row.note
  assert "Nota interna" in row.note

  settled = allocate_acconti([invoice], metas)
  assert settled[11]["settled"] is True
  assert _apply_acconto_state(row, settled[11]) is True
  assert row.is_paid is True
  assert row.amount_paid == Decimal("1000.00")
  assert "saldata" in row.note


def test_bundle_trova_combinazione_che_il_greedy_perdeva():
  """Bonifico = 4 fatture non contigue: il greedy sui più vecchi falliva."""
  from app.services.banca_service import allocate_supplier_bundles, _subset_sum_invoices

  supplier = "ACME FORNITURE SRL"
  invoices = [
    _inv(id=1, invoice_number="1", invoice_date=date(2026, 1, 1), supplier_name=supplier, total=Decimal("10.00")),
    _inv(id=2, invoice_number="2", invoice_date=date(2026, 1, 2), supplier_name=supplier, total=Decimal("20.00")),
    _inv(id=3, invoice_number="3", invoice_date=date(2026, 1, 3), supplier_name=supplier, total=Decimal("30.00")),
    _inv(id=4, invoice_number="4", invoice_date=date(2026, 1, 4), supplier_name=supplier, total=Decimal("40.00")),
    _inv(id=5, invoice_number="5", invoice_date=date(2026, 1, 5), supplier_name=supplier, total=Decimal("100.00")),
  ]
  # 10+30+40=80 — greedy prende 10+20+30=60 poi +40=100 e non trova 80
  chosen = _subset_sum_invoices(invoices, Decimal("80.00"), max_items=6)
  assert chosen is not None
  assert {inv.id for inv in chosen} == {1, 3, 4}

  mov = _mov(
    id=99,
    amount=Decimal("80.00"),
    counterparty=supplier,
    movement_date=date(2026, 2, 1),
    description="Bonifico SEPA",
    causale="",
  )
  allocated = allocate_supplier_bundles(invoices, [{"mov": mov, "blob": supplier, "out": {}}])
  assert set(allocated) == {1, 3, 4}
  assert allocated[1]["bundle"] is True
  assert allocated[1]["bundle_size"] == 3


def test_bundle_preferisce_blocco_consecutivo():
  from app.services.banca_service import _subset_sum_invoices

  supplier = "BETA SPA"
  invoices = [
    _inv(id=1, invoice_number="1", invoice_date=date(2026, 3, 1), supplier_name=supplier, total=Decimal("50.00")),
    _inv(id=2, invoice_number="2", invoice_date=date(2026, 3, 2), supplier_name=supplier, total=Decimal("50.00")),
    _inv(id=3, invoice_number="3", invoice_date=date(2026, 5, 1), supplier_name=supplier, total=Decimal("50.00")),
    _inv(id=4, invoice_number="4", invoice_date=date(2026, 5, 2), supplier_name=supplier, total=Decimal("50.00")),
  ]
  # Due coppie da 100: preferisce quella consecutiva più stretta (marzo o maggio — stesso span 1g)
  # Con span uguale e entrambe contigue → ambigue → None
  assert _subset_sum_invoices(invoices, Decimal("100.00")) is None

  # Solo una coppia consecutiva unica se le altre non sommano
  invoices2 = [
    _inv(id=1, invoice_number="1", invoice_date=date(2026, 3, 1), supplier_name=supplier, total=Decimal("40.00")),
    _inv(id=2, invoice_number="2", invoice_date=date(2026, 3, 2), supplier_name=supplier, total=Decimal("60.00")),
    _inv(id=3, invoice_number="3", invoice_date=date(2026, 5, 1), supplier_name=supplier, total=Decimal("30.00")),
    _inv(id=4, invoice_number="4", invoice_date=date(2026, 8, 1), supplier_name=supplier, total=Decimal("70.00")),
  ]
  # 40+60=100 (contigui) e 30+70=100 (non contigui) → preferisce marzo
  chosen = _subset_sum_invoices(invoices2, Decimal("100.00"))
  assert {inv.id for inv in chosen} == {1, 2}


def test_bundle_ambiguo_due_coppie_uguali_non_assegna():
  from app.services.banca_service import allocate_supplier_bundles, _subset_sum_invoices

  supplier = "GAMMA SRL"
  invoices = [
    _inv(id=1, invoice_number="1", invoice_date=date(2026, 1, 1), supplier_name=supplier, total=Decimal("100.00")),
    _inv(id=2, invoice_number="2", invoice_date=date(2026, 6, 1), supplier_name=supplier, total=Decimal("100.00")),
  ]
  # Una sola coppia → ok
  mov = _mov(id=1, amount=Decimal("200.00"), counterparty=supplier, movement_date=date(2026, 7, 1))
  assert set(allocate_supplier_bundles(invoices, [{"mov": mov, "blob": supplier, "out": {}}])) == {1, 2}

  # Due blocchi contigui con lo stesso span (1 giorno) → ambigui, non auto
  invoices3 = [
    _inv(id=1, invoice_number="1", invoice_date=date(2026, 1, 1), supplier_name=supplier, total=Decimal("100.00")),
    _inv(id=2, invoice_number="2", invoice_date=date(2026, 1, 2), supplier_name=supplier, total=Decimal("100.00")),
    _inv(id=3, invoice_number="3", invoice_date=date(2026, 6, 1), supplier_name=supplier, total=Decimal("100.00")),
    _inv(id=4, invoice_number="4", invoice_date=date(2026, 6, 2), supplier_name=supplier, total=Decimal("100.00")),
  ]
  assert _subset_sum_invoices(invoices3, Decimal("200.00")) is None
  mov2 = _mov(id=2, amount=Decimal("200.00"), counterparty=supplier, movement_date=date(2026, 8, 1))
  assert allocate_supplier_bundles(invoices3, [{"mov": mov2, "blob": supplier, "out": {}}]) == {}


def test_entrata_score_zero():
  inv = _inv()
  mov = _mov(movement_type="entrata")
  sc = score_movement_invoice(inv, mov, "ACME")
  assert sc["score"] == 0
  assert sc["band"] == "review"


def test_auto_match_resta_nella_finestra_importo():
  """Lo score auto non deve perdersi quando si guardano solo i bonifici vicini di importo."""
  from app.services.banca_service import (
    _index_uscita_by_amount,
    _invoice_amount_targets,
    _uscita_near_targets,
  )

  inv = _inv(total=Decimal("852.00"), supplier_name="PATRUNO VITO", invoice_date=date(2026, 9, 15))
  movements = []
  for i, amt in enumerate(
    [
      Decimal("852.00"),
      Decimal("850.50"),
      Decimal("400.00"),
      Decimal("0.40"),
    ],
    start=1,
  ):
    mov = _mov(
      id=i,
      amount=amt,
      counterparty="PATRUNO VITO",
      movement_date=date(2026, 9, 29),
    )
    movements.append({"mov": mov, "blob": f"Bonifico {mov.counterparty}"})
  index = _index_uscita_by_amount(movements)
  near_ids = {m["mov"].id for m in _uscita_near_targets(index, _invoice_amount_targets(inv))}
  auto_ids = set()
  for meta in movements:
    if score_movement_invoice(inv, meta["mov"], meta["blob"])["band"] == "auto":
      auto_ids.add(meta["mov"].id)
  assert auto_ids
  assert auto_ids <= near_ids
  assert 1 in auto_ids
  assert 4 not in near_ids
  assert 3 not in near_ids


def test_proposta_include_acconto_e_non_importi_lontani():
  from app.services.banca_service import (
    _index_open_invoices_by_amount,
    _open_invoices_near_amount,
  )

  partial = _inv(id=7, total=Decimal("200.00"), payment_status="unpaid")
  far = _inv(id=8, total=Decimal("900.00"), payment_status="unpaid")
  indexed = _index_open_invoices_by_amount([partial, far])
  ids = {inv.id for inv in _open_invoices_near_amount(indexed, Decimal("100.00"))}
  assert 7 in ids
  assert 8 not in ids


def test_linked_invoices_note_roundtrip():
  from app.services.banca_service import (
    _parse_linked_invoices_note,
    _set_linked_invoices_note,
  )

  mov = _mov(notes="nota libera")
  _set_linked_invoices_note(mov, ["8947/01", "7684/01", "8947/01"], reason="saldo cumulativo")
  assert "fatture collegate" in (mov.notes or "")
  assert "nota libera" in (mov.notes or "")
  nums = _parse_linked_invoices_note(mov.notes)
  assert nums == ["8947/01", "7684/01"]
  _set_linked_invoices_note(mov, ["100/01", "200/01"], reason="bundle fornitore")
  assert _parse_linked_invoices_note(mov.notes) == ["100/01", "200/01"]
  assert "nota libera" in (mov.notes or "")


def test_build_linked_invoices_from_causale_and_note():
  from app.services.banca_service import (
    _build_linked_invoices,
    _normalize_doc_token,
    _set_linked_invoices_note,
  )

  inv_a = _inv(id=1, invoice_number="8947/01", supplier_name="Fornitore A", supplier_id=1)
  inv_b = _inv(id=2, invoice_number="7684/01", supplier_name="Fornitore A", supplier_id=1)
  by_norm = {
    _normalize_doc_token(inv_a.invoice_number): inv_a,
    _normalize_doc_token(inv_b.invoice_number): inv_b,
  }
  mov = _mov(
    causale="SALDO FT '8947/01' '7684/01'",
    description="Bonifico SEPA SALDO FT",
    matched_invoice_id=None,
  )
  linked = _build_linked_invoices(mov, invoices_by_norm=by_norm, suppliers_by_id={1: "Fornitore A"})
  nums = {x["invoice_number"] for x in linked}
  assert "8947/01" in nums
  assert "7684/01" in nums

  mov2 = _mov(causale="Bonifico generico", description="BONIFICO DISPOSTO")
  _set_linked_invoices_note(mov2, ["8947/01", "7684/01"], reason="saldo cumulativo")
  linked2 = _build_linked_invoices(mov2, invoices_by_norm=by_norm, suppliers_by_id={1: "Fornitore A"})
  assert [x["invoice_number"] for x in linked2] == ["8947/01", "7684/01"]
