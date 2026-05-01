import base64
import io
import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse


router = APIRouter(prefix="/aruba", tags=["aruba"])

_TOKEN_LOCK = threading.Lock()
_TOKEN_CACHE: Dict[str, Any] = {"access_token": None, "expires_at": None}
_ASSIGN_LOCK = threading.Lock()
_ASSIGNMENTS_PATH = Path(__file__).resolve().parent.parent / "uploads" / "aruba_manual_assignments.json"


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _get_env_config() -> Dict[str, Any]:
    env_name = _env("ARUBA_API_ENV", "production").lower()
    if env_name == "demo":
        auth_base = "https://demoauth.fatturazioneelettronica.aruba.it"
        api_base = "https://demows.fatturazioneelettronica.aruba.it"
    else:
        auth_base = "https://auth.fatturazioneelettronica.aruba.it"
        api_base = "https://ws.fatturazioneelettronica.aruba.it"

    username = _env("ARUBA_API_USERNAME")
    password = _env("ARUBA_API_PASSWORD")
    owner_username = _env("ARUBA_API_OWNER_USERNAME", username)

    if not username or not password or not owner_username:
        raise HTTPException(
            status_code=500,
            detail=(
                "Config Aruba mancante. Imposta ARUBA_API_USERNAME, "
                "ARUBA_API_PASSWORD e ARUBA_API_OWNER_USERNAME (opzionale)."
            ),
        )

    return {
        "auth_base": auth_base,
        "api_base": api_base,
        "username": username,
        "password": password,
        "owner_username": owner_username,
        "receiver_country": _env("ARUBA_RECEIVER_COUNTRY", "IT"),
        "receiver_vat": _env("ARUBA_RECEIVER_VATCODE"),
        "receiver_fiscal": _env("ARUBA_RECEIVER_FISCALCODE"),
        "abba_keywords": [k.strip().lower() for k in _env("ARUBA_DEST_ABBA_KEYWORDS", "abba,via abba").split(",") if k.strip()],
        "zan_keywords": [k.strip().lower() for k in _env("ARUBA_DEST_ZANARDELLI_KEYWORDS", "zanardelli,via zanardelli").split(",") if k.strip()],
    }


def _open_json(
    url: str,
    method: str = "GET",
    token: Optional[str] = None,
    data: Optional[bytes] = None,
    content_type: Optional[str] = None,
) -> Any:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=18) as res:
            return json.loads(res.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"Errore Aruba API {exc.code}: {body[:280]}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Aruba non raggiungibile: {exc.reason}") from exc


def _get_token(cfg: Dict[str, Any]) -> str:
    now = datetime.now(timezone.utc)
    with _TOKEN_LOCK:
        cached = _TOKEN_CACHE.get("access_token")
        expires_at = _TOKEN_CACHE.get("expires_at")
        if cached and isinstance(expires_at, datetime) and expires_at > now + timedelta(seconds=30):
            return cached

        payload = urllib.parse.urlencode(
            {"grant_type": "password", "username": cfg["username"], "password": cfg["password"]}
        ).encode("utf-8")
        data = _open_json(
            f"{cfg['auth_base']}/auth/signin",
            method="POST",
            data=payload,
            content_type="application/x-www-form-urlencoded;charset=UTF-8",
        )
        token = str(data.get("access_token") or "")
        if not token:
            raise HTTPException(status_code=502, detail="Token Aruba non ricevuto")

        _TOKEN_CACHE["access_token"] = token
        _TOKEN_CACHE["expires_at"] = now + timedelta(minutes=25)
        return token


def _extract_content(data: Any) -> Any:
    if isinstance(data, dict) and isinstance(data.get("content"), (dict, list, str)):
        return data.get("content")
    return data


def _flatten_base64_candidates(data: Any) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    if isinstance(data, dict):
        for k, v in data.items():
            key = str(k).lower()
            if isinstance(v, str) and len(v) > 60:
                out.append((key, v))
            else:
                out.extend(_flatten_base64_candidates(v))
    elif isinstance(data, list):
        for item in data:
            out.extend(_flatten_base64_candidates(item))
    return out


