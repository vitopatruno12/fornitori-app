from app.services.ai_heuristics import normalize_order_line, suggest_order_lines


def test_normalize_splits_pieces_from_description():
    row = normalize_order_line({"product_description": "10 arance", "pieces": None})
    assert row["pieces"] == 10
    assert row["product_description"] == "arance"


def test_normalize_keeps_pieces_field_clean():
    row = normalize_order_line({"product_description": "10x carciofi", "pieces": None})
    assert row["pieces"] == 10
    assert row["product_description"] == "carciofi"


def test_normalize_strips_redundant_prefix_when_pieces_set():
    row = normalize_order_line({"product_description": "5 pomodori", "pieces": 5})
    assert row["product_description"] == "pomodori"
    assert row["pieces"] == 5


def test_suggest_order_lines_separates_qty():
    r = suggest_order_lines("10 arance; 3 kg mele")
    lines = r["suggested_lines"]
    assert lines[0]["pieces"] == 10
    assert lines[0]["product_description"] == "arance"
    assert lines[1]["weight_kg"] == 3.0
    assert "mele" in lines[1]["product_description"].lower()


def test_normalize_kg_in_description():
    row = normalize_order_line({"product_description": "5 kg pasta", "pieces": None})
    assert row["weight_kg"] == 5.0
    assert row["product_description"] == "pasta"
    assert row["pieces"] is None


def test_parse_mixed_voice_phrase():
    from app.services.ai_heuristics import parse_order_line_from_text

    r = parse_order_line_from_text("arance kg 5")
    assert r["product_description"] == "arance"
    assert r["weight_kg"] == 5.0
    assert r["pieces"] is None

    r2 = parse_order_line_from_text("arance pezzi 10")
    assert r2["product_description"] == "arance"
    assert r2["pieces"] == 10

    r3 = parse_order_line_from_text("arance pezzi dieci")
    assert r3["product_description"] == "arance"
    assert r3["pieces"] == 10

    r4 = parse_order_line_from_text("arance pezzi 10 kg 2")
    assert r4["pieces"] == 10
    assert r4["product_description"] == "arance"


def test_order_full_voice_phrase():
    from app.services.ai_heuristics import suggest_order_full

    r = suggest_order_full("Ordine a Rossi domani: 10 arance, 5 kg pasta", ["Rossi"])
    lines = r["suggested_lines"]
    assert len(lines) >= 2
    assert lines[0]["product_description"] == "arance"
    assert lines[0]["pieces"] == 10
    assert lines[1]["weight_kg"] == 5.0
    assert "pasta" in lines[1]["product_description"].lower()
    assert "rossi" not in lines[0]["product_description"].lower()


def test_supplier_name_not_in_product_field():
    from app.services.ai_heuristics import suggest_order_full

    r = suggest_order_full("fornitore Rossi 10 arance e 5 kg pasta", ["Rossi"])
    assert r["suggested_fields"].get("supplier_name") == "Rossi"
    lines = r["suggested_lines"]
    assert lines[0]["product_description"] == "arance"
    assert lines[0]["pieces"] == 10
    assert "rossi" not in (lines[0]["product_description"] or "").lower()


def test_supplier_prefix_words_stripped_from_products():
    from app.services.ai_heuristics import suggest_order_full

    r = suggest_order_full("Frutta Siciliana 10 arance 3 kg mele", ["Frutta Siciliana"])
    lines = r["suggested_lines"]
    assert lines[0]["product_description"] == "arance"
    assert "siciliana" not in lines[0]["product_description"].lower()
    assert "frutta" not in lines[0]["product_description"].lower()


def test_split_multiple_without_commas():
    r = suggest_order_lines("10 arance 5 kg pasta")
    lines = r["suggested_lines"]
    assert len(lines) >= 2
    assert lines[0]["product_description"] == "arance"
    assert lines[0]["pieces"] == 10
    assert lines[1]["product_description"] == "pasta"
    assert lines[1]["weight_kg"] == 5.0


def test_split_multiple_mixed_phrase():
    r = suggest_order_lines("arance pezzi 10 pasta kg 5")
    lines = r["suggested_lines"]
    assert len(lines) >= 2
    assert lines[0]["product_description"] == "arance"
    assert lines[0]["pieces"] == 10
    assert lines[1]["product_description"] == "pasta"
    assert lines[1]["weight_kg"] == 5.0


def test_split_long_voice_without_commas():
    r = suggest_order_lines("10 arance 5 kg pasta 3 carciofi 2 kg patate")
    lines = r["suggested_lines"]
    assert len(lines) == 4
    assert lines[0]["product_description"] == "arance"
    assert lines[0]["pieces"] == 10
    assert lines[1]["product_description"] == "pasta"
    assert lines[1]["weight_kg"] == 5.0
    assert lines[2]["product_description"] == "carciofi"
    assert lines[2]["pieces"] == 3
    assert lines[3]["product_description"] == "patate"
    assert lines[3]["weight_kg"] == 2.0
