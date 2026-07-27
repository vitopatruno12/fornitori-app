import os
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
import html
import time
from dataclasses import dataclass
from datetime import date, datetime
from http.cookiejar import CookieJar
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/vne", tags=["vne"])
VNE_HTTP_TIMEOUT_SEC = float(os.getenv("VNE_HTTP_TIMEOUT_SEC", "20"))
VNE_HTTP_RETRIES = int(os.getenv("VNE_HTTP_RETRIES", "2"))
VNE_HTTP_RETRY_DELAY_SEC = float(os.getenv("VNE_HTTP_RETRY_DELAY_SEC", "0.35"))
VNE_STATUS_MAX_TOTAL_SEC = float(os.getenv("VNE_STATUS_MAX_TOTAL_SEC", "40"))
VNE_STATUS_RETRY_MAX_SEC = float(os.getenv("VNE_STATUS_RETRY_MAX_SEC", "12"))
VNE_HEALTH_MAX_TOTAL_SEC = float(os.getenv("VNE_HEALTH_MAX_TOTAL_SEC", "75"))
VNE_HEALTH_PER_MODEL_SEC = float(os.getenv("VNE_HEALTH_PER_MODEL_SEC", "18"))
VNE_STATUS_REFERER_RETRY_MAX = int(os.getenv("VNE_STATUS_REFERER_RETRY_MAX", "3"))
VNE_REQUEST_MAX_SEC = float(os.getenv("VNE_REQUEST_MAX_SEC", os.getenv("VNE_STATUS_MAX_TOTAL_SEC", "40")))
VNE_ANALYTICS_MAX_TOTAL_SEC = float(os.getenv("VNE_ANALYTICS_MAX_TOTAL_SEC", "120"))


@dataclass
class _VneHttpSession:
    opener: urllib.request.OpenerDirector
    cj: CookieJar
    deadline: float
    logged_in: bool = False

    @classmethod
    def create(cls, max_seconds: Optional[float] = None) -> "_VneHttpSession":
        opener, cj = _build_opener()
        return cls(
            opener=opener,
            cj=cj,
            deadline=time.monotonic() + (max_seconds or VNE_STATUS_MAX_TOTAL_SEC),
        )

    def login(self, origin: Optional[str] = None, *, force: bool = False) -> bool:
        if force:
            self.opener, self.cj = _build_opener()
            self.logged_in = False
        if self.logged_in:
            return True
        if _maybe_login_vne(self.opener, self.cj, deadline=self.deadline, origin=origin):
            self.logged_in = True
            return True
        return False


@dataclass
class VneModelConfig:
    id: str
    label: str
    status_url: Optional[str]
    machine_url: Optional[str] = None
    sel_operazioni_url: Optional[str] = None
    operazioni_url: Optional[str] = None
    sel_chiusure_url: Optional[str] = None
    chiusure_url: Optional[str] = None
    contabilita_url: Optional[str] = None
    referer_url: Optional[str] = None
    model_code: Optional[str] = None
    sala: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None


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


class VneDenominationItem(BaseModel):
    taglio_eur: str
    quantita: int


class VneAccettatoreStatus(BaseModel):
    presente: Optional[str] = None
    errore: Optional[str] = None
    firmware: Optional[str] = None


class VneHopperUnit(BaseModel):
    hopper: str
    presente: str
    errore: str
    vuoto: str
    pieno: str


class VneHopperStatus(BaseModel):
    smart_hopper_1_eur: Optional[str] = None
    firmware: Optional[str] = None
    monete: List[VneDenominationItem] = []
    units: List[VneHopperUnit] = []


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
    accettatore: VneAccettatoreStatus = VneAccettatoreStatus()
    cassette: List[Dict[str, str]]
    stacker_banconote: List[VneDenominationItem] = []
    hopper: VneHopperStatus = VneHopperStatus()
    monete_dettaglio: List[VneDenominationItem] = []
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


class VneHealthModelOut(BaseModel):
    model_id: str
    model_label: str
    configured: bool
    reachable: bool
    detail: str


class VneHealthOut(BaseModel):
    ok: bool
    credentials_configured: bool
    credentials_message: str
    models: List[VneHealthModelOut]


class VneMachineOverviewRow(BaseModel):
    model_id: str
    machine_name: str
    model_code: Optional[str] = None
    sala: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None
    alarm: str = "—"
    levels: str = "—"
    online: str = "Offline"
    detail: Optional[str] = None
    totale_eur: Optional[float] = None
    banconote_eur: Optional[float] = None
    monete_eur: Optional[float] = None


class VneMachinesOverviewOut(BaseModel):
    rows: List[VneMachineOverviewRow]
    updated_at: Optional[str] = None


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or "").strip()


def _env_model_meta(model_index: int, field: str, default: str = "") -> str:
    return _env(f"VNE_MODEL_{model_index}_{field.upper()}", default)


def _model_code_for(model: VneModelConfig) -> Optional[str]:
    if model.model_code:
        return model.model_code
    return _virtuo_id_from_url(model.machine_url)


def _format_eur_it(value: Optional[float]) -> str:
    if value is None:
        return "—"
    try:
        num = float(value)
    except (TypeError, ValueError):
        return "—"
    return f"{num:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _summarize_vne_alarm(html: str, reachable: bool, accettatore: VneAccettatoreStatus, hopper: VneHopperStatus) -> str:
    if not reachable:
        if _is_vne_connection_error(html):
            return "Connessione assente"
        if _is_machine_blocked(html):
            return "Macchina non accessibile"
        return "Offline"
    alarms: List[str] = []
    err = (accettatore.errore or "").strip()
    if err and err.lower() not in {"no", "none", "0", "ok", "—", "-"}:
        alarms.append(f"Accettatore: {err}")
    for unit in hopper.units or []:
        unit_err = (unit.errore or "").strip()
        if unit_err and unit_err.lower() not in {"no", "none", "0", "ok", "—", "-"}:
            alarms.append(f"Hopper {unit.hopper}: {unit_err}")
        if (unit.vuoto or "").strip().lower() in {"si", "sì", "yes", "1"}:
            alarms.append(f"Hopper {unit.hopper} vuoto")
    return " · ".join(alarms) if alarms else "OK"


def _summarize_vne_levels(
    *,
    totale: Optional[float],
    banconote: Optional[float],
    monete: Optional[float],
    hopper: VneHopperStatus,
    reachable: bool,
) -> str:
    if not reachable:
        return "—"
    parts: List[str] = []
    if totale is not None:
        parts.append(f"Tot {_format_eur_it(totale)} €")
    if banconote is not None:
        parts.append(f"Ban {_format_eur_it(banconote)} €")
    if monete is not None:
        parts.append(f"Mon {_format_eur_it(monete)} €")
    if hopper.smart_hopper_1_eur:
        parts.append(f"Hopper {hopper.smart_hopper_1_eur} €")
    return " · ".join(parts) if parts else "—"


def _machine_overview_row(
    model: VneModelConfig,
    html: str,
    *,
    reachable: bool,
    detail: str,
    lista_entry: Optional[Dict[str, object]] = None,
    lista_loaded: bool = False,
) -> VneMachineOverviewRow:
    hopper = _parse_hopper(html) if reachable else VneHopperStatus()
    accettatore = _parse_accettatore(html) if reachable else VneAccettatoreStatus()
    banconote = (
        _extract_first_number(
            html,
            [r"Banconote:\s*([0-9.,]+)\s*&euro;", r"Banconote:\s*([0-9.,]+)\s*€"],
        )
        if reachable
        else None
    )
    monete = (
        _extract_first_number(
            html,
            [r"Monete:\s*([0-9.,]+)\s*&euro;", r"Monete:\s*([0-9.,]+)\s*€"],
        )
        if reachable
        else None
    )
    totale = (
        _extract_first_number(
            html,
            [
                r"Totale:\s*([0-9.,]+)\s*&euro;",
                r"Totale:\s*([0-9.,]+)\s*€",
                r"Totale\s+IN\s*:\s*([0-9.,]+)\s*&euro;",
            ],
        )
        if reachable
        else None
    )
    lista_sala = (lista_entry.get("sala") if lista_entry else None)
    lista_city = (lista_entry.get("city") if lista_entry else None)
    lista_region = (lista_entry.get("region") if lista_entry else None)
    return VneMachineOverviewRow(
        model_id=model.id,
        machine_name=model.label,
        model_code=_model_code_for(model),
        sala=_overview_field_from_lista(model.sala, lista_sala),
        city=_overview_field_from_lista(model.city, lista_city),
        region=_overview_field_from_lista(model.region, lista_region),
        alarm=_summarize_vne_alarm(html, reachable, accettatore, hopper),
        levels=_summarize_vne_levels(
            totale=totale,
            banconote=banconote,
            monete=monete,
            hopper=hopper,
            reachable=reachable,
        ),
        online=_online_label_for_overview(
            lista_entry=lista_entry,
            lista_loaded=lista_loaded,
            reachable=reachable,
        ),
        detail=detail or None,
        totale_eur=totale,
        banconote_eur=banconote,
        monete_eur=monete,
    )


def _env_url(name: str, default: str = "") -> str:
    """Legge URL da env. VNE Remote dal server Atlas risponde in HTTP (non HTTPS)."""
    raw = _env(name, default)
    if not raw:
        return raw
    if raw.startswith("//"):
        return f"http:{raw}"
    return raw


def _resolve_vne_url(base_origin: str, target: str) -> str:
    """URL assoluto in env oppure path relativo rispetto all'origine login."""
    t = (target or "").strip()
    if not t:
        return t
    if re.match(r"^https?://", t, flags=re.IGNORECASE):
        return t
    return urllib.parse.urljoin(base_origin.rstrip("/") + "/", t.lstrip("/"))


