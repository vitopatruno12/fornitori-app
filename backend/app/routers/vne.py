import os
import re
import urllib.parse
import urllib.request
import html
import time
from dataclasses import dataclass
from http.cookiejar import CookieJar
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/vne", tags=["vne"])
VNE_HTTP_TIMEOUT_SEC = float(os.getenv("VNE_HTTP_TIMEOUT_SEC", "12"))
VNE_HTTP_RETRIES = int(os.getenv("VNE_HTTP_RETRIES", "2"))
VNE_HTTP_RETRY_DELAY_SEC = float(os.getenv("VNE_HTTP_RETRY_DELAY_SEC", "0.35"))
VNE_STATUS_MAX_TOTAL_SEC = float(os.getenv("VNE_STATUS_MAX_TOTAL_SEC", "18"))


@dataclass
class VneModelConfig:
    id: str
    label: str
    status_url: Optional[str]
    sel_operazioni_url: Optional[str] = None
    operazioni_url: Optional[str] = None
    sel_chiusure_url: Optional[str] = None
    chiusure_url: Optional[str] = None
    contabilita_url: Optional[str] = None
    referer_url: Optional[str] = None


class VneModelOut(BaseModel):
    id: str
    label: str
    status_url: Optional[str] = None
    sel_operazioni_url: Optional[str] = None
    operazioni_url: Optional[str] = None
    sel_chiusure_url: Optional[str] = None
    chiusure_url: Optional[str] = None
    contabilita_url: Optional[str] = None
    configured: bool


class VneStatusOut(BaseModel):
    model_id: str
    model_label: str
    fetched_url: str
    title: str
    banconote_eur: Optional[float] = None
    monete_eur: Optional[float] = None
    totale_eur: Optional[float] = None
    contenuto_stacker_eur: Optional[float] = None
    totale_cassa_eur: Optional[float] = None
    cassette: List[Dict[str, str]]
    hopper: Dict[str, str]
    updated_at_text: Optional[str] = None
    raw_excerpt: str


class VneOperationFilterOut(BaseModel):
    operations: List[str]
    users: List[str]
    csrf_token: Optional[str] = None
    raw_excerpt: str


class VneOperationsQueryIn(BaseModel):
    init_day_date: Optional[str] = None
    end_day_date: Optional[str] = None
    operations: List[str] = []
    users: List[str] = []


class VneOperationRow(BaseModel):
    when_text: str
    operation_type: str
    value_eur: Optional[float] = None
    comment: Optional[str] = None
    executed_by: Optional[str] = None


class VneOperationsOut(BaseModel):
    model_id: str
    model_label: str
    fetched_url: str
    rows: List[VneOperationRow]
    next_url: Optional[str] = None
    raw_excerpt: str


class VneCashClosingFilterOut(BaseModel):
    operators: List[str]
    csrf_token: Optional[str] = None
    raw_excerpt: str


class VneCashClosingQueryIn(BaseModel):
    init_day_date: Optional[str] = None
    end_day_date: Optional[str] = None
    operators: List[str] = []


class VneCashClosingRow(BaseModel):
    when_text: str
    operator: Optional[str] = None
    total_eur: Optional[float] = None
    raw_block: str


class VneCashClosingOut(BaseModel):
    model_id: str
    model_label: str
    fetched_url: str
    rows: List[VneCashClosingRow]
    next_url: Optional[str] = None
    raw_excerpt: str


class VneContabilitaItem(BaseModel):
    label: str
    value_eur: Optional[float] = None
    raw_value: Optional[str] = None


class VneContabilitaOut(BaseModel):
    model_id: str
    model_label: str
    fetched_url: str
    title: str
    sections: Dict[str, List[VneContabilitaItem]]
    updated_at_text: Optional[str] = None
    raw_excerpt: str


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or "").strip()


