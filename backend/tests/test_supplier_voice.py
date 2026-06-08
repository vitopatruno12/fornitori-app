from app.services.ai_heuristics import (
    suggest_supplier_fields,
    supplier_heuristics_usable,
    supplier_instant_path_ok,
)


def test_supplier_voice_full_phrase():
    r = suggest_supplier_fields(
        "Bar Roma partita IVA 12345678901 email info@bar.it telefono 0801234567 categoria ortofrutta bonifico 30 giorni"
    )
    sf = r["suggested_fields"]
    assert sf["name"] == "Bar Roma"
    assert sf["vat_number"] == "12345678901"
    assert sf["email"] == "info@bar.it"
    assert "080" in sf["phone"]
    assert supplier_heuristics_usable(r)


def test_supplier_ragione_sociale_prefix():
    r = suggest_supplier_fields("ragione sociale Frutta Siciliana, P.IVA 01234567890")
    assert r["suggested_fields"]["name"] == "Frutta Siciliana"


def test_supplier_instant_path_typical_voice():
    r = suggest_supplier_fields(
        "Bar Roma partita IVA 12345678901 email info@bar.it tel 0801234567"
    )
    assert supplier_instant_path_ok(r, "Bar Roma partita IVA 12345678901 email info@bar.it tel 0801234567")


def test_partita_iva_spaced_and_codice_fiscale():
    t = "Bar Roma partita iva 1 2 3 4 5 6 7 8 9 0 1 codice fiscale RSSMRA80A01H501U"
    r = suggest_supplier_fields(t)
    sf = r["suggested_fields"]
    assert sf["vat_number"] == "12345678901"
    assert sf["fiscal_code"] == "RSSMRA80A01H501U"
    assert sf["name"] == "Bar Roma"


def test_partita_iva_without_blocking_iva_word():
    t = "fornitore Acme partita iva 01234567890 email a@b.it"
    r = suggest_supplier_fields(t)
    assert r["suggested_fields"]["vat_number"] == "01234567890"


def test_fornitore_with_referente_nome():
    r = suggest_supplier_fields("fornitore Bar Peroni nome Georgio Rossi")
    sf = r["suggested_fields"]
    assert sf["name"] == "Bar Peroni"
    assert sf.get("contact_person") == "Georgio Rossi"


def test_supplier_name_not_whole_phrase():
    r = suggest_supplier_fields("Bar Roma 12345678901 email info@bar.it tel 0801234567")
    sf = r["suggested_fields"]
    assert sf["name"] == "Bar Roma"
    assert sf["vat_number"] == "12345678901"
    assert sf["email"] == "info@bar.it"
    assert "080" in sf["phone"]
    assert "12345678901" not in sf["name"]
    assert "@" not in sf["name"]


def test_partita_iva_spoken_italian_digits():
    t = "Bar Peroni partita iva uno due tre quattro cinque sei sette otto nove zero uno"
    r = suggest_supplier_fields(t)
    assert r["suggested_fields"]["vat_number"] == "12345678901"
    assert r["suggested_fields"]["name"] == "Bar Peroni"


def test_partita_iva_iva_solo_label():
    r = suggest_supplier_fields("fornitore Acme iva 01234567890 email a@b.it")
    assert r["suggested_fields"]["vat_number"] == "01234567890"


def test_partita_iva_it_prefix():
    r = suggest_supplier_fields("Bar Roma partita IVA IT12345678901")
    assert r["suggested_fields"]["vat_number"] == "12345678901"


def test_referente_citta_categoria_listino_note_pagamento_separati():
    t = (
        "fornitore Bar Peroni referente Georgio Rossi città Lecce "
        "categoria ortofrutta listino associato Listino 2024 "
        "note interne cliente storico condizioni di pagamento bonifico 30 giorni"
    )
    r = suggest_supplier_fields(t)
    sf = r["suggested_fields"]
    assert sf["name"] == "Bar Peroni"
    assert sf["contact_person"] == "Georgio Rossi"
    assert sf["city"] == "Lecce"
    assert sf["merchandise_category"] == "Ortofrutta"
    assert sf["price_list_label"] == "Listino 2024"
    assert sf["notes"] == "cliente storico"
    assert "listino" not in sf["contact_person"].lower()
    assert "listino" not in sf.get("merchandise_category", "").lower()
    assert "note" not in sf.get("payment_terms", "").lower()
    assert "30" in sf["payment_terms"]


def test_ragione_sociale_solo_nome_senza_partita_iva():
    from app.services.ai_heuristics import _sanitize_supplier_suggested_fields

    t = "Bar Roma partita IVA 12345678901 email info@bar.it tel 0801234567"
    r = suggest_supplier_fields(t)
    assert r["suggested_fields"]["name"] == "Bar Roma"
    assert "partita" not in r["suggested_fields"]["name"].lower()
    assert "12345678901" not in r["suggested_fields"]["name"]

    dirty = {"name": "Bar Roma partita IVA 12345678901 email info@bar.it"}
    sf = _sanitize_supplier_suggested_fields(dirty, t)
    assert sf["name"] == "Bar Roma"


def test_categoria_senza_listino_nel_valore():
    from app.services.ai_heuristics import _sanitize_supplier_suggested_fields

    t = "categoria ortofrutta listino associato Listino 2024"
    dirty = {"merchandise_category": "ortofrutta listino associato Listino 2024", "price_list_label": ""}
    sf = _sanitize_supplier_suggested_fields(dirty, t)
    assert sf["merchandise_category"] == "Ortofrutta"
    assert sf["price_list_label"] == "Listino 2024"
    assert "listino" not in sf["merchandise_category"].lower()


def test_expand_order_single_line_multiple_products():
    from app.services.ai_heuristics import coalesce_order_ai_response

    r = coalesce_order_ai_response(
        {
            "suggested_lines": [
                {"product_description": "10 arance 5 kg pasta 3 carciofi", "pieces": 10, "weight_kg": None},
            ],
        }
    )
    lines = r["suggested_lines"]
    assert len(lines) >= 3
    assert lines[0]["product_description"] == "arance"
    assert lines[0]["pieces"] == 10
