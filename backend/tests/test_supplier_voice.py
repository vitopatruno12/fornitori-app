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