def _models() -> List[VneModelConfig]:
    """Tre slot modelli VNE (1 configurato, 2-3 pronti)."""
    m1 = _env("VNE_MODEL_1_STATUS_URL", "http://vneremote.com/17/197/supervlt/stato")
    m1_sel_ops = _env("VNE_MODEL_1_SEL_OPERAZIONI_URL", "http://vneremote.com/17/197/supervlt/sel_operazioni")
    m1_ops = _env("VNE_MODEL_1_OPERAZIONI_URL", "http://vneremote.com/17/197/supervlt/operazioni/")
    m1_sel_chiusure = _env("VNE_MODEL_1_SEL_CHIUSURE_URL", "http://vneremote.com/17/197/supervlt/sel_chiusure")
    m1_chiusure = _env("VNE_MODEL_1_CHIUSURE_URL", "http://vneremote.com/17/197/supervlt/chiusure/")
    m1_contabilita = _env("VNE_MODEL_1_CONTABILITA_URL", "http://vneremote.com/17/197/supervlt/contabilita")
    m1_ref = _env("VNE_MODEL_1_REFERER_URL", "http://vneremote.com/17/197/supervlt/?param=NO")
    m2 = _env("VNE_MODEL_2_STATUS_URL", "http://vneremote.com/17/161/supervlt/stato")
    m2_sel_ops = _env("VNE_MODEL_2_SEL_OPERAZIONI_URL", "http://vneremote.com/17/161/supervlt/sel_operazioni")
    m2_ops = _env("VNE_MODEL_2_OPERAZIONI_URL", "http://vneremote.com/17/161/supervlt/operazioni/")
    m2_sel_chiusure = _env("VNE_MODEL_2_SEL_CHIUSURE_URL", "http://vneremote.com/17/161/supervlt/sel_chiusure")
    m2_chiusure = _env("VNE_MODEL_2_CHIUSURE_URL", "http://vneremote.com/17/161/supervlt/chiusure/")
    m2_contabilita = _env("VNE_MODEL_2_CONTABILITA_URL", "http://vneremote.com/17/161/supervlt/contabilita")
    m2_ref = _env("VNE_MODEL_2_REFERER_URL", "http://vneremote.com/17/161/supervlt/?param=NO")
    m3 = _env("VNE_MODEL_3_STATUS_URL", "http://vneremote.com/19/195/supervlt/stato")
    m3_sel_ops = _env("VNE_MODEL_3_SEL_OPERAZIONI_URL", "http://vneremote.com/19/195/supervlt/sel_operazioni")
    m3_ops = _env("VNE_MODEL_3_OPERAZIONI_URL", "http://vneremote.com/19/195/supervlt/operazioni/")
    m3_sel_chiusure = _env("VNE_MODEL_3_SEL_CHIUSURE_URL", "http://vneremote.com/19/195/supervlt/sel_chiusure")
    m3_chiusure = _env("VNE_MODEL_3_CHIUSURE_URL", "http://vneremote.com/19/195/supervlt/chiusure/")
    m3_contabilita = _env("VNE_MODEL_3_CONTABILITA_URL", "http://vneremote.com/19/195/supervlt/contabilita")
    m3_ref = _env("VNE_MODEL_3_REFERER_URL", "http://vneremote.com/19/195/supervlt/")
    return [
        VneModelConfig(
            id="model-1",
            label="La Risacca",
            status_url=m1 or None,
            sel_operazioni_url=m1_sel_ops or None,
            operazioni_url=m1_ops or None,
            sel_chiusure_url=m1_sel_chiusure or None,
            chiusure_url=m1_chiusure or None,
            contabilita_url=m1_contabilita or None,
            referer_url=m1_ref or None,
        ),
        VneModelConfig(
            id="model-2",
            label="Mani in Pasta",
            status_url=m2 or None,
            sel_operazioni_url=m2_sel_ops or None,
            operazioni_url=m2_ops or None,
            sel_chiusure_url=m2_sel_chiusure or None,
            chiusure_url=m2_chiusure or None,
            contabilita_url=m2_contabilita or None,
            referer_url=m2_ref or None,
        ),
        VneModelConfig(
            id="model-3",
            label="Le Mucche Volanti",
            status_url=m3 or None,
            sel_operazioni_url=m3_sel_ops or None,
            operazioni_url=m3_ops or None,
            sel_chiusure_url=m3_sel_chiusure or None,
            chiusure_url=m3_chiusure or None,
            contabilita_url=m3_contabilita or None,
            referer_url=m3_ref or None,
        ),
    ]