def _decode_possible_base64(value: str) -> Optional[bytes]:
    raw = value.strip()
    if not raw:
        return None
    if raw.startswith("<"):
        return raw.encode("utf-8")
    try:
        cleaned = "".join(raw.split())
        return base64.b64decode(cleaned, validate=False)
    except Exception:
        return None


def _find_xml_text(payload: Any) -> Optional[str]:
    for key, value in _flatten_base64_candidates(payload):
        blob = _decode_possible_base64(value)
        if not blob:
            continue
        text = blob.decode("utf-8", errors="ignore")
        if "<FatturaElettronica" in text:
            return text
        if key.endswith("xml") and text.strip().startswith("<"):
            return text
    return None


def _find_pdf_bytes(payload: Any) -> Optional[bytes]:
    for key, value in _flatten_base64_candidates(payload):
        if "pdf" not in key:
            continue
        blob = _decode_possible_base64(value)
        if blob and blob.startswith(b"%PDF"):
            return blob
    return None


def _extract_destination(xml_text: str) -> str:
    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return ""
    indirizzo = root.findtext(".//{*}CessionarioCommittente/{*}Sede/{*}Indirizzo") or ""
    numero = root.findtext(".//{*}CessionarioCommittente/{*}Sede/{*}NumeroCivico") or ""
    comune = root.findtext(".//{*}CessionarioCommittente/{*}Sede/{*}Comune") or ""
    provincia = root.findtext(".//{*}CessionarioCommittente/{*}Sede/{*}Provincia") or ""
    cap = root.findtext(".//{*}CessionarioCommittente/{*}Sede/{*}CAP") or ""
    parts = [p.strip() for p in [indirizzo, numero, cap, comune, provincia] if p and p.strip()]
    return ", ".join(parts)


def _pick_section(destination: str, cfg: Dict[str, Any]) -> str:
    low = destination.lower()
    if any(k in low for k in cfg["abba_keywords"]):
        return "abba"
    if any(k in low for k in cfg["zan_keywords"]):
        return "zanardelli"
    return "non_classificata"


def _get_invoice_detail(token: str, cfg: Dict[str, Any], filename: str) -> Dict[str, Any]:
    base = cfg["api_base"]
    unsigned_url = f"{base}/services/invoice/in/getInvoiceWithUnsignedFile?{urllib.parse.urlencode({'filename': filename})}"
    return _open_json(unsigned_url, token=token)


def _fetch_received_rows(
    token: str,
    cfg: Dict[str, Any],
    days: int,
    size: int,
    include_receiver_filters: bool,
    max_pages: int = 4,
) -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days)).isoformat()
    end = now.isoformat()
    all_rows: List[Dict[str, Any]] = []

    for page in range(1, max_pages + 1):
        params: Dict[str, str] = {
            "username": cfg["owner_username"],
            "page": str(page),
            "size": str(size),
            "startDate": start,
            "endDate": end,
        }
        if include_receiver_filters:
            if cfg["receiver_country"]:
                params["countryReceiver"] = cfg["receiver_country"]
            if cfg["receiver_vat"]:
                params["vatcodeReceiver"] = cfg["receiver_vat"]
            if cfg["receiver_fiscal"]:
                params["fiscalcodeReceiver"] = cfg["receiver_fiscal"]

        list_url = f"{cfg['api_base']}/services/invoice/in/findByUsername?{urllib.parse.urlencode(params)}"
        listed = _open_json(list_url, token=token)
        content = _extract_content(listed)
        rows = content if isinstance(content, list) else []
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < size:
            break

    return all_rows