def _https_to_http_url(url: str) -> Optional[str]:
    if (url or "").lower().startswith("https://"):
        return "http://" + url[8:]
    return None


def _is_ssl_protocol_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "unsupported protocol" in msg or "wrong version number" in msg or "ssl" in msg and "protocol" in msg


_VIRTUO_SUPERvLT_FALLBACK: Dict[str, str] = {
    # Fallback solo se discovery live fallisce: il path supervlt cambia sul portale.
    "VIRTUO20221721": "32/250",  # La Risacca
    "VIRTUO20221720": "33/231",  # Mani in Pasta
    "VIRTUO20221707": "29/10",  # Le Mucche Volanti
}

# Path supervlt storici/errati ancora presenti in .env di produzione: vanno rimappati.
_LEGACY_WRONG_SUPERvLT_PAIRS = frozenset(
    {
        "22/25",  # vecchio Mani in Pasta
        "34/92",  # vecchio Mani in Pasta
        "17/122",  # vecchio Mani in Pasta
        "33/220",  # vecchio La Risacca
        "20/101",  # vecchio La Risacca
        "27/234",  # vecchio Le Mucche Volanti (a volte usato per errore su altre macchine)
    }
)


def _supervlt_pair_from_url(url: Optional[str]) -> Optional[str]:
    return _discover_supervlt_path_pair("", url or "")


def _other_virtuo_supervlt_pairs(virtuo_id: str) -> List[str]:
    return [
        pair
        for vid, pair in _VIRTUO_SUPERvLT_FALLBACK.items()
        if vid != virtuo_id and pair
    ]


def _should_remap_supervlt_pair(virtuo_id: str, current_pair: Optional[str], expected_pair: str) -> bool:
    if not current_pair:
        return True
    if current_pair == expected_pair:
        return False
    if current_pair in _other_virtuo_supervlt_pairs(virtuo_id):
        return True
    if current_pair in _LEGACY_WRONG_SUPERvLT_PAIRS:
        return True
    # Path custom sconosciuto: non forzare il fallback (es. nuova macchina).
    return False


def _is_virtuo_machine_url(url: Optional[str]) -> bool:
    return "/vne/virtuo" in (url or "").lower()


def _virtuo_id_from_url(url: Optional[str]) -> Optional[str]:
    m = re.search(r"/vne/(VIRTUO\d+)/?", url or "", flags=re.IGNORECASE)
    return m.group(1).upper() if m else None


def _is_vne_connection_error(html: str, url: str = "") -> bool:
    low = f"{html or ''} {url or ''}".lower()
    return "paginaerrore/connessione" in low