def _to_float_it(text: str) -> Optional[float]:
    t = (text or "").strip()
    if not t:
        return None
    t = t.replace("\xa0", "").replace(" ", "")
    has_dot = "." in t
    has_comma = "," in t
    if has_dot and has_comma:
        # Formato tipo 1.234,56 -> rimuovi separatore migliaia '.' e usa ',' come decimale
        t = t.replace(".", "").replace(",", ".")
    elif has_comma:
        # Formato tipo 1234,56
        t = t.replace(",", ".")
    else:
        # Formato tipo 1234.56 (lascia il punto come decimale)
        t = t
    try:
        return float(t)
    except Exception:
        return None


def _extract_number(pattern: str, html: str) -> Optional[float]:
    m = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    return _to_float_it(m.group(1))


def _extract_text(pattern: str, html: str) -> Optional[str]:
    m = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    return re.sub(r"\s+", " ", m.group(1)).strip()


def _parse_cassette(html: str) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    # Parse robusto: cerca righe tabellari con 5 colonne class="tab"
    row_rx = re.compile(r"<tr>(.*?)</tr>", flags=re.IGNORECASE | re.DOTALL)
    td_rx = re.compile(r'<td\s+class=["\']tab["\']>\s*(.*?)\s*</td>', flags=re.IGNORECASE | re.DOTALL)
    for row in row_rx.finditer(html):
        cols = td_rx.findall(row.group(1))
        if len(cols) < 5:
            continue
        first = _strip_html_block(cols[0]).lower()
        if "cassetta" not in first:
            continue
        num = re.search(r"cassetta\s+(\d+)", first, flags=re.IGNORECASE)
        out.append(
            {
                "cassetta": (num.group(1) if num else "").strip(),
                "presente": _strip_html_block(cols[1]),
                "taglio_eur": _strip_html_block(cols[2]),
                "banconote": _strip_html_block(cols[3]),
                "totale_eur": _strip_html_block(cols[4]),
            }
        )
    return out


def _parse_hopper(html: str) -> Dict[str, str]:
    amt = _extract_text(r"Smart\s+Hopper\s+1:\s*([0-9.,]+)\s*&euro;", html)
    if not amt:
        amt = _extract_text(r"Smart\s+Hopper\s+1:\s*([0-9.,]+)\s*€", html)
    fw = _extract_text(r"Firmware version:\s*([^<]+)</td>", html)
    return {
        "smart_hopper_1_eur": amt or "",
        "firmware": fw or "",
    }


def _extract_first_number(html_text: str, patterns: List[str]) -> Optional[float]:
    for p in patterns:
        v = _extract_number(p, html_text)
        if v is not None:
            return v
    return None


def _build_opener() -> tuple[urllib.request.OpenerDirector, CookieJar]:
    cj = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    return opener, cj


def _host_variants(url: Optional[str]) -> List[str]:
    if not url:
        return []
    out = [url]
    if "://www.vneremote.com/" in url:
        out.append(url.replace("://www.vneremote.com/", "://vneremote.com/"))
    elif "://vneremote.com/" in url:
        out.append(url.replace("://vneremote.com/", "://www.vneremote.com/"))
    # dedup mantenendo ordine
    seen: set[str] = set()
    uniq: List[str] = []
    for u in out:
        if u and u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq


