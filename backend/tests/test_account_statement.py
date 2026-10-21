from datetime import date

from app.services.banca_service import build_statement_rows


def test_estratto_parte_dal_saldo_contabile_e_tiene_fuori_i_giorni_dopo():
    rows = build_statement_rows(
        [
            {"id": 1, "movement_date": date(2026, 10, 1), "movement_type": "entrata", "amount": 100, "description": "Incasso", "counterparty": "A"},
            {"id": 2, "movement_date": date(2026, 10, 2), "movement_type": "uscita", "amount": 40, "description": "Pagamento", "counterparty": "B"},
            {"id": 3, "movement_date": date(2026, 10, 20), "movement_type": "uscita", "amount": 10, "description": "Dopo", "counterparty": "C"},
        ],
        current_balance=150,
        date_to=date(2026, 10, 15),
    )
    assert rows["saldo_iniziale"] == 100
    assert rows["saldo_finale"] == 160
    assert rows["entrate"] == 100
    assert rows["uscite"] == 40
    assert [line["saldo"] for line in rows["lines"]] == [200, 160]