def _discover_supervlt_path_pair(html: str, *extra_urls: str) -> Optional[str]:
    corpus = "\n".join([html or ""] + [u or "" for u in extra_urls])
    for pattern in (
        r"(?:https?://[^\"'\s<>]+)?/(\d+/\d+)/supervlt/",
        r"['\"](/(\d+/\d+)/supervlt/?)['\"]",
    ):
        m = re.search(pattern, corpus, flags=re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def _supervlt_urls_from_virtuo_machine(machine_url: Optional[str]) -> Dict[str, str]:
    pair = _VIRTUO_SUPERvLT_FALLBACK.get(_virtuo_id_from_url(machine_url) or "")
    if not pair:
        return {}
    return _supervlt_urls_from_status(f"http://vneremote.com/{pair}/supervlt/stato")


def _supervlt_urls_from_status(status_url: Optional[str]) -> Dict[str, str]:
    """Deriva gli URL supervlt dal path .../supervlt/stato (es. /27/234/)."""
    url = (status_url or "").strip()
    if not url:
        return {}
    parsed = urllib.parse.urlparse(url)
    path = parsed.path or ""
    marker = "/supervlt/"
    idx = path.lower().find(marker)
    if idx < 0:
        return {}
    base_path = path[: idx + len(marker)].rstrip("/")
    origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""
    if not origin:
        return {}
    base = f"{origin}{base_path}"
    return {
        "status_url": f"{base}/stato",
        "sel_operazioni_url": f"{base}/sel_operazioni",
        "operazioni_url": f"{base}/operazioni/",
        "sel_chiusure_url": f"{base}/sel_chiusure",
        "chiusure_url": f"{base}/chiusure/",
        "contabilita_url": f"{base}/contabilita",
        "referer_url": f"{base}/?param=NO",
    }


def _virtuo_id_for_model(model: VneModelConfig) -> Optional[str]:
    return (_virtuo_id_from_url(model.machine_url) or model.model_code or "").upper() or None


def _enforce_virtuo_supervlt_mapping(model: VneModelConfig) -> VneModelConfig:
    """Corregge URL supervlt errati per macchine VIRTUO note (es. 27/234 su La Risacca)."""
    virtuo_id = _virtuo_id_for_model(model)
    pair = _VIRTUO_SUPERvLT_FALLBACK.get(virtuo_id or "")
    if not pair:
        return model
    status = (model.status_url or "").lower()
    if status and "/supervlt/" in status:
        current_pair = _supervlt_pair_from_url(model.status_url)
        if not _should_remap_supervlt_pair(virtuo_id or "", current_pair, pair):
            return model
    machine = model.machine_url or f"http://www.vneremote.com/vne/{virtuo_id}/"
    derived = _supervlt_urls_from_virtuo_machine(machine)
    if not derived:
        return model
    return VneModelConfig(
        id=model.id,
        label=model.label,
        machine_url=model.machine_url or machine,
        status_url=derived.get("status_url"),
        sel_operazioni_url=derived.get("sel_operazioni_url"),
        operazioni_url=derived.get("operazioni_url"),
        sel_chiusure_url=derived.get("sel_chiusure_url"),
        chiusure_url=derived.get("chiusure_url"),
        contabilita_url=derived.get("contabilita_url"),
        referer_url=derived.get("referer_url"),
        model_code=model.model_code or virtuo_id,
        sala=model.sala,
        city=model.city,
        region=model.region,
    )


def _complete_model_config(model: VneModelConfig) -> VneModelConfig:
    derived: Dict[str, str] = {}
    if model.status_url and "/supervlt/" in model.status_url.lower():
        derived = _supervlt_urls_from_status(model.status_url)
    elif model.machine_url:
        derived = _supervlt_urls_from_virtuo_machine(model.machine_url)
    if not derived:
        return _enforce_virtuo_supervlt_mapping(model)
    return _enforce_virtuo_supervlt_mapping(
        VneModelConfig(
        id=model.id,
        label=model.label,
        machine_url=model.machine_url,
        status_url=model.status_url or derived.get("status_url"),
        sel_operazioni_url=model.sel_operazioni_url or derived.get("sel_operazioni_url"),
        operazioni_url=model.operazioni_url or derived.get("operazioni_url"),
        sel_chiusure_url=model.sel_chiusure_url or derived.get("sel_chiusure_url"),
        chiusure_url=model.chiusure_url or derived.get("chiusure_url"),
        contabilita_url=model.contabilita_url or derived.get("contabilita_url"),
        referer_url=model.referer_url or derived.get("referer_url"),
        model_code=model.model_code,
        sala=model.sala,
        city=model.city,
        region=model.region,
        )
    )


def _models() -> List[VneModelConfig]:
    """Tre slot modelli VNE (1 configurato, 2-3 pronti)."""
    m1_machine = _env_url("VNE_MODEL_1_MACHINE_URL", "http://www.vneremote.com/vne/VIRTUO20221721/")
    m1 = _env_url("VNE_MODEL_1_STATUS_URL", "http://vneremote.com/32/250/supervlt/stato")
    m1_sel_ops = _env_url("VNE_MODEL_1_SEL_OPERAZIONI_URL", "")
    m1_ops = _env_url("VNE_MODEL_1_OPERAZIONI_URL", "")
    m1_sel_chiusure = _env_url("VNE_MODEL_1_SEL_CHIUSURE_URL", "")
    m1_chiusure = _env_url("VNE_MODEL_1_CHIUSURE_URL", "")
    m1_contabilita = _env_url("VNE_MODEL_1_CONTABILITA_URL", "")
    m1_ref = _env_url("VNE_MODEL_1_REFERER_URL", "http://vneremote.com/32/250/supervlt/?param=NO")
    m2_machine = _env_url("VNE_MODEL_2_MACHINE_URL", "http://www.vneremote.com/vne/VIRTUO20221720/")
    m2 = _env_url("VNE_MODEL_2_STATUS_URL", "http://vneremote.com/33/231/supervlt/stato")
    m2_sel_ops = _env_url("VNE_MODEL_2_SEL_OPERAZIONI_URL", "")
    m2_ops = _env_url("VNE_MODEL_2_OPERAZIONI_URL", "")
    m2_sel_chiusure = _env_url("VNE_MODEL_2_SEL_CHIUSURE_URL", "")
    m2_chiusure = _env_url("VNE_MODEL_2_CHIUSURE_URL", "")
    m2_contabilita = _env_url("VNE_MODEL_2_CONTABILITA_URL", "")
    m2_ref = _env_url("VNE_MODEL_2_REFERER_URL", "http://vneremote.com/33/231/supervlt/?param=NO")
    m3_machine = _env_url("VNE_MODEL_3_MACHINE_URL", "http://www.vneremote.com/vne/VIRTUO20221707/")
    m3 = _env_url("VNE_MODEL_3_STATUS_URL", "http://vneremote.com/29/10/supervlt/stato")
    m3_sel_ops = _env_url("VNE_MODEL_3_SEL_OPERAZIONI_URL", "")
    m3_ops = _env_url("VNE_MODEL_3_OPERAZIONI_URL", "")
    m3_sel_chiusure = _env_url("VNE_MODEL_3_SEL_CHIUSURE_URL", "")
    m3_chiusure = _env_url("VNE_MODEL_3_CHIUSURE_URL", "")
    m3_contabilita = _env_url("VNE_MODEL_3_CONTABILITA_URL", "")
    m3_ref = _env_url("VNE_MODEL_3_REFERER_URL", "http://vneremote.com/29/10/supervlt/?param=NO")
    raw = [
        VneModelConfig(
            id="model-1",
            label="La Risacca",
            machine_url=m1_machine or None,
            status_url=m1 or None,
            sel_operazioni_url=m1_sel_ops or None,
            operazioni_url=m1_ops or None,
            sel_chiusure_url=m1_sel_chiusure or None,
            chiusure_url=m1_chiusure or None,
            contabilita_url=m1_contabilita or None,
            referer_url=m1_ref or None,
            model_code=_env_model_meta(1, "MODEL_CODE", "VIRTUO20221721"),
            sala=_env_model_meta(1, "SALA", "Bar Momento"),
            city=_env_model_meta(1, "CITY", "Viareggio"),
            region=_env_model_meta(1, "REGION", "Toscana"),
        ),
        VneModelConfig(
            id="model-2",
            label="Mani in Pasta",
            machine_url=m2_machine or None,
            status_url=m2 or None,
            sel_operazioni_url=m2_sel_ops or None,
            operazioni_url=m2_ops or None,
            sel_chiusure_url=m2_sel_chiusure or None,
            chiusure_url=m2_chiusure or None,
            contabilita_url=m2_contabilita or None,
            referer_url=m2_ref or None,
            model_code=_env_model_meta(2, "MODEL_CODE", "VIRTUO20221720"),
            sala=_env_model_meta(2, "SALA", "Mani in Pasta"),
            city=_env_model_meta(2, "CITY", "Viareggio"),
            region=_env_model_meta(2, "REGION", "Toscana"),
        ),
        VneModelConfig(
            id="model-3",
            label="Le Mucche Volanti",
            machine_url=m3_machine or None,
            status_url=m3 or None,
            sel_operazioni_url=m3_sel_ops or None,
            operazioni_url=m3_ops or None,
            sel_chiusure_url=m3_sel_chiusure or None,
            chiusure_url=m3_chiusure or None,
            contabilita_url=m3_contabilita or None,
            referer_url=m3_ref or None,
            model_code=_env_model_meta(3, "MODEL_CODE", "VIRTUO20221707"),
            sala=_env_model_meta(3, "SALA", "Le Mucche Volanti"),
            city=_env_model_meta(3, "CITY", "Viareggio"),
            region=_env_model_meta(3, "REGION", "Toscana"),
        ),
    ]
    return [_complete_model_config(m) for m in raw]


def _credentials_configured() -> bool:
    return bool(_env("VNE_USERNAME") and _env("VNE_PASSWORD"))


def _missing_credentials_detail() -> str:
    return (
        "Credenziali VNE mancanti: configura VNE_USERNAME e VNE_PASSWORD "
        "nel backend (.env / Render Environment)."
    )


def _ensure_vne_credentials() -> None:
    if not _credentials_configured():
        raise HTTPException(status_code=503, detail=_missing_credentials_detail())


def _remaining_seconds(deadline: Optional[float]) -> Optional[float]:
    if deadline is None:
        return None
    return max(0.0, deadline - time.monotonic())


def _ensure_not_timed_out(deadline: Optional[float]) -> None:
    if deadline is None:
        return
    if _remaining_seconds(deadline) <= 0:
        raise TimeoutError("Timeout richiesta VNE")


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


def _html_to_plain_text(raw: str) -> str:
    x = raw or ""
    x = re.sub(r"(?i)&nbsp;|&#160;", " ", x)
    x = re.sub(r"(?i)<br\s*/?>", "\n", x)
    x = re.sub(r"(?i)</br>", "\n", x)
    x = re.sub(r"<[^>]+>", " ", x)
    x = html.unescape(x)
    return x


def _extract_status_section(html_text: str, section_name: str) -> str:
    rx = re.compile(
        rf'<tr>\s*<td\s+class=["\']titolo["\']\s+colspan\s*=\s*["\']?2["\']?\s*>\s*{re.escape(section_name)}\s*</td>\s*</tr>'
        rf"(.*?)(?:<tr>\s*<td\s+class=[\"']titolo[\"']|<tr>\s*<td\s+class=[\"']footer[\"'])",
        flags=re.IGNORECASE | re.DOTALL,
    )
    m = rx.search(html_text)
    return m.group(1) if m else ""


def _parse_label_value(block: str, label: str) -> Optional[str]:
    m = re.search(
        rf"{re.escape(label)}:\s*(.*?)(?:</br>|</td>|<br\s*/?>|\n|$)",
        block,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not m:
        return None
    val = _strip_html_block(m.group(1)).strip()
    return val or None


def _parse_denomination_items(block: str, unit_word: str) -> List[VneDenominationItem]:
    out: List[VneDenominationItem] = []
    seen: set[tuple[str, int]] = set()
    rx = re.compile(
        rf"(\d+(?:[.,]\d+)?)\s*(?:&euro;|€)\s*:\s*(\d+)\s*{unit_word}\b",
        flags=re.IGNORECASE,
    )
    for src in (block, _html_to_plain_text(block)):
        if not src:
            continue
        for m in rx.finditer(src):
            taglio = (m.group(1) or "").replace(",", ".").strip()
            try:
                qty = int(m.group(2))
            except (TypeError, ValueError):
                continue
            key = (taglio, qty)
            if key in seen:
                continue
            seen.add(key)
            out.append(VneDenominationItem(taglio_eur=taglio, quantita=qty))
        if out:
            break
    return out


def _parse_tab_rows(block: str, first_col_keyword: str, min_cols: int) -> List[List[str]]:
    rows_out: List[List[str]] = []
    row_rx = re.compile(r"<tr>(.*?)</tr>", flags=re.IGNORECASE | re.DOTALL)
    td_rx = re.compile(r'<td\s+class=["\']tab["\']>\s*(.*?)\s*</td>', flags=re.IGNORECASE | re.DOTALL)
    row_num_rx = re.compile(rf"{re.escape(first_col_keyword)}\s+(\d+)", flags=re.IGNORECASE)
    for row in row_rx.finditer(block):
        cols = [_strip_html_block(c) for c in td_rx.findall(row.group(1))]
        if len(cols) < min_cols:
            continue
        if not row_num_rx.search(cols[0]):
            continue
        rows_out.append(cols)
    return rows_out


def _parse_cassette(html: str) -> List[Dict[str, str]]:
    block = _extract_status_section(html, "Stato accettatore JCM") or html
    out: List[Dict[str, str]] = []
    for cols in _parse_tab_rows(block, "cassetta", 5):
        num = re.search(r"cassetta\s+(\d+)", cols[0], flags=re.IGNORECASE)
        out.append(
            {
                "cassetta": (num.group(1) if num else "").strip(),
                "presente": cols[1],
                "taglio_eur": cols[2],
                "banconote": cols[3],
                "totale_eur": cols[4],
            }
        )
    return out


def _parse_accettatore(html: str) -> VneAccettatoreStatus:
    block = _extract_status_section(html, "Stato accettatore JCM")
    if not block:
        return VneAccettatoreStatus()
    fw = _extract_text(r"Firmware version:\s*([^<\n]+)", block)
    return VneAccettatoreStatus(
        presente=_parse_label_value(block, "Presente"),
        errore=_parse_label_value(block, "Errore"),
        firmware=fw,
    )


def _parse_stacker_banconote(html: str) -> List[VneDenominationItem]:
    block = _extract_status_section(html, "Stato accettatore JCM")
    if not block:
        block = html
    return _parse_denomination_items(block, "banconote")


def _parse_hopper_monete(html: str, block: str) -> List[VneDenominationItem]:
    items = _parse_denomination_items(block, "monete")
    if items:
        return items
    smart = re.search(
        r"Smart\s+Hopper\s+1\s*:.*?(?:Firmware version:|$)",
        block,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if smart:
        items = _parse_denomination_items(smart.group(0), "monete")
        if items:
            return items
    return _parse_denomination_items(html, "monete")


def _parse_hopper(html: str) -> VneHopperStatus:
    block = _extract_status_section(html, "Stato Hopper")
    if not block:
        block = html
    amt = _extract_text(r"Smart\s+Hopper\s+1:\s*([0-9.,]+)\s*(?:&euro;|€)", block)
    fw = _extract_text(r"Firmware version:\s*([^<\n]+)", block)
    units: List[VneHopperUnit] = []
    for cols in _parse_tab_rows(block, "hopper", 5):
        num = re.search(r"hopper\s+(\d+)", cols[0], flags=re.IGNORECASE)
        units.append(
            VneHopperUnit(
                hopper=(num.group(1) if num else cols[0]).strip(),
                presente=cols[1],
                errore=cols[2],
                vuoto=cols[3],
                pieno=cols[4],
            )
        )
    monete = _parse_hopper_monete(html, block)
    return VneHopperStatus(
        smart_hopper_1_eur=amt,
        firmware=fw,
        monete=monete,
        units=units,
    )


def _extract_first_number(html_text: str, patterns: List[str]) -> Optional[float]:
    for p in patterns:
        v = _extract_number(p, html_text)
        if v is not None:
            return v
    return None


def _build_opener() -> tuple[urllib.request.OpenerDirector, CookieJar]:
    cj = CookieJar()
    ctx = ssl.create_default_context()
    try:
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    except AttributeError:
        pass
    https_handler = urllib.request.HTTPSHandler(context=ctx)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), https_handler)
    return opener, cj


def _origin_from_url(url: Optional[str], default: str = "http://vneremote.com") -> str:
    if not url:
        return default
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return default


def _model_origin(model: VneModelConfig, default: str = "http://www.vneremote.com") -> str:
    return _origin_from_url(model.machine_url or model.status_url, default=default)


def _has_vne_session(cj: CookieJar) -> bool:
    return any(c.name in ("sessionid", "sessionvneremote") for c in cj)


def _has_vne_machine_tunnel(cj: CookieJar) -> bool:
    """Cookie impostato dal portale quando si apre la macchina (vedi sessionvneremote)."""
    return any(c.name == "sessionvneremote" for c in cj)


def _machine_tunnel_urls(model: VneModelConfig) -> List[str]:
    """URL da visitare per agganciare il tunnel; ?param=NO per primo (come nel browser)."""
    raw: List[str] = []
    if model.machine_url:
        for mu in _host_variants(model.machine_url):
            raw.append(mu)
    for ru in _host_variants(model.referer_url):
        if not ru:
            continue
        base = ru.split("?")[0].rstrip("/") + "/"
        raw.append(base + "?param=NO")
        raw.append(ru)
        raw.append(base)
    if model.status_url:
        base_dir = model.status_url.rsplit("/", 1)[0] + "/"
        for su in _host_variants(base_dir):
            raw.append(su + "?param=NO")
            raw.append(su)
    seen: set[str] = set()
    out: List[str] = []
    for u in raw:
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _is_machine_blocked(html: str) -> bool:
    low = (html or "").lower()
    markers = (
        "impossibile accedere alla macchina",
        "imposible acceder a la maquina",
        "não se consegue acesso",
        "nao se consegue acesso",
        "no se puede acceder a la maquina",
        "unable to access the machine",
    )
    return any(m in low for m in markers)


def _looks_like_login_page(html: str) -> bool:
    low = (html or "").lower()
    has_user = 'name="username"' in low or "name='username'" in low
    has_pass = 'type="password"' in low or "type='password'" in low
    return has_user and has_pass


def _strip_td_text(raw: str) -> str:
    x = raw or ""
    x = re.sub(r"(?i)<br\s*/?>", " ", x)
    x = re.sub(r"<[^>]+>", " ", x)
    return re.sub(r"\s+", " ", html.unescape(x)).strip()


def _normalize_vne_lista_field(text: str) -> Optional[str]:
    cleaned = (text or "").strip()
    if not cleaned or cleaned.lower() in {"none", "non disponibile"}:
        return None
    return cleaned


def _parse_vne_lista_online(td_html: str) -> Optional[bool]:
    low = (td_html or "").lower()
    if 'alt="on"' in low or "iconaonverticale" in low:
        return True
    if 'alt="off"' in low or "iconaoffverticale" in low:
        return False
    return None


def _parse_vne_lista_page(html_text: str) -> Dict[str, Dict[str, object]]:
    """Estrae righe da /vne/lista/ indicizzate per codice VIRTUO."""
    if not html_text or _looks_like_login_page(html_text):
        return {}
    rows: Dict[str, Dict[str, object]] = {}
    tbody_match = re.search(r"<tbody>(.*?)</tbody>", html_text, flags=re.IGNORECASE | re.DOTALL)
    if not tbody_match:
        return rows
    for tr in re.finditer(r"<tr[^>]*>(.*?)</tr>", tbody_match.group(1), flags=re.IGNORECASE | re.DOTALL):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", tr.group(1), flags=re.IGNORECASE | re.DOTALL)
        if len(cells) < 8:
            continue
        machine_code = _strip_td_text(cells[0])
        virtuo_match = re.search(r"VIRTUO\d+", machine_code, flags=re.IGNORECASE)
        if not virtuo_match:
            continue
        key = virtuo_match.group(0).upper()
        rows[key] = {
            "machine_code": key,
            "model_name": _normalize_vne_lista_field(_strip_td_text(cells[1])),
            "sala": _normalize_vne_lista_field(_strip_td_text(cells[2])),
            "city": _normalize_vne_lista_field(_strip_td_text(cells[3])),
            "region": _normalize_vne_lista_field(_strip_td_text(cells[4])),
            "alarm": _normalize_vne_lista_field(_strip_td_text(cells[5])),
            "levels": _normalize_vne_lista_field(_strip_td_text(cells[6])),
            "online": _parse_vne_lista_online(cells[7]),
        }
    return rows


def _fetch_vne_lista_map(
    opener: urllib.request.OpenerDirector,
    *,
    origin: str,
    deadline: Optional[float] = None,
) -> Dict[str, Dict[str, object]]:
    landing_url = _env_url("VNE_LANDING_URL", f"{origin.rstrip('/')}/vne/")
    lista_url = _env_url("VNE_LIST_URL", f"{origin.rstrip('/')}/vne/lista/")
    try:
        _fetch_html(opener, landing_url, referer=landing_url, deadline=deadline)
    except Exception:
        pass
    html_text = _fetch_html(opener, lista_url, referer=landing_url, deadline=deadline)
    if _looks_like_login_page(html_text):
        return {}
    return _parse_vne_lista_page(html_text)


def _online_label_for_overview(
    *,
    lista_entry: Optional[Dict[str, object]],
    lista_loaded: bool,
    reachable: bool,
) -> str:
    if lista_loaded:
        if not lista_entry:
            return "Non in lista"
        online = lista_entry.get("online")
        if online is True:
            return "Online"
        if online is False:
            return "Offline"
        return "Non disponibile"
    if _credentials_configured():
        return "Non disponibile"
    return "Online" if reachable else "Offline"


def _overview_field_from_lista(model_value: Optional[str], lista_value: Optional[str]) -> Optional[str]:
    if model_value:
        return model_value
    return lista_value or None


def _status_html_ok(html: str) -> bool:
    if not html or _is_machine_blocked(html) or _looks_like_login_page(html):
        return False
    low = html.lower()
    return 'class="title"' in low or "<title>stato</title>" in low or "stato accettatore" in low


def _status_referer(model: VneModelConfig) -> str:
    """Referer usato dal browser per /stato (menu macchina con ?param=NO)."""
    return _referer_for_model_page(model) or model.referer_url or _base_supervlt_referer(model)


def _vne_post_login(
    opener: urllib.request.OpenerDirector,
    cj: CookieJar,
    page_url: str,
    post_url: str,
    post_data: Dict[str, str],
    deadline: Optional[float] = None,
) -> bool:
    """POST login; True se compare sessionid o sessionvneremote (anche se redirect landing fallisce)."""
    page_origin = f"{urllib.parse.urlparse(page_url).scheme}://{urllib.parse.urlparse(page_url).netloc}"
    body = urllib.parse.urlencode(post_data).encode("utf-8")
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": page_url,
        "Origin": page_origin,
    }
    try:
        _open_bytes_with_retries(
            opener,
            urllib.request.Request(post_url, data=body, headers=headers),
            deadline=deadline,
        )
    except Exception:
        if not _has_vne_session(cj):
            return False
    return _has_vne_session(cj)


