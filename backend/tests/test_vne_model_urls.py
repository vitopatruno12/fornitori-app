from pathlib import Path

from app.routers.vne import (
    VneModelConfig,
    _complete_model_config,
    _discover_supervlt_path_pair,
    _is_machine_blocked,
    _models,
    _online_label_for_overview,
    _parse_vne_lista_page,
    _status_html_ok,
    _supervlt_urls_from_status,
    _supervlt_urls_from_virtuo_machine,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def test_supervlt_urls_from_status_27_234():
    urls = _supervlt_urls_from_status("http://vneremote.com/27/234/supervlt/stato")
    assert urls["status_url"] == "http://vneremote.com/27/234/supervlt/stato"
    assert urls["sel_operazioni_url"] == "http://vneremote.com/27/234/supervlt/sel_operazioni"
    assert urls["referer_url"] == "http://vneremote.com/27/234/supervlt/?param=NO"


def test_supervlt_urls_from_status_33_231():
    urls = _supervlt_urls_from_status("http://vneremote.com/33/231/supervlt/stato")
    assert urls["status_url"] == "http://vneremote.com/33/231/supervlt/stato"
    assert urls["sel_operazioni_url"] == "http://vneremote.com/33/231/supervlt/sel_operazioni"
    assert urls["operazioni_url"] == "http://vneremote.com/33/231/supervlt/operazioni/"
    assert urls["sel_chiusure_url"] == "http://vneremote.com/33/231/supervlt/sel_chiusure"
    assert urls["chiusure_url"] == "http://vneremote.com/33/231/supervlt/chiusure/"
    assert urls["contabilita_url"] == "http://vneremote.com/33/231/supervlt/contabilita"
    assert urls["referer_url"] == "http://vneremote.com/33/231/supervlt/?param=NO"


def test_supervlt_urls_from_status_32_250():
    urls = _supervlt_urls_from_status("http://vneremote.com/32/250/supervlt/stato")
    assert urls["status_url"] == "http://vneremote.com/32/250/supervlt/stato"
    assert urls["sel_operazioni_url"] == "http://vneremote.com/32/250/supervlt/sel_operazioni"
    assert urls["referer_url"] == "http://vneremote.com/32/250/supervlt/?param=NO"


def test_supervlt_urls_from_virtuo_mani_in_pasta():
    urls = _supervlt_urls_from_virtuo_machine("http://www.vneremote.com/vne/VIRTUO20221720/")
    assert urls["status_url"] == "http://vneremote.com/33/231/supervlt/stato"
    assert urls["contabilita_url"] == "http://vneremote.com/33/231/supervlt/contabilita"


def test_supervlt_urls_from_virtuo_mucche_volanti():
    urls = _supervlt_urls_from_virtuo_machine("http://www.vneremote.com/vne/VIRTUO20221707/")
    assert urls["status_url"] == "http://vneremote.com/29/10/supervlt/stato"
    assert urls["referer_url"] == "http://vneremote.com/29/10/supervlt/?param=NO"


def test_supervlt_urls_from_virtuo_risacca():
    urls = _supervlt_urls_from_virtuo_machine("http://www.vneremote.com/vne/VIRTUO20221721/")
    assert urls["status_url"] == "http://vneremote.com/32/250/supervlt/stato"
    assert urls["referer_url"] == "http://vneremote.com/32/250/supervlt/?param=NO"
    assert "29/10" not in urls["status_url"]


def test_complete_model_config_risacca_keeps_custom_supervlt_path():
    model = VneModelConfig(
        id="model-1",
        label="La Risacca",
        machine_url="http://www.vneremote.com/vne/VIRTUO20221721/",
        status_url="http://vneremote.com/32/250/supervlt/stato",
        model_code="VIRTUO20221721",
    )
    out = _complete_model_config(model)
    assert out.status_url == "http://vneremote.com/32/250/supervlt/stato"
    assert out.referer_url == "http://vneremote.com/32/250/supervlt/?param=NO"


def test_complete_model_config_risacca_rejects_mucche_path():
    model = VneModelConfig(
        id="model-1",
        label="La Risacca",
        machine_url="http://www.vneremote.com/vne/VIRTUO20221721/",
        status_url="http://vneremote.com/29/10/supervlt/stato",
        model_code="VIRTUO20221721",
    )
    out = _complete_model_config(model)
    assert "32/250" in (out.status_url or "")
    assert "29/10" not in (out.status_url or "")
    assert "29/10" not in (out.referer_url or "")


def test_complete_model_config_mucche_volanti_uses_29_10():
    model = VneModelConfig(
        id="model-3",
        label="Le Mucche Volanti",
        machine_url="http://www.vneremote.com/vne/VIRTUO20221707/",
        status_url=None,
        model_code="VIRTUO20221707",
    )
    out = _complete_model_config(model)
    assert out.status_url == "http://vneremote.com/29/10/supervlt/stato"
    assert out.referer_url == "http://vneremote.com/29/10/supervlt/?param=NO"


def test_complete_model_config_mucche_rejects_legacy_27_234():
    model = VneModelConfig(
        id="model-3",
        label="Le Mucche Volanti",
        machine_url="http://www.vneremote.com/vne/VIRTUO20221707/",
        status_url="http://vneremote.com/27/234/supervlt/stato",
        model_code="VIRTUO20221707",
    )
    out = _complete_model_config(model)
    assert out.status_url == "http://vneremote.com/29/10/supervlt/stato"
    assert "27/234" not in (out.status_url or "")


def test_complete_model_config_mani_rejects_legacy_17_122():
    model = VneModelConfig(
        id="model-2",
        label="Mani in Pasta",
        machine_url="http://www.vneremote.com/vne/VIRTUO20221720/",
        status_url="http://vneremote.com/17/122/supervlt/stato",
        model_code="VIRTUO20221720",
    )
    out = _complete_model_config(model)
    assert out.status_url == "http://vneremote.com/33/231/supervlt/stato"
    assert "17/122" not in (out.status_url or "")


def test_complete_model_config_from_virtuo_machine_url():
    model = VneModelConfig(
        id="model-2",
        label="Mani in Pasta",
        machine_url="http://www.vneremote.com/vne/VIRTUO20221720/",
        status_url=None,
    )
    out = _complete_model_config(model)
    assert out.status_url == "http://vneremote.com/33/231/supervlt/stato"
    assert out.sel_operazioni_url == "http://vneremote.com/33/231/supervlt/sel_operazioni"
    assert out.referer_url == "http://vneremote.com/33/231/supervlt/?param=NO"


def test_complete_model_config_fills_missing_urls():
    model = VneModelConfig(
        id="model-1",
        label="Test",
        status_url="http://vneremote.com/27/234/supervlt/stato",
    )
    out = _complete_model_config(model)
    assert out.sel_operazioni_url == "http://vneremote.com/27/234/supervlt/sel_operazioni"
    assert out.referer_url == "http://vneremote.com/27/234/supervlt/?param=NO"


def test_discover_supervlt_path_pair_from_html():
    html = '<iframe src="http://vneremote.com/31/139/supervlt/?param=NO"></iframe>'
    assert _discover_supervlt_path_pair(html) == "31/139"


def test_models_defaults_use_virtuo_machine_urls():
    models = {m.id: m for m in _models()}
    assert models["model-1"].machine_url.endswith("/vne/VIRTUO20221721/")
    assert models["model-2"].machine_url.endswith("/vne/VIRTUO20221720/")
    assert models["model-3"].machine_url.endswith("/vne/VIRTUO20221707/")
    assert models["model-1"].status_url == "http://vneremote.com/32/250/supervlt/stato"
    assert "29/10" not in (models["model-1"].status_url or "")
    assert models["model-2"].status_url == "http://vneremote.com/33/231/supervlt/stato"
    assert models["model-3"].status_url == "http://vneremote.com/29/10/supervlt/stato"


def test_status_html_ok_detects_stato_page():
    html = '<html><head><title>Stato</title></head><body><h2 class="title">Stato</h2></body></html>'
    assert _status_html_ok(html) is True
    assert _status_html_ok('<form><input name="username"><input type="password"></form>') is False


def test_is_machine_blocked_multi_language():
    assert _is_machine_blocked("<p>Impossibile accedere alla macchina</p>")
    assert _is_machine_blocked("<p>Imposible acceder a la maquina</p>")
    assert _is_machine_blocked("<p>Não se consegue acesso à máquina.</p>")
    assert not _is_machine_blocked('<html><title>Stato</title></html>')


def test_parse_vne_lista_page_online_icons():
    html = (FIXTURES / "vne_lista_sample.html").read_text(encoding="utf-8")
    rows = _parse_vne_lista_page(html)
    assert rows["VIRTUO20221707"]["online"] is True
    assert rows["VIRTUO20221720"]["online"] is True
    assert rows["VIRTUO20221721"]["online"] is False
    assert rows["VIRTUO20221721"]["city"] == "lecce"
    assert rows["VIRTUO20221721"]["region"] == "Puglia_"


def test_online_label_for_overview_prefers_lista():
    entry = {"online": False}
    assert _online_label_for_overview(lista_entry=entry, lista_loaded=True, reachable=True) == "Offline"
    assert _online_label_for_overview(lista_entry=None, lista_loaded=False, reachable=True) == "Online"
    assert _online_label_for_overview(lista_entry=None, lista_loaded=False, reachable=False) == "Offline"
