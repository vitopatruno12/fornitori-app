from pathlib import Path

from app.routers.vne import (
    _parse_accettatore,
    _parse_cassette,
    _parse_hopper,
    _parse_stacker_banconote,
)

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "vne_stato_sample.html"
SAMPLE_HTML = FIXTURE.read_text(encoding="utf-8")


def test_parse_accettatore():
    acc = _parse_accettatore(SAMPLE_HTML)
    assert acc.presente == "Si"
    assert acc.errore == "No"
    assert "U(EUR5)-500" in (acc.firmware or "")


def test_parse_cassette():
    cassette = _parse_cassette(SAMPLE_HTML)
    assert len(cassette) == 1
    assert cassette[0]["cassetta"] == "1"
    assert cassette[0]["taglio_eur"] == "5.00"
    assert cassette[0]["banconote"] == "29"


def test_parse_stacker_banconote():
    items = _parse_stacker_banconote(SAMPLE_HTML)
    assert len(items) == 5
    assert items[0].taglio_eur == "5"
    assert items[0].quantita == 7
    assert items[-1].taglio_eur == "100"
    assert items[-1].quantita == 1


def test_parse_hopper_monete_and_units():
    hopper = _parse_hopper(SAMPLE_HTML)
    assert hopper.smart_hopper_1_eur == "373.30"
    assert "SH00041312579C01" in (hopper.firmware or "")
    assert len(hopper.monete) == 8
    assert hopper.monete[0].taglio_eur == "0.01"
    assert hopper.monete[0].quantita == 0
    assert hopper.monete[2].taglio_eur == "0.05"
    assert hopper.monete[2].quantita == 80
    assert len(hopper.units) == 1
    assert hopper.units[0].hopper == "1"
    assert hopper.units[0].presente == "Si"