def _cookie_jar_from_opener(opener: urllib.request.OpenerDirector) -> Optional[CookieJar]:
    for handler in opener.handlers:
        if isinstance(handler, urllib.request.HTTPCookieProcessor):
            return handler.cookiejar
    return None


def _navigate_machine_tunnel(
    opener: urllib.request.OpenerDirector,
    model: VneModelConfig,
    origin: str,
    deadline: Optional[float] = None,
) -> None:
    """Simula login → /vne/lista/ → macchina VIRTUO → tunnel supervlt."""
    landing_url = _env_url("VNE_LANDING_URL", f"{origin.rstrip('/')}/vne/")
    lista_url = _env_url("VNE_LIST_URL", f"{origin.rstrip('/')}/vne/lista/")
    try:
        _fetch_html(opener, landing_url, referer=landing_url, deadline=deadline)
    except Exception:
        pass
    try:
        _fetch_html(opener, lista_url, referer=landing_url, deadline=deadline)
    except Exception:
        pass
    if model.machine_url:
        for mu in _host_variants(model.machine_url):
            try:
                _fetch_html(opener, mu, referer=lista_url, deadline=deadline)
            except Exception:
                continue
    _warm_machine_session(opener, model, deadline=deadline, cj=_cookie_jar_from_opener(opener))


def _resolve_model_config(
    model: VneModelConfig,
    opener: urllib.request.OpenerDirector,
    origin: str,
    deadline: Optional[float] = None,
) -> VneModelConfig:
    """Dopo login, apre la pagina VIRTUO e preferisce il path supervlt live (iframe)."""
    base = _complete_model_config(model)
    machine_url = model.machine_url or (
        model.status_url if _is_virtuo_machine_url(model.status_url) else None
    )
    if not machine_url:
        return base
    lista_url = _env_url("VNE_LIST_URL", f"{origin.rstrip('/')}/vne/lista/")
    pair: Optional[str] = None
    for mu in _host_variants(machine_url):
        try:
            html = _fetch_html(opener, mu, referer=lista_url, deadline=deadline)
            if _is_vne_connection_error(html, mu):
                continue
            pair = _discover_supervlt_path_pair(html, mu) or pair
            if pair:
                break
        except Exception:
            continue
    if not pair:
        return base
    current = _supervlt_pair_from_url(base.status_url)
    if current == pair:
        return base
    discovered = _supervlt_urls_from_status(f"http://vneremote.com/{pair}/supervlt/stato")
    if not discovered:
        return base
    return VneModelConfig(
        id=base.id,
        label=base.label,
        machine_url=machine_url or base.machine_url,
        status_url=discovered.get("status_url"),
        sel_operazioni_url=discovered.get("sel_operazioni_url"),
        operazioni_url=discovered.get("operazioni_url"),
        sel_chiusure_url=discovered.get("sel_chiusure_url"),
        chiusure_url=discovered.get("chiusure_url"),
        contabilita_url=discovered.get("contabilita_url"),
        referer_url=discovered.get("referer_url"),
        model_code=base.model_code,
        sala=base.sala,
        city=base.city,
        region=base.region,
    )