def _maybe_login_vne(opener: urllib.request.OpenerDirector) -> None:
    """
    Login best-effort su VNE Remote.
    Se non riesce, continua comunque: alcuni endpoint stato possono essere già esposti.
    """
    login_page_url = _env("VNE_LOGIN_URL", "http://www.vneremote.com/accounts/login/?next=/vne/")
    login_post_url = _env("VNE_LOGIN_POST_URL", "http://www.vneremote.com/login/")
    landing_url = _env("VNE_LANDING_URL", "http://www.vneremote.com/vne/")
    username = _env("VNE_USERNAME")
    password = _env("VNE_PASSWORD")
    if not username or not password:
        return

    # Alcune installazioni VNE rispondono su host diversi (www vs non-www) con cookie dominio diverso.
    # Proviamo entrambe le varianti per stabilizzare la sessione backend.
    page_candidates = [login_page_url]
    if "://www.vneremote.com/" in login_page_url:
        page_candidates.append(login_page_url.replace("://www.vneremote.com/", "://vneremote.com/"))
    elif "://vneremote.com/" in login_page_url:
        page_candidates.append(login_page_url.replace("://vneremote.com/", "://www.vneremote.com/"))

    for page_url in page_candidates:
        try:
            req = urllib.request.Request(page_url, headers={"User-Agent": "Mozilla/5.0"})
            html = _open_bytes_with_retries(opener, req).decode("utf-8", errors="ignore")
            csrf = _extract_text(r"name=['\"]csrfmiddlewaretoken['\"]\s+value=['\"]([^'\"]+)['\"]", html) or ""
            post_data = {
                "username": username,
                "password": password,
            }
            if csrf:
                post_data["csrfmiddlewaretoken"] = csrf
            body = urllib.parse.urlencode(post_data).encode("utf-8")
            parsed_page = urllib.parse.urlparse(page_url)
            base_origin = f"{parsed_page.scheme}://{parsed_page.netloc}"
            post_url = urllib.parse.urljoin(base_origin + "/", login_post_url)
            landing = urllib.parse.urljoin(base_origin + "/", landing_url)
            headers = {
                "User-Agent": "Mozilla/5.0",
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": page_url,
                "Origin": base_origin,
            }
            _open_bytes_with_retries(opener, urllib.request.Request(post_url, data=body, headers=headers))
            # Stabilizza la sessione richiedendo la landing /vne/.
            _fetch_html(opener, landing, referer=page_url)
            return
        except Exception:
            continue
    # Non bloccare l'API: verrà tentata comunque la lettura stato.
    return


def _fetch_model_status(model: VneModelConfig) -> str:
    if not model.status_url:
        raise HTTPException(status_code=400, detail=f"{model.label} non configurato: imposta URL stato nel backend .env")

    opener, _ = _build_opener()
    started = time.monotonic()
    _maybe_login_vne(opener)
    req = _build_req(model.status_url, model.referer_url)
    try:
        html_text = _open_bytes_with_retries(opener, req).decode("utf-8", errors="ignore")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore lettura stato VNE: {e}")

    # Alcune macchine richiedono un "passaggio" sulla pagina base del modello
    # per agganciare correttamente la sessione prima della lettura stato.
    if "impossibile accedere alla macchina" in html_text.lower():
        # Costruisci candidate URL stato: host varianti + trailing slash on/off.
        status_candidates: List[str] = []
        for su in _host_variants(model.status_url):
            status_candidates.append(su)
            status_candidates.append(su.rstrip("/"))
            status_candidates.append(su.rstrip("/") + "/")

        # Costruisci referer candidati: referer configurato + base directory dello stato.
        referer_candidates: List[str] = []
        for ru in _host_variants(model.referer_url):
            referer_candidates.append(ru)
        for su in status_candidates:
            base_dir = su.rsplit("/", 1)[0] + "/"
            referer_candidates.append(base_dir)
            referer_candidates.append(base_dir + "?param=NO")

        # dedup mantenendo ordine
        seen_status: set[str] = set()
        uniq_status: List[str] = []
        for u in status_candidates:
            if u and u not in seen_status:
                seen_status.add(u)
                uniq_status.append(u)

        seen_ref: set[str] = set()
        uniq_ref: List[str] = []
        for u in referer_candidates:
            if u and u not in seen_ref:
                seen_ref.add(u)
                uniq_ref.append(u)

        for ref in uniq_ref:
            if (time.monotonic() - started) > VNE_STATUS_MAX_TOTAL_SEC:
                break
            try:
                _fetch_html(opener, ref, referer=ref)
            except Exception:
                pass
            for su in uniq_status:
                if (time.monotonic() - started) > VNE_STATUS_MAX_TOTAL_SEC:
                    break
                try:
                    retry_html = _open_bytes_with_retries(opener, _build_req(su, ref)).decode("utf-8", errors="ignore")
                    if "impossibile accedere alla macchina" not in retry_html.lower():
                        return retry_html
                except Exception:
                    continue

    return html_text