def _read_manual_assignments() -> Dict[str, str]:
    if not _ASSIGNMENTS_PATH.exists():
        return {}
    try:
        data = json.loads(_ASSIGNMENTS_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
        clean: Dict[str, str] = {}
        for key, value in data.items():
            section = str(value or "").strip().lower()
            if section in ("abba", "zanardelli", "non_classificata"):
                clean[str(key)] = section
        return clean
    except Exception:
        return {}


def _write_manual_assignments(data: Dict[str, str]) -> None:
    _ASSIGNMENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _ASSIGNMENTS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


@router.get("/invoices/received")
def list_aruba_received_invoices(
    days: int = Query(default=45, ge=1, le=180),
    size: int = Query(default=40, ge=1, le=100),
):
    cfg = _get_env_config()
    token = _get_token(cfg)
    rows = _fetch_received_rows(token, cfg, days=days, size=size, include_receiver_filters=True, max_pages=4)
    fallback_used = False
    if not rows:
        # Fallback: alcuni account non popolano correttamente i campi receiver* via API
        rows = _fetch_received_rows(token, cfg, days=days, size=size, include_receiver_filters=False, max_pages=4)
        fallback_used = True

    manual = _read_manual_assignments()
    invoices: List[Dict[str, Any]] = []
    for item in rows:
        filename = str(item.get("filename") or "")
        if not filename:
            continue
        detail = _get_invoice_detail(token, cfg, filename)
        xml_text = _find_xml_text(detail) or ""
        destination = _extract_destination(xml_text) if xml_text else ""
        auto_section = _pick_section(destination, cfg)
        section = manual.get(filename, auto_section)
        item_invoices = item.get("invoices") or []
        first_meta = item_invoices[0] if item_invoices and isinstance(item_invoices[0], dict) else {}
        invoices.append(
            {
                "id": item.get("id"),
                "filename": filename,
                "invoice_number": first_meta.get("number") or "",
                "invoice_date": first_meta.get("invoiceDate") or item.get("creationDate"),
                "supplier_name": (item.get("sender") or {}).get("description") if isinstance(item.get("sender"), dict) else "",
                "destination": destination,
                "section": section,
                "auto_section": auto_section,
                "manual_section": manual.get(filename),
            }
        )

    return {
        "abba": [x for x in invoices if x["section"] == "abba"],
        "zanardelli": [x for x in invoices if x["section"] == "zanardelli"],
        "non_classificata": [x for x in invoices if x["section"] == "non_classificata"],
        "debug": {
            "rows_found": len(rows),
            "fallback_without_receiver_filters": fallback_used,
        },
    }


@router.post("/invoices/assign")
def assign_aruba_invoice_section(
    filename: str = Query(..., min_length=3),
    section: str = Query(..., pattern="^(abba|zanardelli|non_classificata)$"),
):
    with _ASSIGN_LOCK:
        current = _read_manual_assignments()
        current[filename] = section
        _write_manual_assignments(current)
    return {"ok": True, "filename": filename, "section": section}


@router.get("/invoices/download")
def download_aruba_invoice(
    filename: str = Query(..., min_length=3),
    kind: str = Query("xml", pattern="^(xml|pdf)$"),
):
    cfg = _get_env_config()
    token = _get_token(cfg)
    if kind == "xml":
        detail = _get_invoice_detail(token, cfg, filename)
        xml_text = _find_xml_text(detail)
        if not xml_text:
            raise HTTPException(status_code=404, detail="XML non disponibile")
        stream = io.BytesIO(xml_text.encode("utf-8"))
        out_name = f"{filename}.xml" if not filename.endswith(".xml") else filename
        return StreamingResponse(
            stream,
            media_type="application/xml",
            headers={"Content-Disposition": f'attachment; filename="{out_name}"'},
        )

    detail_url = f"{cfg['api_base']}/services/invoice/in/getByFilename?{urllib.parse.urlencode({'filename': filename, 'includePdf': 'true'})}"
    detail = _open_json(detail_url, token=token)
    pdf_bytes = _find_pdf_bytes(detail)
    if not pdf_bytes:
        raise HTTPException(status_code=404, detail="PDF non disponibile")
    out_name = f"{filename}.pdf" if not filename.endswith(".pdf") else filename
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{out_name}"'},
    )