def _warm_machine_session(
    opener: urllib.request.OpenerDirector,
    model: VneModelConfig,
    deadline: Optional[float] = None,
    cj: Optional[CookieJar] = None,
) -> None:
    """Visita pagine base del modello; serve sessionvneremote (referer ?param=NO)."""
    for url in _machine_tunnel_urls(model):
        try:
            _fetch_html(opener, url, referer=url, deadline=deadline)
            if cj is not None and _has_vne_machine_tunnel(cj):
                return
        except Exception:
            continue


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


def _maybe_login_vne(
    opener: urllib.request.OpenerDirector,
    cj: CookieJar,
    deadline: Optional[float] = None,
    origin: Optional[str] = None,
) -> bool:
    """
    Login su VNE Remote. Ritorna True se la sessione portale (sessionid o sessionvneremote) è attiva.
    """
    base_origin = origin or "http://vneremote.com"
    login_page_url = _env_url("VNE_LOGIN_URL", f"{base_origin}/accounts/login/?next=/vne/")
    login_post_url = _env_url("VNE_LOGIN_POST_URL", f"{base_origin}/login/")
    landing_url = _env_url("VNE_LANDING_URL", f"{base_origin}/vne/")
    username = _env("VNE_USERNAME")
    password = _env("VNE_PASSWORD")
    if not username or not password:
        return False

    page_candidates: List[str] = []
    if "://vneremote.com/" in login_page_url and "://www." not in login_page_url:
        page_candidates.append(login_page_url.replace("://vneremote.com/", "://www.vneremote.com/"))
    page_candidates.append(login_page_url)
    if "://www.vneremote.com/" in login_page_url:
        page_candidates.append(login_page_url.replace("://www.vneremote.com/", "://vneremote.com/"))
    elif "://vneremote.com/" in login_page_url and login_page_url not in page_candidates:
        page_candidates.append(login_page_url.replace("://vneremote.com/", "://www.vneremote.com/"))
    # dedup
    seen_pages: set[str] = set()
    uniq_pages: List[str] = []
    for u in page_candidates:
        if u and u not in seen_pages:
            seen_pages.add(u)
            uniq_pages.append(u)
    page_candidates = uniq_pages

    for page_url in page_candidates:
        _ensure_not_timed_out(deadline)
        try:
            req = urllib.request.Request(page_url, headers={"User-Agent": "Mozilla/5.0"})
            html = _open_bytes_with_retries(opener, req, deadline=deadline).decode("utf-8", errors="ignore")
            csrf = _extract_text(r"name=['\"]csrfmiddlewaretoken['\"]\s+value=['\"]([^'\"]+)['\"]", html) or ""
            parsed_page = urllib.parse.urlparse(page_url)
            next_param = urllib.parse.parse_qs(parsed_page.query).get("next", ["/vne/"])[0]
            post_data = {
                "username": username,
                "password": password,
                "next": next_param,
            }
            if csrf:
                post_data["csrfmiddlewaretoken"] = csrf
            page_origin = f"{parsed_page.scheme}://{parsed_page.netloc}"
            post_targets: List[str] = []
            for target in (_resolve_vne_url(page_origin, login_post_url), page_url):
                if target and target not in post_targets:
                    post_targets.append(target)
            landing = _resolve_vne_url(page_origin, landing_url)
            logged = False
            for post_url in post_targets:
                if _vne_post_login(opener, cj, page_url, post_url, post_data, deadline=deadline):
                    logged = True
                    break
            if not logged:
                continue
            try:
                landing_html = _fetch_html(opener, landing, referer=page_url, deadline=deadline)
                if _looks_like_login_page(landing_html):
                    continue
            except Exception:
                pass
            return True
        except Exception:
            continue
    return False


def _ensure_vne_login(
    opener: urllib.request.OpenerDirector,
    cj: CookieJar,
    deadline: Optional[float] = None,
    origin: Optional[str] = None,
) -> None:
    if not _maybe_login_vne(opener, cj, deadline=deadline, origin=origin):
        raise HTTPException(
            status_code=503,
            detail="Login VNE fallito: verifica VNE_USERNAME e VNE_PASSWORD nel backend .env",
        )


def _read_status_html(
    opener: urllib.request.OpenerDirector,
    model: VneModelConfig,
    deadline: Optional[float] = None,
) -> str:
    return _open_bytes_with_retries(
        opener,
        _build_req(model.status_url or "", _status_referer(model)),
        deadline=deadline,
    ).decode("utf-8", errors="ignore")


def _authenticated_status_html(
    model: VneModelConfig,
    opener: urllib.request.OpenerDirector,
    cj: CookieJar,
    deadline: float,
    *,
    force_fresh_login: bool = False,
    http_session: Optional[_VneHttpSession] = None,
) -> tuple[str, VneModelConfig]:
    """Login VNE + discovery path live + navigazione portale + lettura stato."""
    origin = _model_origin(model)
    if http_session is not None:
        http_session.login(origin=origin, force=force_fresh_login)
        opener = http_session.opener
        cj = http_session.cj
    else:
        if force_fresh_login:
            opener, cj = _build_opener()
        _maybe_login_vne(opener, cj, deadline=deadline, origin=origin)
    resolved = _resolve_model_config(model, opener, origin, deadline=deadline)
    _navigate_machine_tunnel(opener, resolved, origin, deadline=deadline)
    return _read_status_html(opener, resolved, deadline=deadline), resolved


def _probe_model_status(model: VneModelConfig, http_session: _VneHttpSession) -> str:
    """Lettura rapida stato per healthcheck: login condiviso, budget per modello."""
    origin = _model_origin(model)
    model_deadline = min(
        http_session.deadline,
        time.monotonic() + max(5.0, VNE_HEALTH_PER_MODEL_SEC),
    )
    html_text = ""
    try:
        html_text = _read_status_html(http_session.opener, model, deadline=model_deadline)
        if _status_html_ok(html_text):
            return html_text
    except TimeoutError:
        raise
    except Exception:
        pass
    if not _credentials_configured():
        return html_text if _status_html_ok(html_text) else ""
    html_text, _resolved = _authenticated_status_html(
        model,
        http_session.opener,
        http_session.cj,
        model_deadline,
        http_session=http_session,
    )
    return html_text


def _referer_for_model_page(model: VneModelConfig) -> str:
    for u in _machine_tunnel_urls(model):
        if "param=NO" in u:
            return u
    return model.referer_url or ""


def _base_supervlt_referer(model: VneModelConfig) -> str:
    """Referer menu macchina (es. .../supervlt/) usato da sel_operazioni e sel_chiusure."""
    if model.status_url:
        return model.status_url.rsplit("/", 1)[0] + "/"
    return _referer_for_model_page(model)


@dataclass
class _VneModelSession:
    opener: urllib.request.OpenerDirector
    cj: CookieJar
    deadline: float
    model: VneModelConfig
    origin: str

    @classmethod
    def open(cls, model: VneModelConfig, max_seconds: Optional[float] = None) -> "_VneModelSession":
        _ensure_vne_credentials()
        opener, cj = _build_opener()
        origin = _model_origin(model)
        deadline = time.monotonic() + (max_seconds or VNE_STATUS_MAX_TOTAL_SEC)
        _maybe_login_vne(opener, cj, deadline=deadline, origin=origin)
        resolved = _resolve_model_config(model, opener, origin, deadline=deadline)
        _navigate_machine_tunnel(opener, resolved, origin, deadline=deadline)
        return cls(opener=opener, cj=cj, deadline=deadline, model=resolved, origin=origin)

    def fetch(self, url: str, *, referer: Optional[str] = None, data: Optional[bytes] = None) -> str:
        ref = referer or _referer_for_model_page(self.model)
        return _fetch_html(self.opener, url, referer=ref, data=data, deadline=self.deadline)


def _fetch_authenticated_model_page(
    model: VneModelConfig,
    url: str,
    *,
    referer: Optional[str] = None,
    data: Optional[bytes] = None,
    force_fresh: bool = False,
) -> str:
    """Login + tunnel macchina (sessionvneremote) poi GET/POST pagina VNE."""
    session = _VneModelSession.open(model)
    if force_fresh:
        session = _VneModelSession.open(model)
    return session.fetch(url, referer=referer, data=data)