def _build_req(url: str, referer: Optional[str] = None, data: Optional[bytes] = None) -> urllib.request.Request:
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    if referer:
        headers["Referer"] = referer
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    return urllib.request.Request(url, data=data, headers=headers)


def _open_bytes_with_retries(opener: urllib.request.OpenerDirector, req: urllib.request.Request) -> bytes:
    last_exc: Optional[Exception] = None
    attempts = max(1, VNE_HTTP_RETRIES + 1)
    for idx in range(attempts):
        try:
            with opener.open(req, timeout=VNE_HTTP_TIMEOUT_SEC) as resp:
                return resp.read()
        except Exception as e:
            last_exc = e
            if idx >= attempts - 1:
                break
            time.sleep(VNE_HTTP_RETRY_DELAY_SEC * (idx + 1))
    if last_exc:
        raise last_exc
    raise RuntimeError("Errore HTTP VNE sconosciuto")


def _fetch_html(opener: urllib.request.OpenerDirector, url: str, referer: Optional[str] = None, data: Optional[bytes] = None) -> str:
    req = _build_req(url, referer=referer, data=data)
    raw = _open_bytes_with_retries(opener, req)
    return raw.decode("utf-8", errors="ignore")


def _extract_values_by_name(html: str, name: str) -> List[str]:
    rx = re.compile(rf'name=["\']{re.escape(name)}["\']\s+value=["\']([^"\']*)["\']', flags=re.IGNORECASE)
    vals: List[str] = []
    for m in rx.finditer(html):
        v = urllib.parse.unquote((m.group(1) or "").strip())
        if v not in vals:
            vals.append(v)
    return vals


def _parse_operations_rows(html: str) -> List[VneOperationRow]:
    rows: List[VneOperationRow] = []
    block_rx = re.compile(r'<td class="col1" colspan=2>(.*?)</td>', flags=re.IGNORECASE | re.DOTALL)
    for m in block_rx.finditer(html):
        block = m.group(1)
        when = _extract_text(r"Operazione del:</b>\s*([^<]+)", block) or ""
        op_type = _extract_text(r"Tipo operazione:\s*([^<]+)", block) or ""
        value_raw = _extract_text(r"Valore:\s*([0-9.,]+)", block)
        comment = _extract_text(r"Commento:\s*([^<]+)", block)
        executed = _extract_text(r"Eseguita da:\s*([^<]+)", block)
        if not when and not op_type:
            continue
        rows.append(
            VneOperationRow(
                when_text=when,
                operation_type=op_type,
                value_eur=_to_float_it(value_raw or "") if value_raw else None,
                comment=comment,
                executed_by=executed,
            )
        )
    return rows


@router.get("/models", response_model=List[VneModelOut])
def list_models():
    return [
        VneModelOut(
            id=m.id,
            label=m.label,
            status_url=m.status_url,
            sel_operazioni_url=m.sel_operazioni_url,
            operazioni_url=m.operazioni_url,
            sel_chiusure_url=m.sel_chiusure_url,
            chiusure_url=m.chiusure_url,
            contabilita_url=m.contabilita_url,
            configured=bool(
                m.status_url
                or m.sel_operazioni_url
                or m.operazioni_url
                or m.sel_chiusure_url
                or m.chiusure_url
                or m.contabilita_url
            ),
        )
        for m in _models()
    ]


