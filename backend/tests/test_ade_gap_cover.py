from datetime import date

from app.services.ade_gap_cover import earliest_hole_start


def test_buco_di_aprile_non_si_ricontrolla_se_il_trimestre_e_pieno():
    counts = {
        "2026-01": 322,
        "2026-04": 3,
        "2026-05": 0,
        "2026-06": 7,
        "2026-07": 440,
        "2026-08": 573,
        "2026-09": 476,
    }
    assert earliest_hole_start(counts, today=date(2026, 10, 14)) is None


def test_gennaio_giugno_non_si_ricontrollano_se_luglio_settembre_sono_pieni():
    counts = {
        "2026-07": 64,
        "2026-08": 65,
        "2026-09": 57,
    }
    assert earliest_hole_start(counts, today=date(2026, 10, 14)) is None


def test_mese_vuoto_nel_trimestre_parte_da_quel_mese():
    counts = {
        "2026-07": 80,
        "2026-08": 2,
        "2026-09": 75,
    }
    assert earliest_hole_start(counts, today=date(2026, 10, 14)) == date(2026, 8, 1)


def test_trimestre_tutto_vuoto_parte_dal_primo_dei_tre_mesi():
    assert earliest_hole_start({}, today=date(2026, 10, 14)) == date(2026, 7, 1)