def _fetch_model_status(model: VneModelConfig, http_session: Optional[_VneHttpSession] = None) -> str:
    if not model.status_url:
        raise HTTPException(status_code=400, detail=f"{model.label} non configurato: imposta URL stato nel backend .env")

    started = time.monotonic()
    if http_session is not None:
        opener, cj = http_session.opener, http_session.cj
        request_deadline = http_session.deadline
    else:
        opener, cj = _build_opener()
        request_deadline = started + VNE_STATUS_MAX_TOTAL_SEC

    def _raise_timeout() -> None:
        raise HTTPException(status_code=504, detail="Timeout VNE: macchina non raggiungibile in tempo utile")

    active = model

    # Molti endpoint stato rispondono in HTTP con referer ?param=NO, senza login Django.
    html_text = ""
    try:
        html_text = _read_status_html(opener, active, deadline=request_deadline)
        if _status_html_ok(html_text):
            return html_text
    except TimeoutError:
        _raise_timeout()
    except Exception:
        pass

    if not _credentials_configured():
        if _status_html_ok(html_text):
            return html_text
        raise HTTPException(status_code=503, detail=_missing_credentials_detail())

    html_text, active = _authenticated_status_html(
        model,
        opener,
        cj,
        request_deadline,
        http_session=http_session,
    )

    # Alcune macchine richiedono un "passaggio" sulla pagina base del modello
    # per agganciare correttamente la sessione prima della lettura stato.
    if _is_machine_blocked(html_text):
        retry_started = time.monotonic()
        # Costruisci candidate URL stato: host varianti + trailing slash on/off.
        status_candidates: List[str] = []
        for su in _host_variants(active.status_url):
            status_candidates.append(su)
            status_candidates.append(su.rstrip("/"))
            status_candidates.append(su.rstrip("/") + "/")

        # Costruisci referer candidati: referer configurato + base directory dello stato.
        referer_candidates: List[str] = []
        for ru in _host_variants(active.referer_url):
            referer_candidates.append(ru)
        for su in status_candidates[:2]:
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
        uniq_status = uniq_status[:3]

        seen_ref: set[str] = set()
        uniq_ref: List[str] = []
        for u in referer_candidates:
            if u and u not in seen_ref:
                seen_ref.add(u)
                uniq_ref.append(u)
        uniq_ref = uniq_ref[: max(1, VNE_STATUS_REFERER_RETRY_MAX)]

        for ref in uniq_ref:
            if (time.monotonic() - retry_started) > VNE_STATUS_RETRY_MAX_SEC:
                break
            if (time.monotonic() - started) > VNE_STATUS_MAX_TOTAL_SEC:
                break
            if _remaining_seconds(request_deadline) <= 0:
                _raise_timeout()
            try:
                _fetch_html(opener, ref, referer=ref, deadline=request_deadline)
            except Exception:
                pass
            for su in uniq_status:
                if (time.monotonic() - started) > VNE_STATUS_MAX_TOTAL_SEC:
                    break
                if _remaining_seconds(request_deadline) <= 0:
                    _raise_timeout()
                try:
                    retry_html = _open_bytes_with_retries(opener, _build_req(su, ref), deadline=request_deadline).decode("utf-8", errors="ignore")
                    if not _is_machine_blocked(retry_html):
                        return retry_html
                except Exception:
                    continue

    if _is_machine_blocked(html_text):
        # Sul portale VNE il tunnel macchina scade: logout+login lo ripristina.
        try:
            fresh_opener, fresh_cj = _build_opener()
            if http_session is not None:
                http_session.opener, http_session.cj = fresh_opener, fresh_cj
                http_session.logged_in = False
            html_text, _active = _authenticated_status_html(
                model,
                fresh_opener,
                fresh_cj,
                request_deadline,
                force_fresh_login=True,
                http_session=http_session,
            )
        except HTTPException:
            pass

    return html_text


def _build_req(url: str, referer: Optional[str] = None, data: Optional[bytes] = None) -> urllib.request.Request:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    if referer:
        headers["Referer"] = referer
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        # Django CSRF sui POST VNE richiede Origin allineato all'host della richiesta.
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme and parsed.netloc:
            headers["Origin"] = f"{parsed.scheme}://{parsed.netloc}"
    return urllib.request.Request(url, data=data, headers=headers)


def _csrf_from_html(html_text: str) -> str:
    return _extract_text(r"name=['\"]csrfmiddlewaretoken['\"]\s+value=['\"]([^'\"]+)['\"]", html_text) or ""


def _filter_page_usable(html_text: str) -> bool:
    if not html_text or _is_machine_blocked(html_text) or _looks_like_login_page(html_text):
        return False
    return bool(_csrf_from_html(html_text))


def _open_model_filter_session(
    model: VneModelConfig,
    filter_url: str,
    *,
    referer: str,
    feature_label: str,
    max_seconds: Optional[float] = None,
) -> Tuple["_VneModelSession", str, VneModelConfig]:
    """Apre sessione macchina e carica la pagina filtri; ritenta una volta se bloccata/senza CSRF."""
    last_html = ""
    last_exc: Optional[Exception] = None
    budget = max_seconds or VNE_ANALYTICS_MAX_TOTAL_SEC
    for _attempt in range(2):
        try:
            session = _VneModelSession.open(model, max_seconds=budget)
            active = session.model
            menu = (active.referer_url or _base_supervlt_referer(active) or referer or "").strip()
            if menu:
                try:
                    session.fetch(menu, referer=menu)
                except Exception:
                    pass
            if active.status_url:
                try:
                    session.fetch(active.status_url, referer=_status_referer(active))
                except Exception:
                    pass

            candidates: List[str] = []
            for u in _host_variants(filter_url):
                if u and u not in candidates:
                    candidates.append(u)
            alt_filter = ""
            if filter_url == (model.sel_operazioni_url or "") and active.sel_operazioni_url:
                alt_filter = active.sel_operazioni_url
            elif filter_url == (model.sel_chiusure_url or "") and active.sel_chiusure_url:
                alt_filter = active.sel_chiusure_url
            for u in _host_variants(alt_filter):
                if u and u not in candidates:
                    candidates.append(u)

            for candidate in candidates:
                try:
                    html_text = session.fetch(candidate, referer=referer or menu or candidate)
                    last_html = html_text or ""
                    if _filter_page_usable(last_html):
                        return session, last_html, active
                except Exception as exc:
                    last_exc = exc
                    continue
        except TimeoutError:
            raise HTTPException(status_code=504, detail=f"Timeout lettura filtri {feature_label} VNE")
        except Exception as exc:
            last_exc = exc
            continue
    if _is_machine_blocked(last_html):
        raise HTTPException(
            status_code=502,
            detail=(
                f"{feature_label} VNE non disponibili per {model.label}: "
                "macchina non accessibile sul portale remoto"
            ),
        )
    if last_exc:
        raise HTTPException(status_code=502, detail=f"Errore lettura pagina filtri {feature_label} VNE: {last_exc}")
    raise HTTPException(
        status_code=502,
        detail=(
            f"{feature_label} VNE non disponibili per {model.label}: "
            "sessione/filtri non validi (CSRF mancante)"
        ),
    )


def _post_vne_filtered_page(
    model: VneModelConfig,
    session: "_VneModelSession",
    *,
    filter_url: str,
    post_url: str,
    form_data: List[tuple[str, str]],
    base_ref: str,
    feature_label: str,
) -> str:
    """POST filtri VNE; su 403/macchina bloccata rinnova sessione e ritenta una volta."""
    body = urllib.parse.urlencode(form_data, doseq=True).encode("utf-8")

    def _refresh_and_post() -> str:
        nonlocal session, form_data, body
        session = _VneModelSession.open(model, max_seconds=VNE_ANALYTICS_MAX_TOTAL_SEC)
        filter_html = session.fetch(filter_url, referer=base_ref)
        if _is_machine_blocked(filter_html):
            raise HTTPException(
                status_code=502,
                detail=(
                    f"{feature_label} VNE non disponibili per {model.label}: "
                    "macchina non accessibile sul portale remoto"
                ),
            )
        csrf = _csrf_from_html(filter_html)
        if not csrf:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"{feature_label} VNE non disponibili per {model.label}: "
                    "sessione/filtri non validi (CSRF mancante)"
                ),
            )
        form_data = [("csrfmiddlewaretoken", csrf)] + [p for p in form_data if p[0] != "csrfmiddlewaretoken"]
        body = urllib.parse.urlencode(form_data, doseq=True).encode("utf-8")
        return session.fetch(post_url, referer=filter_url, data=body)

    try:
        html_text = session.fetch(post_url, referer=filter_url, data=body)
        if _is_machine_blocked(html_text):
            html_text = _refresh_and_post()
        return html_text
    except TimeoutError:
        raise HTTPException(status_code=504, detail=f"Timeout query {feature_label} VNE")
    except urllib.error.HTTPError as exc:
        if exc.code == 403:
            try:
                return _refresh_and_post()
            except HTTPException:
                raise
            except TimeoutError:
                raise HTTPException(status_code=504, detail=f"Timeout query {feature_label} VNE")
            except Exception as retry_exc:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        f"{feature_label} VNE non disponibili per {model.label}: "
                        f"accesso negato dal portale ({retry_exc})"
                    ),
                ) from retry_exc
        raise HTTPException(status_code=502, detail=f"Errore query {feature_label} VNE: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Errore query {feature_label} VNE: {exc}") from exc