@router.get("/models/{model_id}/status", response_model=VneStatusOut)
def get_model_status(model_id: str):
    model = next((m for m in _models() if m.id == model_id), None)
    if not model:
        raise HTTPException(status_code=404, detail="Modello VNE non trovato")
    html = _fetch_model_status(model)
    title = _extract_text(r"<h2 class=\"title\">([^<]+)</h2>", html) or "Stato"
    banconote = _extract_first_number(
        html,
        [
            r"Banconote:\s*([0-9.,]+)\s*&euro;",
            r"Banconote:\s*([0-9.,]+)\s*€",
        ],
    )
    monete = _extract_first_number(
        html,
        [
            r"Monete:\s*([0-9.,]+)\s*&euro;",
            r"Monete:\s*([0-9.,]+)\s*€",
        ],
    )
    totale = _extract_first_number(
        html,
        [
            r"Totale:\s*([0-9.,]+)\s*&euro;",
            r"Totale:\s*([0-9.,]+)\s*€",
            r"Totale\s+IN\s*:\s*([0-9.,]+)\s*&euro;",
        ],
    )
    stacker = _extract_first_number(
        html,
        [
            r"Contenuto stacker:\s*([0-9.,]+)\s*&euro;",
            r"Contenuto stacker:\s*([0-9.,]+)\s*€",
        ],
    )
    totale_cassa = _extract_first_number(
        html,
        [
            r"Totale cassa:\s*([0-9.,]+)\s*&euro;",
            r"Totale cassa:\s*([0-9.,]+)\s*€",
        ],
    )
    updated = _extract_text(r"Sistema di controllo remoto<br/>\s*([^<]+)\s*</td>", html)
    excerpt = re.sub(r"\s+", " ", html)
    return VneStatusOut(
        model_id=model.id,
        model_label=model.label,
        fetched_url=model.status_url or "",
        title=title,
        banconote_eur=banconote,
        monete_eur=monete,
        totale_eur=totale,
        contenuto_stacker_eur=stacker,
        totale_cassa_eur=totale_cassa,
        cassette=_parse_cassette(html),
        hopper=_parse_hopper(html),
        updated_at_text=updated,
        raw_excerpt=excerpt[:1800],
    )