def _open_bytes_with_retries(opener: urllib.request.OpenerDirector, req: urllib.request.Request, deadline: Optional[float] = None) -> bytes:
    last_exc: Optional[Exception] = None
    attempts = max(1, VNE_HTTP_RETRIES + 1)
    for idx in range(attempts):
        _ensure_not_timed_out(deadline)
        try:
            remaining = _remaining_seconds(deadline)
            timeout = VNE_HTTP_TIMEOUT_SEC if remaining is None else max(0.5, min(VNE_HTTP_TIMEOUT_SEC, remaining))
            with opener.open(req, timeout=timeout) as resp:
                return resp.read()
        except TimeoutError as e:
            last_exc = e
            break
        except Exception as e:
            last_exc = e
            if idx >= attempts - 1:
                break
            remaining = _remaining_seconds(deadline)
            if remaining is not None and remaining <= 0:
                break
            sleep_for = VNE_HTTP_RETRY_DELAY_SEC * (idx + 1)
            if remaining is not None:
                sleep_for = min(sleep_for, max(0.0, remaining))
            if sleep_for > 0:
                time.sleep(sleep_for)

    # Alcuni endpoint VNE rispondono in HTTP chiaro: retry solo per GET (no credenziali nel body).
    if last_exc and _is_ssl_protocol_error(last_exc) and req.data is None and req.full_url:
        fallback = _https_to_http_url(req.full_url)
        if fallback:
            try:
                _ensure_not_timed_out(deadline)
                remaining = _remaining_seconds(deadline)
                timeout = VNE_HTTP_TIMEOUT_SEC if remaining is None else max(0.5, min(VNE_HTTP_TIMEOUT_SEC, remaining))
                fb_req = urllib.request.Request(
                    fallback,
                    headers=dict(req.header_items()),
                    method=req.get_method(),
                )
                with opener.open(fb_req, timeout=timeout) as resp:
                    return resp.read()
            except Exception as e:
                last_exc = e

    if last_exc:
        raise last_exc
    raise RuntimeError("Errore HTTP VNE sconosciuto")


def _fetch_html(
    opener: urllib.request.OpenerDirector,
    url: str,
    referer: Optional[str] = None,
    data: Optional[bytes] = None,
    deadline: Optional[float] = None,
) -> str:
    req = _build_req(url, referer=referer, data=data)
    raw = _open_bytes_with_retries(opener, req, deadline=deadline)
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
                or m.machine_url
                or m.sel_operazioni_url
                or m.operazioni_url
                or m.sel_chiusure_url
                or m.chiusure_url
                or m.contabilita_url
            ),
        )
        for m in _models()
    ]


@router.get("/health", response_model=VneHealthOut)
def get_vne_health():
    credentials_ok = _credentials_configured()
    models_out: List[VneHealthModelOut] = []
    configured_models = [m for m in _models() if m.status_url or m.machine_url]
    session: Optional[_VneHttpSession] = None
    if configured_models:
        health_budget = max(
            VNE_HEALTH_MAX_TOTAL_SEC,
            VNE_HEALTH_PER_MODEL_SEC * len(configured_models) + 20.0,
        )
        session = _VneHttpSession.create(max_seconds=health_budget)
    for model in _models():
        is_configured = bool(model.status_url or model.machine_url)
        if not is_configured:
            models_out.append(
                VneHealthModelOut(
                    model_id=model.id,
                    model_label=model.label,
                    configured=False,
                    reachable=False,
                    detail="URL stato non configurato",
                )
            )
            continue
        try:
            html = _probe_model_status(model, session) if session else _fetch_model_status(model)
            reachable = _status_html_ok(html)
            if not reachable and _is_machine_blocked(html):
                detail = "Portale VNE raggiungibile ma macchina non accessibile"
            elif reachable and not credentials_ok:
                detail = "OK (stato pubblico; credenziali non configurate per operazioni)"
            elif reachable:
                detail = "OK"
            else:
                detail = _missing_credentials_detail() if not credentials_ok else "Risposta stato non valida"
            models_out.append(
                VneHealthModelOut(
                    model_id=model.id,
                    model_label=model.label,
                    configured=True,
                    reachable=reachable,
                    detail=detail,
                )
            )
        except TimeoutError:
            models_out.append(
                VneHealthModelOut(
                    model_id=model.id,
                    model_label=model.label,
                    configured=True,
                    reachable=False,
                    detail="Timeout healthcheck VNE (portale lento o macchina non risponde)",
                )
            )
        except HTTPException as exc:
            models_out.append(
                VneHealthModelOut(
                    model_id=model.id,
                    model_label=model.label,
                    configured=True,
                    reachable=False,
                    detail=str(exc.detail),
                )
            )
        except Exception as exc:
            models_out.append(
                VneHealthModelOut(
                    model_id=model.id,
                    model_label=model.label,
                    configured=True,
                    reachable=False,
                    detail=f"Errore healthcheck: {exc}",
                )
            )
    return VneHealthOut(
        ok=credentials_ok and all((not m.configured) or m.reachable for m in models_out),
        credentials_configured=credentials_ok,
        credentials_message="OK" if credentials_ok else _missing_credentials_detail(),
        models=models_out,
    )


@router.get("/machines/overview", response_model=VneMachinesOverviewOut)
def get_machines_overview():
    configured_models = [m for m in _models() if m.status_url or m.machine_url]
    session: Optional[_VneHttpSession] = None
    if configured_models:
        health_budget = max(
            VNE_HEALTH_MAX_TOTAL_SEC,
            VNE_HEALTH_PER_MODEL_SEC * len(configured_models) + 20.0,
        )
        session = _VneHttpSession.create(max_seconds=health_budget)
    lista_by_virtuo: Dict[str, Dict[str, object]] = {}
    lista_loaded = False
    if session and _credentials_configured():
        origin = _model_origin(configured_models[0])
        if session.login(origin=origin):
            try:
                lista_by_virtuo = _fetch_vne_lista_map(
                    session.opener,
                    origin=origin,
                    deadline=session.deadline,
                )
                lista_loaded = bool(lista_by_virtuo)
            except Exception:
                lista_by_virtuo = {}
    rows: List[VneMachineOverviewRow] = []
    updated_at: Optional[str] = None
    for model in _models():
        if not (model.status_url or model.machine_url):
            rows.append(
                VneMachineOverviewRow(
                    model_id=model.id,
                    machine_name=model.label,
                    model_code=_model_code_for(model),
                    sala=model.sala,
                    city=model.city,
                    region=model.region,
                    alarm="Non configurata",
                    levels="—",
                    online="Offline",
                    detail="URL macchina non configurato",
                )
            )
            continue
        html = ""
        detail = ""
        reachable = False
        try:
            html = _probe_model_status(model, session) if session else _fetch_model_status(model)
            reachable = _status_html_ok(html)
            if not reachable and _is_machine_blocked(html):
                detail = "Macchina non accessibile sul portale remoto"
            elif reachable:
                detail = "OK"
                updated_at = _extract_text(r"Sistema di controllo remoto<br/>\s*([^<]+)\s*</td>", html) or updated_at
            else:
                detail = "Risposta stato non valida"
        except HTTPException as exc:
            detail = str(exc.detail)
        except TimeoutError:
            detail = "Timeout lettura stato"
        except Exception as exc:
            detail = f"Errore: {exc}"
        virtuo_code = (_model_code_for(model) or "").upper()
        lista_entry = lista_by_virtuo.get(virtuo_code) if virtuo_code else None
        rows.append(
            _machine_overview_row(
                model,
                html,
                reachable=reachable,
                detail=detail,
                lista_entry=lista_entry,
                lista_loaded=lista_loaded,
            )
        )
    return VneMachinesOverviewOut(rows=rows, updated_at=updated_at)


@router.get("/models/{model_id}/status", response_model=VneStatusOut)
def get_model_status(model_id: str):
    model = next((m for m in _models() if m.id == model_id), None)
    if not model:
        raise HTTPException(status_code=404, detail="Modello VNE non trovato")
    if not model.status_url:
        raise HTTPException(status_code=400, detail=f"{model.label} non configurato: imposta URL stato nel backend .env")
    html = _fetch_model_status(model)
    hopper = _parse_hopper(html)
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
        accettatore=_parse_accettatore(html),
        cassette=_parse_cassette(html),
        stacker_banconote=_parse_stacker_banconote(html),
        hopper=hopper,
        monete_dettaglio=hopper.monete,
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
    _ensure_vne_credentials()
    _session, html, _active = _open_model_filter_session(
        model,
        model.sel_operazioni_url,
        referer=_base_supervlt_referer(model),
        feature_label="Operazioni",
    )

    operations = _extract_values_by_name(html, "operation")
    users = _extract_values_by_name(html, "utenti")
    csrf = _csrf_from_html(html)
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
    _ensure_vne_credentials()
    base_ref = _base_supervlt_referer(model)
    session, filter_html, active = _open_model_filter_session(
        model,
        model.sel_operazioni_url,
        referer=base_ref,
        feature_label="Operazioni",
    )

    csrf = _csrf_from_html(filter_html)
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

    filter_url = active.sel_operazioni_url or model.sel_operazioni_url
    post_url = active.operazioni_url or model.operazioni_url
    html = _post_vne_filtered_page(
        active,
        session,
        filter_url=filter_url,
        post_url=post_url,
        form_data=form_data,
        base_ref=base_ref,
        feature_label="Operazioni",
    )

    if _is_machine_blocked(html):
        raise HTTPException(
            status_code=502,
            detail=f"Operazioni VNE non disponibili per {model.label}: macchina non accessibile sul portale remoto",
        )

    rows = _parse_operations_rows(html)
    next_path = _extract_text(r'<a class="mainLink"\s+href="([^"]+)">\s*Next\s*</a>', html)
    next_url = urllib.parse.urljoin(post_url, next_path) if next_path else None
    excerpt = re.sub(r"\s+", " ", html)
    return VneOperationsOut(
        model_id=model.id,
        model_label=model.label,
        fetched_url=post_url,
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
    _ensure_vne_credentials()
    _session, html, _active = _open_model_filter_session(
        model,
        model.sel_chiusure_url,
        referer=_base_supervlt_referer(model),
        feature_label="Chiusure",
    )
    operators = _extract_values_by_name(html, "operators")
    csrf = _csrf_from_html(html)
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
    _ensure_vne_credentials()

    referer = _referer_for_model_page(model)
    try:
        page_html = _fetch_authenticated_model_page(model, model.contabilita_url, referer=referer)
        if _is_machine_blocked(page_html):
            page_html = _fetch_authenticated_model_page(
                model, model.contabilita_url, referer=referer, force_fresh=True
            )
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Timeout lettura contabilita VNE")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore lettura contabilita VNE: {e}")

    if _is_machine_blocked(page_html):
        raise HTTPException(
            status_code=502,
            detail=f"Contabilita VNE non disponibile per {model.label}: macchina non accessibile sul portale remoto",
        )

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
    _ensure_vne_credentials()
    base_ref = _base_supervlt_referer(model)
    session, filter_html, active = _open_model_filter_session(
        model,
        model.sel_chiusure_url,
        referer=base_ref,
        feature_label="Chiusure",
    )
    csrf = _csrf_from_html(filter_html)
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
    filter_url = active.sel_chiusure_url or model.sel_chiusure_url
    post_url = active.chiusure_url or model.chiusure_url
    html = _post_vne_filtered_page(
        active,
        session,
        filter_url=filter_url,
        post_url=post_url,
        form_data=form_data,
        base_ref=base_ref,
        feature_label="Chiusure",
    )
    if _is_machine_blocked(html):
        raise HTTPException(
            status_code=502,
            detail=f"Chiusure VNE non disponibili per {model.label}: macchina non accessibile sul portale remoto",
        )
    rows = _parse_cash_closing_rows(html)
    next_path = _extract_text(r'<a class="mainLink"\s+href="([^"]+)">\s*Next\s*</a>', html)
    next_url = urllib.parse.urljoin(post_url, next_path) if next_path else None
    excerpt = re.sub(r"\s+", " ", html)
    return VneCashClosingOut(
        model_id=model.id,
        model_label=model.label,
        fetched_url=post_url,
        rows=rows,
        next_url=next_url,
        raw_excerpt=excerpt[:1800],
    )


def to_vne_day_date(d: date, *, end_of_day: bool = False) -> str:
    """Formato filtro portale: dd-mm-yyyy HH:MM."""
    hhmm = "23:59" if end_of_day else "00:00"
    return f"{d.day:02d}-{d.month:02d}-{d.year:04d} {hhmm}"


def parse_vne_when_text(text: Optional[str]) -> Optional[datetime]:
    """Parsa 'Operazione/Chiusura del' in datetime locale.

    Formati reali portale, es.:
    - 23/7/2026 alle 20:5:3
    - 23-07-2026 14:35
    - 23/07/2026 09:00:00
    """
    raw = re.sub(r"\s+", " ", (text or "").strip())
    if not raw or raw == "—":
        return None
    raw = re.sub(r"(?i)^(operazione|chiusura)\s+del:?\s*", "", raw).strip()

    # Formato italiano portale: gg/m/aaaa alle h:m:s (anche senza zero)
    m = re.search(
        r"(?i)(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s*(?:alle|at|,)?\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?",
        raw,
    )
    if m:
        day_i, month_i, year_i = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if year_i < 100:
            year_i += 2000
        hour_i = int(m.group(4) or 0)
        minute_i = int(m.group(5) or 0)
        second_i = int(m.group(6) or 0)
        try:
            return datetime(year_i, month_i, day_i, hour_i, minute_i, second_i)
        except ValueError:
            pass

    candidates = [raw]
    m2 = re.search(r"(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)", raw)
    if m2:
        candidates.insert(0, m2.group(1).strip())
    formats = (
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    )
    for cand in candidates:
        for fmt in formats:
            try:
                return datetime.strptime(cand, fmt)
            except ValueError:
                continue
    return None


def _follow_vne_next_pages(
    session: "_VneModelSession",
    html: str,
    *,
    base_url: str,
    parse_rows,
    max_pages: int = 12,
) -> List[Any]:
    rows = list(parse_rows(html) or [])
    pages = 1
    current = html
    while pages < max(1, max_pages):
        next_path = _extract_text(r'<a class="mainLink"\s+href="([^"]+)">\s*Next\s*</a>', current)
        if not next_path:
            break
        next_url = urllib.parse.urljoin(base_url, next_path)
        try:
            current = session.fetch(next_url, referer=base_url)
        except Exception:
            break
        if _is_machine_blocked(current):
            break
        more = parse_rows(current) or []
        if not more:
            break
        rows.extend(more)
        pages += 1
    return rows


def collect_model_operations(
    model: VneModelConfig,
    date_from: date,
    date_to: date,
    *,
    max_pages: int = 12,
) -> List[VneOperationRow]:
    """Scarica operazioni VNE (con paginazione) per un intervallo date."""
    if not model.sel_operazioni_url or not model.operazioni_url:
        return []
    _ensure_vne_credentials()
    base_ref = _base_supervlt_referer(model)
    session = _VneModelSession.open(model, max_seconds=VNE_ANALYTICS_MAX_TOTAL_SEC)
    filter_html = session.fetch(model.sel_operazioni_url, referer=base_ref)
    csrf = _extract_text(r"name=['\"]csrfmiddlewaretoken['\"]\s+value=['\"]([^'\"]+)['\"]", filter_html) or ""
    form_data: List[tuple[str, str]] = []
    if csrf:
        form_data.append(("csrfmiddlewaretoken", csrf))
    form_data.append(("filters", "filterData"))
    form_data.append(("init_day_date", to_vne_day_date(date_from)))
    form_data.append(("end_day_date", to_vne_day_date(date_to, end_of_day=True)))
    body = urllib.parse.urlencode(form_data, doseq=True).encode("utf-8")
    html = session.fetch(model.operazioni_url, referer=model.sel_operazioni_url, data=body)
    if _is_machine_blocked(html):
        return []
    return _follow_vne_next_pages(
        session,
        html,
        base_url=model.operazioni_url,
        parse_rows=_parse_operations_rows,
        max_pages=max_pages,
    )


def collect_model_cash_closings(
    model: VneModelConfig,
    date_from: date,
    date_to: date,
    *,
    max_pages: int = 8,
) -> List[VneCashClosingRow]:
    """Scarica chiusure cassa VNE (con paginazione) per un intervallo date."""
    if not model.sel_chiusure_url or not model.chiusure_url:
        return []
    _ensure_vne_credentials()
    base_ref = _base_supervlt_referer(model)
    session = _VneModelSession.open(model, max_seconds=VNE_ANALYTICS_MAX_TOTAL_SEC)
    filter_html = session.fetch(model.sel_chiusure_url, referer=base_ref)
    csrf = _extract_text(r"name=['\"]csrfmiddlewaretoken['\"]\s+value=['\"]([^'\"]+)['\"]", filter_html) or ""
    form_data: List[tuple[str, str]] = []
    if csrf:
        form_data.append(("csrfmiddlewaretoken", csrf))
    form_data.append(("filters", "filterData"))
    form_data.append(("init_day_date", to_vne_day_date(date_from)))
    form_data.append(("end_day_date", to_vne_day_date(date_to, end_of_day=True)))
    body = urllib.parse.urlencode(form_data, doseq=True).encode("utf-8")
    html = session.fetch(model.chiusure_url, referer=model.sel_chiusure_url, data=body)
    if _is_machine_blocked(html):
        return []
    return _follow_vne_next_pages(
        session,
        html,
        base_url=model.chiusure_url,
        parse_rows=_parse_cash_closing_rows,
        max_pages=max_pages,
    )


@dataclass
class VneAnalyticsEvent:
    source: str  # operation | closing
    model_id: str
    model_label: str
    when: datetime
    amount: float
    label: str
    when_text: str


def collect_analytics_events(
    *,
    date_from: date,
    date_to: date,
    model_id: Optional[str] = None,
    max_op_pages: int = 12,
    max_closing_pages: int = 8,
) -> tuple[List[VneAnalyticsEvent], List[str]]:
    """
    Raccoglie operazioni + chiusure da tutte le macchine (o una sola).
    Ritorna (events, warnings).
    """
    models = [m for m in _models() if m.status_url or m.machine_url]
    if model_id and model_id not in ("all", "*", ""):
        models = [m for m in models if m.id == model_id]
        if not models:
            return [], [f"Macchina VNE non trovata: {model_id}"]

    events: List[VneAnalyticsEvent] = []
    warnings: List[str] = []

    for model in models:
        try:
            ops = collect_model_operations(model, date_from, date_to, max_pages=max_op_pages)
            for row in ops:
                when = parse_vne_when_text(row.when_text)
                if not when:
                    continue
                amount = float(row.value_eur or 0.0)
                events.append(
                    VneAnalyticsEvent(
                        source="operation",
                        model_id=model.id,
                        model_label=model.label,
                        when=when,
                        amount=amount,
                        label=(row.operation_type or "operazione").strip() or "operazione",
                        when_text=row.when_text,
                    )
                )
        except Exception as e:
            warnings.append(f"Operazioni {model.label}: {e}")

        try:
            closings = collect_model_cash_closings(model, date_from, date_to, max_pages=max_closing_pages)
            for row in closings:
                when = parse_vne_when_text(row.when_text)
                if not when:
                    continue
                amount = float(row.total_eur or 0.0)
                events.append(
                    VneAnalyticsEvent(
                        source="closing",
                        model_id=model.id,
                        model_label=model.label,
                        when=when,
                        amount=amount,
                        label="chiusura cassa",
                        when_text=row.when_text,
                    )
                )
        except Exception as e:
            warnings.append(f"Chiusure {model.label}: {e}")

    events.sort(key=lambda e: e.when)
    return events, warnings