@router.get("/models/{model_id}/operations/filters", response_model=VneOperationFilterOut)
def get_model_operation_filters(model_id: str):
    model = next((m for m in _models() if m.id == model_id), None)
    if not model:
        raise HTTPException(status_code=404, detail="Modello VNE non trovato")
    if not model.sel_operazioni_url:
        raise HTTPException(status_code=400, detail=f"{model.label} non configurato: manca sel_operazioni URL")
    opener, _ = _build_opener()
    _maybe_login_vne(opener)
    try:
        html = _fetch_html(opener, model.sel_operazioni_url, referer=model.sel_operazioni_url or model.referer_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore lettura filtro operazioni VNE: {e}")

    operations = _extract_values_by_name(html, "operation")
    users = _extract_values_by_name(html, "utenti")
    csrf = _extract_text(r"name=['\"]csrfmiddlewaretoken['\"]\s+value=['\"]([^'\"]+)['\"]", html)
    excerpt = re.sub(r"\s+", " ", html)
    return VneOperationFilterOut(
        operations=operations,
        users=users,
        csrf_token=csrf,
        raw_excerpt=excerpt[:1800],
    )


@router.post("/models/{model_id}/operations/query", response_model=VneOperationsOut)
def post_model_operations_query(model_id: str, payload: VneOperationsQueryIn):
    model = next((m for m in _models() if m.id == model_id), None)
    if not model:
        raise HTTPException(status_code=404, detail="Modello VNE non trovato")
    if not model.sel_operazioni_url or not model.operazioni_url:
        raise HTTPException(status_code=400, detail=f"{model.label} non configurato: mancano URL operazioni")

    opener, _ = _build_opener()
    _maybe_login_vne(opener)
    try:
        filter_html = _fetch_html(opener, model.sel_operazioni_url, referer=model.referer_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore lettura pagina filtri VNE: {e}")

    csrf = _extract_text(r"name=['\"]csrfmiddlewaretoken['\"]\s+value=['\"]([^'\"]+)['\"]", filter_html) or ""
    form_data: List[tuple[str, str]] = []
    if csrf:
        form_data.append(("csrfmiddlewaretoken", csrf))
    if payload.init_day_date or payload.end_day_date:
        form_data.append(("filters", "filterData"))
    if payload.init_day_date:
        form_data.append(("init_day_date", payload.init_day_date))
    if payload.end_day_date:
        form_data.append(("end_day_date", payload.end_day_date))
    if payload.operations:
        form_data.append(("filters", "filterOperation"))
        for op in payload.operations:
            form_data.append(("operation", op))
    if payload.users:
        form_data.append(("filters", "filterUser"))
        for u in payload.users:
            form_data.append(("utenti", u))

    body = urllib.parse.urlencode(form_data, doseq=True).encode("utf-8")
    try:
        html = _fetch_html(opener, model.operazioni_url, referer=model.sel_operazioni_url, data=body)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore query operazioni VNE: {e}")

    rows = _parse_operations_rows(html)
    next_path = _extract_text(r'<a class="mainLink"\s+href="([^"]+)">\s*Next\s*</a>', html)
    next_url = urllib.parse.urljoin(model.operazioni_url, next_path) if next_path else None
    excerpt = re.sub(r"\s+", " ", html)
    return VneOperationsOut(
        model_id=model.id,
        model_label=model.label,
        fetched_url=model.operazioni_url,
        rows=rows,
        next_url=next_url,
        raw_excerpt=excerpt[:1800],
    )


@router.get("/models/{model_id}/cash-closings/filters", response_model=VneCashClosingFilterOut)
def get_model_cash_closing_filters(model_id: str):
    model = next((m for m in _models() if m.id == model_id), None)
    if not model:
        raise HTTPException(status_code=404, detail="Modello VNE non trovato")
    if not model.sel_chiusure_url:
        raise HTTPException(status_code=400, detail=f"{model.label} non configurato: manca sel_chiusure URL")
    opener, _ = _build_opener()
    _maybe_login_vne(opener)
    try:
        html = _fetch_html(opener, model.sel_chiusure_url, referer=model.sel_chiusure_url or model.referer_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore lettura filtro chiusure VNE: {e}")
    operators = _extract_values_by_name(html, "operators")
    csrf = _extract_text(r"name=['\"]csrfmiddlewaretoken['\"]\s+value=['\"]([^'\"]+)['\"]", html)
    excerpt = re.sub(r"\s+", " ", html)
    return VneCashClosingFilterOut(operators=operators, csrf_token=csrf, raw_excerpt=excerpt[:1800])


def _parse_cash_closing_rows(html: str) -> List[VneCashClosingRow]:
    rows: List[VneCashClosingRow] = []
    blocks = re.findall(r'<td class="col1" colspan=2>(.*?)</td>', html, flags=re.IGNORECASE | re.DOTALL)
    for b in blocks:
        cleaned = _strip_html_block(b)
        when = _extract_text(r"(?:Chiusura|Operazione)\s+del:?\s*</b>\s*([^<]+)", b) or ""
        operator = _extract_text(r"(?:Operatore|Eseguita da):\s*([^<]+)", b)
        total = _extract_number(r"(?:Totale|Valore):\s*([0-9.,]+)", b)
        if not when and not operator and total is None:
            continue
        rows.append(VneCashClosingRow(when_text=when or "—", operator=operator, total_eur=total, raw_block=cleaned[:500]))
    return rows


def _strip_html_block(raw: str) -> str:
    """
    Converte i blocchi HTML VNE in testo leggibile:
    - <br> -> newline
    - rimozione tag
    - decode entità html (&nbsp;, &agrave;, ...)
    """
    x = raw or ""
    x = re.sub(r"<br\s*/?>", "\n", x, flags=re.IGNORECASE)
    x = re.sub(r"<[^>]+>", "", x)
    x = html.unescape(x)
    lines = []
    for ln in x.splitlines():
        ln = re.sub(r"\s+", " ", ln).strip()
        if ln:
            lines.append(ln)
    return "\n".join(lines)


def _parse_contabilita_section(html_text: str, section_name: str) -> List[VneContabilitaItem]:
    rx = re.compile(
        rf"<tr><td class=\"titolo\" colspan=2>\s*{re.escape(section_name)}\s*</td></tr>(.*?)(?:<tr><td class=\"titolo\" colspan=2>|<tr>\s*<td class=\"footer\")",
        flags=re.IGNORECASE | re.DOTALL,
    )
    m = rx.search(html_text)
    if not m:
        return []
    block = m.group(1)
    items: List[VneContabilitaItem] = []
    for pair in re.finditer(r"([^:<>\n]+):\s*([0-9][0-9.,]*)\s*&euro;", block, flags=re.IGNORECASE):
        label = re.sub(r"\s+", " ", html.unescape(pair.group(1) or "")).strip()
        raw_val = (pair.group(2) or "").strip()
        items.append(VneContabilitaItem(label=label, value_eur=_to_float_it(raw_val), raw_value=raw_val))
    return items


@router.get("/models/{model_id}/contabilita", response_model=VneContabilitaOut)
def get_model_contabilita(model_id: str):
    model = next((m for m in _models() if m.id == model_id), None)
    if not model:
        raise HTTPException(status_code=404, detail="Modello VNE non trovato")
    if not model.contabilita_url:
        raise HTTPException(status_code=400, detail=f"{model.label} non configurato: manca contabilita URL")

    opener, _ = _build_opener()
    _maybe_login_vne(opener)
    try:
        page_html = _fetch_html(opener, model.contabilita_url, referer=model.referer_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore lettura contabilita VNE: {e}")

    title = _extract_text(r"<h2 class=\"title\">([^<]+)</h2>", page_html) or "Contabilita"
    updated = _extract_text(r"Sistema di controllo remoto<br/>\s*([^<]+)\s*</td>", page_html)
    sections = {
        "monete": _parse_contabilita_section(page_html, "Monete"),
        "banconote": _parse_contabilita_section(page_html, "Banconote"),
        "pagamenti": _parse_contabilita_section(page_html, "Pagamenti"),
        "pagamento_manuale": _parse_contabilita_section(page_html, "Pagamento manuale"),
        "rimborso": _parse_contabilita_section(page_html, "Rimborso"),
        "riepilogo": _parse_contabilita_section(page_html, "Riepilogo"),
        "prelievi": _parse_contabilita_section(page_html, "Prelievi"),
    }
    excerpt = re.sub(r"\s+", " ", page_html)
    return VneContabilitaOut(
        model_id=model.id,
        model_label=model.label,
        fetched_url=model.contabilita_url,
        title=title,
        sections=sections,
        updated_at_text=updated,
        raw_excerpt=excerpt[:1800],
    )


@router.post("/models/{model_id}/cash-closings/query", response_model=VneCashClosingOut)
def post_model_cash_closings_query(model_id: str, payload: VneCashClosingQueryIn):
    model = next((m for m in _models() if m.id == model_id), None)
    if not model:
        raise HTTPException(status_code=404, detail="Modello VNE non trovato")
    if not model.sel_chiusure_url or not model.chiusure_url:
        raise HTTPException(status_code=400, detail=f"{model.label} non configurato: mancano URL chiusure")
    opener, _ = _build_opener()
    _maybe_login_vne(opener)
    try:
        filter_html = _fetch_html(opener, model.sel_chiusure_url, referer=model.sel_chiusure_url or model.referer_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore lettura pagina filtri chiusure VNE: {e}")
    csrf = _extract_text(r"name=['\"]csrfmiddlewaretoken['\"]\s+value=['\"]([^'\"]+)['\"]", filter_html) or ""
    form_data: List[tuple[str, str]] = []
    if csrf:
        form_data.append(("csrfmiddlewaretoken", csrf))
    if payload.init_day_date or payload.end_day_date:
        form_data.append(("filters", "filterData"))
    if payload.init_day_date:
        form_data.append(("init_day_date", payload.init_day_date))
    if payload.end_day_date:
        form_data.append(("end_day_date", payload.end_day_date))
    if payload.operators:
        form_data.append(("filters", "filterOp"))
        for op in payload.operators:
            form_data.append(("operators", op))
    body = urllib.parse.urlencode(form_data, doseq=True).encode("utf-8")
    try:
        html = _fetch_html(opener, model.chiusure_url, referer=model.sel_chiusure_url, data=body)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore query chiusure VNE: {e}")
    rows = _parse_cash_closing_rows(html)
    next_path = _extract_text(r'<a class="mainLink"\s+href="([^"]+)">\s*Next\s*</a>', html)
    next_url = urllib.parse.urljoin(model.chiusure_url, next_path) if next_path else None
    excerpt = re.sub(r"\s+", " ", html)
    return VneCashClosingOut(
        model_id=model.id,
        model_label=model.label,
        fetched_url=model.chiusure_url,
        rows=rows,
        next_url=next_url,
        raw_excerpt=excerpt[:1800],
    )
