"""Lettura scontrini da database Firebird EasyRetail (.gdb).

Pensato per girare sul PC cassa (dove c'è fbclient.dll di EasyRetail/Firebird).
Il server ATLAS di solito NON ha il GDB: l'agent locale pusha via /pos-receipts/ingest.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

try:
    from zoneinfo import ZoneInfo

    ROME = ZoneInfo("Europe/Rome")
except Exception:  # pragma: no cover
    ROME = timezone(timedelta(hours=2))

logger = logging.getLogger(__name__)

# Tabelle candidate (EasyRetail POS)
_TABLE_CANDIDATES = (
    "SCONTRINI",
    "SCONTRINO",
    "TICKET",
    "TICKETS",
    "MOVIMENTIT",
    "MOVIMENTI",
    "VENDITE",
    "GIORNATEPOS",
)

_ID_COL_CANDIDATES = (
    "NUMEROMOVIMENTO",
    "NUMEROSCONTRINO",
    "NUMEROTICKET",
    "NUMERO",
    "PROGRESSIVO",
    "IDSCONTRINO",
    "ID",
    "CODICE",
)
_TS_COL_CANDIDATES = (
    "DATAORA",
    "DATAMOVIMENTO",
    "DATASCONTRINO",
    "DATA_ORA",
    "TIMESTAMP",
    "DATAEORA",
)
_DATE_COL_CANDIDATES = (
    "DATADOCUMENTO",
    "DATAMOVIMENTO",
    "DATASCONTRINO",
    "DATAGIORNATA",
    "DATA",
    "GIORNATA",
)
_TIME_COL_CANDIDATES = ("ORA", "ORAMOVIMENTO", "ORASCONTRINO", "ORARIO")
_AMOUNT_COL_CANDIDATES = (
    "TOTALEDOCUMENTO",
    "TOTALEIVATO",
    "TOTALEVENDITA",
    "TOTALESCONTRINO",
    "TOTALENETTO",
    "TOTALEIMPONIBILE",
    "TOTALE",
    "IMPORTO",
    "VALORE",
)
_STORE_COL_CANDIDATES = (
    "CODICEPOS",
    "CODICEPOSTAZIONE",
    "POSTAZIONE",
    "CASSA",
    "NEGOZIO",
    "SEDE",
    "CODICENEGOZIO",
    "MAGAZZINO",
    "NUMEROMAGAZZINODA",
    "IDPOS",
)
_VOID_COL_CANDIDATES = (
    "ANNULLATO",
    "FLAGANNULLATO",
    "DOCUMENTOANNULLATO",
    "LOGICDELETE",
    "CANCELLATO",
    "STORNO",
    "VOID",
)
_RECEIPT_CASH_AMOUNT_COLS = (
    "IMPORTOCONTANTI",
    "CONTANTI",
    "TOTCONTANTI",
    "PAGAMENTOCONTANTI",
    "IMPORTOCASH",
    "VALORECONTANTI",
)
_RECEIPT_CARD_AMOUNT_COLS = (
    "IMPORTOCARTA",
    "CARTA",
    "TOTCARTA",
    "BANCOMAT",
    "PAGAMENTOCARTA",
    "IMPORTOPOS",
    "IMPORTOELETTRONICO",
    "VALORECARTA",
    "VALOREPOS",
)
_RECEIPT_PAYMENT_TYPE_COLS = (
    "NUMEROFORMAPAGAMENTO",
    "NUMEROTIPOPAGAMENTO",
    "FORMAPAGAMENTO",
    "TIPOPAGAMENTO",
    "CODICEPAGAMENTO",
    "MODALITAPAGAMENTO",
    "REF_FORMAPAGAMENTO",
    "PAGAMENTO",
)
_PAYMENT_TABLE_CANDIDATES = (
    "PAGAMENTI",
    "MOVIMENTIPAGAMENTI",
    "PAGAMENTIMOVIMENTI",
    "PAGAMENTISCONTRINI",
    "SCONTRINIPAGAMENTI",
    "DETTAGLIOPAGAMENTI",
    "RIGHEPAGAMENTI",
    "PAGAMENTIPOS",
    "SCONTRINIPAG",
    "MOVIMENTIR",
)
_PAYMENT_LINK_COL_CANDIDATES = (
    "NUMEROMOVIMENTO",
    "NUMEROSCONTRINO",
    "NUMEROTICKET",
    "IDSCONTRINO",
    "REF_SCONTRINO",
    "SCONTRINO",
    "NUMERO",
    "PROGRESSIVO",
    "ID",
)
_PAYMENT_TYPE_COL_CANDIDATES = (
    "NUMEROFORMAPAGAMENTO",
    "NUMEROTIPOPAGAMENTO",
    "TIPOPAGAMENTO",
    "CODICEPAGAMENTO",
    "FORMAPAGAMENTO",
    "MODALITAPAGAMENTO",
    "REF_FORMAPAGAMENTO",
    "PAGAMENTO",
    "CODPAGAMENTO",
    "TIPO",
)
_PAYMENT_AMOUNT_COL_CANDIDATES = (
    "IMPORTO",
    "IMPORTOPAGAMENTO",
    "VALORE",
    "TOTALE",
    "IMPORTOPAGATO",
    "TOTALEDOCUMENTO",
)
_PAYMENT_DESC_COL_CANDIDATES = (
    "DESCRIZIONE",
    "NOMEPAGAMENTO",
    "FORMAPAGAMENTO",
    "TIPOPAGAMENTO",
)
_PAYMENT_LOOKUP_TABLE_CANDIDATES = (
    "FORMEPAGAMENTI",
    "FORMEPAGAMENTO",
    "FORMAPAGAMENTO",
    "FORMAPAGAMENTI",
    "TIPIPAGAMENTI",
    "TIPIPAGAMENTO",
    "TIPOPAGAMENTO",
    "TIPOPAGAMENTOPOS",
    "TIPIDIPAGAMENTO",
    "MODALITAPAGAMENTO",
)
_PAYMENT_LOOKUP_ID_COLS = (
    "NUMEROFORMAPAGAMENTO",
    "NUMEROTIPOPAGAMENTO",
    "NUMERO",
    "CODICE",
    "CODICEFORMAPAGAMENTO",
    "CODICETIPOPAGAMENTO",
    "ID",
    "NUMEROINTERNO",
    "CODPAGAMENTO",
)
_PAYMENT_LOOKUP_DESC_COLS = (
    "DESCRIZIONE",
    "NOME",
    "TIPOPAGAMENTO",
    "FORMAPAGAMENTO",
    "CODICETIPOPAGAMENTO",
    "CODICEFORMAPAGAMENTO",
    "PAGAMENTO",
    "LABEL",
)


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def gdb_config_from_env() -> Dict[str, Any]:
    """Config sync GDB da variabili ambiente."""
    dsn = _env("EASYRETAIL_GDB_DSN") or _env("EASYRETAIL_GDB_PATH")
    return {
        "enabled": _env("EASYRETAIL_GDB_SYNC_ENABLED", "0").lower() in ("1", "true", "yes"),
        "dsn": dsn,
        "user": _env("EASYRETAIL_GDB_USER", "SYSDBA") or "SYSDBA",
        "password": _env("EASYRETAIL_GDB_PASSWORD", "masterkey") or "masterkey",
        "fbclient": _env("EASYRETAIL_FBCLIENT") or _env("EASYRETAIL_FBCLIENT_DLL"),
        "model_id": _env("EASYRETAIL_MODEL_ID") or None,
        "lookback_hours": max(1, int(_env("EASYRETAIL_GDB_LOOKBACK_HOURS", "48") or "48")),
        "interval_sec": max(60, int(_env("EASYRETAIL_GDB_SYNC_INTERVAL_SEC", "180") or "180")),
        "charset": _env("EASYRETAIL_GDB_CHARSET", "WIN1252") or "WIN1252",
    }


def resolve_fbclient(explicit: Optional[str] = None) -> Optional[str]:
    """Trova fbclient.dll (EasyRetail / Firebird / vendor)."""
    candidates: List[Path] = []
    if explicit:
        candidates.append(Path(explicit))
    env_path = _env("EASYRETAIL_FBCLIENT") or _env("EASYRETAIL_FBCLIENT_DLL")
    if env_path:
        candidates.append(Path(env_path))
    here = Path(__file__).resolve()
    candidates.extend(
        [
            here.parents[2] / "vendor" / "firebird" / "fbclient.dll",
            Path(r"C:\EasyRetail\DBase\fbclient.dll"),
            Path(r"C:\Program Files\EasyRetail\DBase\fbclient.dll"),
            Path(r"C:\Program Files (x86)\EasyRetail\DBase\fbclient.dll"),
            Path(r"C:\Program Files\Firebird\Firebird_3_0\fbclient.dll"),
            Path(r"C:\Program Files\Firebird\Firebird_4_0\fbclient.dll"),
            Path(r"C:\Program Files\Firebird\Firebird_5_0\fbclient.dll"),
        ]
    )
    # Nearby EasyRetail installs under Downloads / common roots
    for root in (Path(r"C:\EasyRetail"), Path(r"D:\EasyRetail"), Path.home() / "EasyRetail"):
        candidates.append(root / "DBase" / "fbclient.dll")
    for p in candidates:
        try:
            if p.is_file():
                return str(p.resolve())
        except OSError:
            continue
    return None


def _load_fdb(fbclient: Optional[str] = None):
    try:
        import fdb  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "Pacchetto Python 'fdb' non installato. Sul PC cassa: pip install fdb"
        ) from e
    lib = resolve_fbclient(fbclient)
    if lib:
        try:
            fdb.load_api(lib)
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("fdb.load_api(%s) fallita: %s — riprovo default", lib, exc)
        os.environ["PATH"] = str(Path(lib).parent) + os.pathsep + os.environ.get("PATH", "")
    return fdb, lib


def _dsn_candidates(dsn: str) -> List[str]:
    """Prova path locale e, se possibile, connessione via servizio Firebird."""
    raw = (dsn or "").strip()
    if not raw:
        return []
    out: List[str] = []
    # già host:path / host/port:path
    if not raw.lower().endswith(".gdb") and not raw.lower().endswith(".fdb"):
        return [raw]

    p = Path(raw)
    local = str(p.resolve()) if p.exists() else raw
    out.append(local)
    # Varianti TCP (spesso funzionano meglio a cassa aperta)
    for host in ("localhost", "127.0.0.1"):
        out.append(f"{host}:{local}")
        out.append(f"{host}/3050:{local}")
    # dedupe preservando ordine
    seen = set()
    uniq = []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def connect_gdb(
    dsn: str,
    *,
    user: str = "SYSDBA",
    password: str = "masterkey",
    fbclient: Optional[str] = None,
    charset: str = "WIN1252",
    timeout_sec: Optional[float] = None,
):
    import threading

    fdb, lib = _load_fdb(fbclient)
    if timeout_sec is None:
        try:
            timeout_sec = float(_env("EASYRETAIL_GDB_CONNECT_TIMEOUT", "20") or "20")
        except ValueError:
            timeout_sec = 20.0

    errors: List[str] = []
    for path in _dsn_candidates(dsn):
        kwargs: Dict[str, Any] = {
            "dsn": path,
            "user": user,
            "password": password,
            "charset": charset,
        }
        if lib:
            kwargs["fb_library_name"] = lib

        holder: Dict[str, Any] = {}

        def _do_connect(kw=kwargs, h=holder):
            try:
                h["con"] = fdb.connect(**kw)
            except Exception as exc:  # pylint: disable=broad-except
                h["err"] = exc

        logger.info("Tentativo connessione GDB: %s", path)
        print(f"PROBE/SYNC: provo DSN {path} (timeout {int(timeout_sec or 0)}s)…", flush=True)
        t = threading.Thread(target=_do_connect, daemon=True)
        t.start()
        t.join(timeout=timeout_sec if timeout_sec and timeout_sec > 0 else None)
        if t.is_alive():
            errors.append(f"{path}: timeout {int(timeout_sec)}s")
            print(f"  → timeout, provo altro DSN…", flush=True)
            continue
        if "con" in holder:
            print(f"  → connesso con {path}", flush=True)
            return holder["con"]
        err = holder.get("err")
        errors.append(f"{path}: {err}")
        print(f"  → fallito: {err}", flush=True)

    detail = " | ".join(errors[:6]) if errors else "nessun DSN"
    raise RuntimeError(
        f"Connessione Firebird fallita. Dettagli: {detail}. "
        "Chiudi EasyRetail un momento e riprova, oppure in .env usa "
        "EASYRETAIL_GDB_PATH=localhost:C:\\EasyRetail\\DBase\\DBRETAIL.GDB"
    )


def _list_user_tables(cur) -> List[str]:
    cur.execute(
        "SELECT TRIM(RDB$RELATION_NAME) FROM RDB$RELATIONS "
        "WHERE RDB$SYSTEM_FLAG = 0 AND RDB$VIEW_BLR IS NULL "
        "ORDER BY 1"
    )
    return [str(r[0]).strip() for r in cur.fetchall() if r and r[0]]


def _table_columns(cur, table: str) -> List[str]:
    cur.execute(
        "SELECT TRIM(RF.RDB$FIELD_NAME) FROM RDB$RELATION_FIELDS RF "
        "WHERE TRIM(RF.RDB$RELATION_NAME) = ? "
        "ORDER BY RF.RDB$FIELD_POSITION",
        (table.upper(),),
    )
    return [str(r[0]).strip().upper() for r in cur.fetchall() if r and r[0]]


def _pick_col(cols: Sequence[str], candidates: Sequence[str], *, exact_only: bool = False) -> Optional[str]:
    upper = {c.upper(): c for c in cols}
    for name in candidates:
        if name.upper() in upper:
            return upper[name.upper()]
    if exact_only:
        return None
    # partial contains
    for name in candidates:
        needle = name.upper()
        for c in cols:
            if needle in c.upper() and len(needle) >= 5:
                return c
    return None


def discover_receipt_mapping(cur) -> Dict[str, Any]:
    tables = _list_user_tables(cur)
    table = None
    for cand in _TABLE_CANDIDATES:
        for t in tables:
            if t.upper() == cand:
                table = t
                break
        if table:
            break
    if not table:
        # fuzzy
        for t in tables:
            if "SCONTR" in t.upper():
                table = t
                break
    if not table:
        raise RuntimeError(
            "Tabella scontrini non trovata nel GDB. "
            f"Tabelle presenti (anteprima): {', '.join(tables[:40])}"
        )
    cols = _table_columns(cur, table)
    mapping = {
        "table": table,
        "columns": cols,
        "id": _pick_col(cols, _ID_COL_CANDIDATES),
        "ts": _pick_col(cols, _TS_COL_CANDIDATES),
        "date": _pick_col(cols, _DATE_COL_CANDIDATES),
        "time": _pick_col(cols, _TIME_COL_CANDIDATES),
        "amount": _pick_col(cols, _AMOUNT_COL_CANDIDATES),
        "store": _pick_col(cols, _STORE_COL_CANDIDATES),
        "void": _pick_col(cols, _VOID_COL_CANDIDATES),
        "cash_amount": _pick_col(cols, _RECEIPT_CASH_AMOUNT_COLS),
        "card_amount": _pick_col(cols, _RECEIPT_CARD_AMOUNT_COLS),
        "payment_type": _pick_col(cols, _RECEIPT_PAYMENT_TYPE_COLS),
        "doc_type": "TIPODOCUMENTO" if "TIPODOCUMENTO" in {c.upper() for c in cols} else None,
    }
    if not mapping["ts"] and not mapping["date"]:
        raise RuntimeError(
            f"Nella tabella {table} non trovo colonne data/ora. Colonne: {', '.join(cols[:40])}"
        )
    if not mapping["id"]:
        mapping["id"] = mapping["ts"] or mapping["date"]
    return mapping


def discover_payment_lines_mapping(cur, receipt_mapping: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Cerca tabella righe pagamento collegata agli scontrini."""
    tables = _list_user_tables(cur)
    receipt_id_col = receipt_mapping.get("id")
    if not receipt_id_col:
        return None

    def _link_has_values(t: str, link: str) -> bool:
        """Scarta tabelle dove il link è sempre NULL (es. chiusure MOVIMENTIPAGAMENTI)."""
        try:
            cur.execute(f"SELECT FIRST 1 {link} FROM {t} WHERE {link} IS NOT NULL")
            return cur.fetchone() is not None
        except Exception:
            return False

    def _try_table(t: str, *, require_type: bool = False) -> Optional[Dict[str, Any]]:
        cols = _table_columns(cur, t)
        link = _pick_col(cols, _PAYMENT_LINK_COL_CANDIDATES)
        if not link:
            return None
        # Preferisci link verso lo stesso id della testata se presente
        receipt_id = (receipt_mapping.get("id") or "").upper()
        if receipt_id and receipt_id in {c.upper() for c in cols}:
            link = next(c for c in cols if c.upper() == receipt_id)
        amount_col = _pick_col(cols, _PAYMENT_AMOUNT_COL_CANDIDATES)
        if not amount_col:
            return None
        type_col = _pick_col(cols, _PAYMENT_TYPE_COL_CANDIDATES)
        desc_col = _pick_col(cols, _PAYMENT_DESC_COL_CANDIDATES, exact_only=True)
        if desc_col and type_col and desc_col.upper() == type_col.upper():
            desc_col = None
        if desc_col and desc_col.upper() == "NOTE" and type_col:
            desc_col = None
        if require_type and not type_col and not desc_col:
            return None
        if not _link_has_values(t, link):
            return None
        return {
            "table": t,
            "columns": cols,
            "link_col": link,
            "type_col": type_col,
            "amount_col": amount_col,
            "desc_col": desc_col,
        }

    # 1) match esatto nome tabella (importante: "PAGAMENTI" non deve prendere MOVIMENTIPAGAMENTI)
    for cand in _PAYMENT_TABLE_CANDIDATES:
        for t in tables:
            if t.upper() != cand:
                continue
            require_type = "PAGAM" not in t.upper()
            found = _try_table(t, require_type=require_type)
            if found:
                return found

    # 2) match parziale
    for cand in _PAYMENT_TABLE_CANDIDATES:
        for t in tables:
            if t.upper() == cand or cand not in t.upper():
                continue
            require_type = "PAGAM" not in t.upper()
            found = _try_table(t, require_type=require_type)
            if found:
                return found

    for t in tables:
        if "PAGAM" not in t.upper():
            continue
        # Evita scadenze / anagrafiche / chiusure aggregate
        if "SCADENZ" in t.upper() or "FORMA" in t.upper() or "TIPO" in t.upper():
            continue
        if t.upper() == "MOVIMENTIPAGAMENTI":
            continue
        found = _try_table(t, require_type=False)
        if found:
            return found
    return None


def _pick_lookup_desc(cols: Sequence[str], id_col: str) -> Optional[str]:
    """Descrizione lookup: non riusare la colonna ID."""
    id_u = id_col.upper()
    upper = {c.upper(): c for c in cols if c.upper() != id_u}
    for name in _PAYMENT_LOOKUP_DESC_COLS:
        if name.upper() in upper:
            return upper[name.upper()]
    for name in _PAYMENT_LOOKUP_DESC_COLS:
        needle = name.upper()
        if len(needle) < 5:
            continue
        for cu, orig in upper.items():
            if needle in cu:
                return orig
    return None


def discover_payment_form_lookup(
    cur,
    preferred_id_col: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Tabella lookup forme di pagamento (codice → descrizione)."""
    tables = _list_user_tables(cur)
    preferred = (preferred_id_col or "").upper() or None

    def _score_and_build(t: str) -> Optional[Tuple[int, Dict[str, Any]]]:
        cols = _table_columns(cur, t)
        id_candidates = list(_PAYMENT_LOOKUP_ID_COLS)
        if preferred and preferred in {c.upper() for c in cols}:
            id_candidates = [preferred] + [c for c in id_candidates if c.upper() != preferred]
        id_col = _pick_col(cols, id_candidates)
        if not id_col:
            return None
        desc_col = _pick_lookup_desc(cols, id_col)
        if not desc_col:
            return None
        score = 0
        tu = t.upper()
        if "FORMA" in tu:
            score += 30
        if "TIPO" in tu:
            score += 10
        if preferred and id_col.upper() == preferred:
            score += 50
        if preferred and "FORMA" in preferred and "FORMA" in tu:
            score += 20
        if preferred and "TIPO" in preferred and "TIPO" in tu:
            score += 20
        return score, {"table": t, "id_col": id_col, "desc_col": desc_col, "columns": cols}

    best: Optional[Tuple[int, Dict[str, Any]]] = None
    for cand in _PAYMENT_LOOKUP_TABLE_CANDIDATES:
        for t in tables:
            if t.upper() != cand and cand not in t.upper():
                continue
            scored = _score_and_build(t)
            if scored and (best is None or scored[0] > best[0]):
                best = scored
    if best:
        return best[1]

    for t in tables:
        tu = t.upper()
        if "PAGAM" not in tu:
            continue
        if "FORMA" not in tu and "TIPO" not in tu and "MODAL" not in tu:
            continue
        scored = _score_and_build(t)
        if scored and (best is None or scored[0] > best[0]):
            best = scored
    return best[1] if best else None


def discover_payment_schema(cur, receipt_mapping: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Diagnostica completa flusso pagamenti nel GDB."""
    if receipt_mapping is None:
        receipt_mapping = discover_receipt_mapping(cur)
    lines = discover_payment_lines_mapping(cur, receipt_mapping)
    preferred_lookup_id = None
    if lines and lines.get("type_col"):
        preferred_lookup_id = lines.get("type_col")
    elif receipt_mapping.get("payment_type"):
        preferred_lookup_id = receipt_mapping.get("payment_type")
    lookup = discover_payment_form_lookup(cur, preferred_id_col=preferred_lookup_id)
    has_receipt_cols = any(
        receipt_mapping.get(k) for k in ("cash_amount", "card_amount", "payment_type")
    )
    mode = "unknown"
    # Righe pagamento con importo = fonte migliore (anche split mixed)
    if any(receipt_mapping.get(k) for k in ("cash_amount", "card_amount")):
        mode = "receipt_columns"
    elif lines and lines.get("amount_col") and (lines.get("type_col") or lines.get("desc_col")):
        mode = "payment_lines"
    elif receipt_mapping.get("payment_type") and lookup:
        mode = "receipt_payment_ref"
    elif receipt_mapping.get("payment_type"):
        mode = "receipt_payment_code"
    return {
        "receipt_table": receipt_mapping.get("table"),
        "receipt_payment_columns": {
            k: receipt_mapping.get(k)
            for k in ("cash_amount", "card_amount", "payment_type")
            if receipt_mapping.get(k)
        },
        "payment_lines": lines,
        "payment_lookup": lookup,
        "mode": mode,
        "has_receipt_payment_signal": has_receipt_cols,
    }


def _payment_tables_hint(tables: Sequence[str]) -> List[str]:
    out = []
    for t in tables:
        tu = t.upper()
        if "PAGAM" in tu or ("FORMA" in tu and "PAG" in tu) or tu.startswith("TIPIPAG") or tu.startswith("TIPOPAG"):
            out.append(t)
        if len(out) >= 40:
            break
    return out


def _norm_id_key(value: Any) -> str:
    """Chiave stabile per match scontrino ↔ riga pagamento."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return str(value).strip()
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return str(int(value))
        return str(value).strip()
    s = str(value).strip()
    if not s:
        return ""
    try:
        d = Decimal(s)
        if d == d.to_integral_value():
            return str(int(d))
    except Exception:
        pass
    return s


def _coerce_sql_id(value: Any) -> Any:
    """Parametro IN tipizzato (Firebird preferisce int su colonne numeriche)."""
    key = _norm_id_key(value)
    if not key:
        return value
    try:
        return int(key)
    except ValueError:
        return key


def _norm_payment_code(value: Any) -> str:
    return _norm_id_key(value)


def _resolve_payment_label(type_value: Any, lookup: Dict[str, str], desc_value: Any = None) -> str:
    if desc_value is not None:
        ds = str(desc_value).strip()
        # ignora flag numerici (es. colonna PAGAMENTO)
        if ds and not ds.isdigit():
            return ds[:120]
    if type_value is None:
        return ""
    key = _norm_payment_code(type_value)
    if key in lookup:
        return lookup[key][:120]
    return key[:120]


def _load_payment_lookup(cur, lookup_mapping: Dict[str, Any]) -> Dict[str, str]:
    table = lookup_mapping["table"]
    id_col = lookup_mapping["id_col"]
    desc_col = lookup_mapping["desc_col"]
    cur.execute(f"SELECT {id_col}, {desc_col} FROM {table}")
    out: Dict[str, str] = {}
    for row in cur.fetchall():
        if row[0] is None:
            continue
        key = _norm_id_key(row[0])
        desc = "" if row[1] is None else str(row[1]).strip()
        if key and desc:
            out[key] = desc
    return out


def _accumulate_payment_bucket(
    buckets: Dict[str, Dict[str, Any]],
    receipt_key: str,
    *,
    cash: Decimal,
    card: Decimal,
    label: str,
    raw: str,
) -> None:
    slot = buckets.setdefault(
        receipt_key,
        {"cash": Decimal("0"), "card": Decimal("0"), "labels": [], "raw_parts": []},
    )
    slot["cash"] += cash
    slot["card"] += card
    if label and label not in slot["labels"]:
        slot["labels"].append(label)
    if raw and raw not in slot["raw_parts"]:
        slot["raw_parts"].append(raw)


def _fetch_payment_lines_breakdown(
    cur,
    *,
    payment_mapping: Dict[str, Any],
    lookup: Dict[str, str],
    receipt_ids: Iterable[Any],
    since: Optional[datetime],
    receipt_table: Optional[str] = None,
    receipt_id_col: Optional[str] = None,
    receipt_ts_col: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    from .pos_payment_classifier import classify_payment, label_suggests_card, label_suggests_cash

    table = payment_mapping["table"]
    link_col = payment_mapping["link_col"]
    amount_col = payment_mapping["amount_col"]
    type_col = payment_mapping.get("type_col")
    desc_col = payment_mapping.get("desc_col")
    pcols = {c.upper() for c in (payment_mapping.get("columns") or [])}
    date_col = next((c for c in ("DATAPAGAMENTO", "DATAREGISTRAZIONE") if c in pcols), None)

    select_cols = [link_col, amount_col]
    if type_col and type_col not in select_cols:
        select_cols.append(type_col)
    if desc_col and desc_col not in select_cols:
        select_cols.append(desc_col)

    _IN_BATCH = 1000
    ids = [_coerce_sql_id(x) for x in receipt_ids if x is not None]
    id_set = {_norm_id_key(x) for x in ids}
    col_index = {name.upper(): i for i, name in enumerate(select_cols)}

    def get(row, col: Optional[str]):
        if not col:
            return None
        return row[col_index[col.upper()]]

    buckets: Dict[str, Dict[str, Any]] = {}

    def _consume_rows(rows) -> None:
        for row in rows:
            receipt_key = _norm_id_key(get(row, link_col))
            if not receipt_key:
                continue
            if id_set and receipt_key not in id_set:
                continue
            amount = _as_amount(get(row, amount_col)) or Decimal("0")
            type_val = get(row, type_col) if type_col else None
            desc_val = get(row, desc_col) if desc_col else None
            label = _resolve_payment_label(type_val, lookup, desc_val)
            raw = _norm_payment_code(type_val) or (str(desc_val).strip() if desc_val is not None else "")
            cash = Decimal("0")
            card = Decimal("0")
            if label_suggests_cash(label) and not label_suggests_card(label):
                cash = amount
            elif label_suggests_card(label):
                card = amount
            else:
                code = _norm_payment_code(type_val)
                if code == "1" and amount > 0:
                    cash = amount
                elif code in ("2", "3") and amount > 0:
                    card = amount
            _accumulate_payment_bucket(
                buckets,
                receipt_key,
                cash=cash,
                card=card,
                label=label,
                raw=raw,
            )

    def _since_param():
        if since is None:
            return None
        return since.replace(tzinfo=None) if getattr(since, "tzinfo", None) else since

    fetched_any = False
    # 1) JOIN testata per data (piu affidabile dell'IN)
    if since is not None and receipt_table and receipt_id_col and receipt_ts_col:
        try:
            join_sql = (
                f"SELECT FIRST 50000 P.{', P.'.join(select_cols)} "
                f"FROM {table} P "
                f"INNER JOIN {receipt_table} M ON M.{receipt_id_col} = P.{link_col} "
                f"WHERE M.{receipt_ts_col} >= ?"
            )
            cur.execute(join_sql, [_since_param()])
            rows = cur.fetchall()
            if rows:
                fetched_any = True
                _consume_rows(rows)
        except Exception as exc:
            logger.warning("payment JOIN fetch failed: %s", exc)

    # 2) fallback IN a batch
    if not fetched_any and ids:
        for i in range(0, len(ids), _IN_BATCH):
            chunk = ids[i : i + _IN_BATCH]
            placeholders = ", ".join("?" for _ in chunk)
            sql = (
                f"SELECT FIRST 50000 {', '.join(select_cols)} FROM {table} "
                f"WHERE {link_col} IN ({placeholders})"
            )
            cur.execute(sql, chunk)
            _consume_rows(cur.fetchall())

    # 3) fallback per data sulla tabella pagamenti
    if not buckets and since is not None and date_col:
        try:
            sql = (
                f"SELECT FIRST 50000 {', '.join(select_cols)} FROM {table} "
                f"WHERE {date_col} >= ?"
            )
            cur.execute(sql, [_since_param()])
            _consume_rows(cur.fetchall())
        except Exception as exc:
            logger.warning("payment date fetch failed: %s", exc)

    out: Dict[str, Dict[str, Any]] = {}
    for key, slot in buckets.items():
        ptype, cash_amt, card_amt = classify_payment(
            cash_amount=slot["cash"] or None,
            card_amount=slot["card"] or None,
            label=", ".join(slot["labels"]) or None,
        )
        out[key] = {
            "payment_type": ptype,
            "cash_amount_eur": cash_amt,
            "card_amount_eur": card_amt,
            "payment_label": ", ".join(slot["labels"])[:120] or None,
            "payment_raw": "; ".join(slot["raw_parts"])[:255] or None,
        }
    return out


def _payment_fields_from_receipt_row(
    row_vals: Dict[str, Any],
    mapping: Dict[str, Any],
    lookup: Dict[str, str],
) -> Dict[str, Any]:
    from .pos_payment_classifier import classify_payment

    cash_raw = _as_amount(row_vals.get("cash_amount"))
    card_raw = _as_amount(row_vals.get("card_amount"))
    type_val = row_vals.get("payment_type")
    label = _resolve_payment_label(type_val, lookup)
    amount = _as_amount(row_vals.get("amount"))
    ptype, cash, card = classify_payment(
        cash_amount=cash_raw,
        card_amount=card_raw,
        total_amount=amount,
        label=label,
        type_code=type_val,
    )
    return {
        "payment_type": ptype,
        "cash_amount_eur": cash if cash is not None else cash_raw,
        "card_amount_eur": card if card is not None else card_raw,
        "payment_label": label or None,
        "payment_raw": None if type_val is None else str(type_val)[:255],
    }


def _as_datetime(value: Any, time_value: Any = None) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ROME)
        return dt
    if isinstance(value, date) and not isinstance(value, datetime):
        tpart = time(0, 0)
        if isinstance(time_value, time):
            tpart = time_value
        elif isinstance(time_value, datetime):
            tpart = time_value.time()
        elif isinstance(time_value, str) and time_value.strip():
            m = re.match(r"^(\d{1,2})[:\.](\d{2})(?:[:\.](\d{2}))?", time_value.strip())
            if m:
                tpart = time(int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))
        dt = datetime.combine(value, tpart)
        return dt.replace(tzinfo=ROME)
    if isinstance(value, str):
        s = value.strip().replace("T", " ")
        for fmt in (
            "%Y-%m-%d %H:%M:%S",
            "%d.%m.%Y %H:%M:%S",
            "%d/%m/%Y %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%d/%m/%Y %H:%M",
            "%Y-%m-%d",
            "%d/%m/%Y",
        ):
            try:
                dt = datetime.strptime(s, fmt)
                return dt.replace(tzinfo=ROME)
            except ValueError:
                continue
    return None


def _as_amount(value: Any) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except Exception:
        return None


def _as_void(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, (int, float, Decimal)):
        return int(value) != 0
    s = str(value).strip().lower()
    return s in ("1", "-1", "true", "t", "si", "sì", "yes", "y", "annullato")


def fetch_receipts_from_gdb(
    *,
    dsn: str,
    user: str = "SYSDBA",
    password: str = "masterkey",
    fbclient: Optional[str] = None,
    charset: str = "WIN1252",
    lookback_hours: int = 48,
    since: Optional[datetime] = None,
    default_model_id: Optional[str] = None,
    limit: int = 20000,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Legge scontrini recenti dal GDB. Ritorna (rows, meta)."""
    from .pos_store_catalog import SOURCE_EASYRETAIL, resolve_store

    con = connect_gdb(dsn, user=user, password=password, fbclient=fbclient, charset=charset)
    try:
        cur = con.cursor()
        mapping = discover_receipt_mapping(cur)
        payment_schema = discover_payment_schema(cur, mapping)
        payment_lines_map = payment_schema.get("payment_lines")
        lookup_map = payment_schema.get("payment_lookup")
        lookup: Dict[str, str] = _load_payment_lookup(cur, lookup_map) if lookup_map else {}

        table = mapping["table"]
        select_cols = []
        aliases = []
        for key in (
            "id",
            "ts",
            "date",
            "time",
            "amount",
            "store",
            "void",
            "cash_amount",
            "card_amount",
            "payment_type",
            "doc_type",
        ):
            col = mapping.get(key)
            if col and col not in aliases:
                select_cols.append(col)
                aliases.append(col)
        sql = f"SELECT {', '.join(select_cols)} FROM {table}"

        where = []
        params: List[Any] = []
        cutoff = since
        if cutoff is None:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, lookback_hours))
        if cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=timezone.utc)

        # Filter: prefer timestamp column
        if mapping["ts"]:
            where.append(f"{mapping['ts']} >= ?")
            params.append(cutoff.replace(tzinfo=None))
        elif mapping["date"]:
            where.append(f"{mapping['date']} >= ?")
            params.append(cutoff.date())

        # Solo vendita fiscale (VEN). BIL = gestionale stesso scontrino → doppio conteggio vs chiusura cassa.
        if mapping.get("doc_type"):
            where.append(f"{mapping['doc_type']} = 'VEN'")

        if where:
            sql += " WHERE " + " AND ".join(where)
        order_col = mapping["ts"] or mapping["date"] or mapping["id"]
        if order_col:
            sql += f" ORDER BY {order_col}"
        # Firebird FIRST
        sql = f"SELECT FIRST {int(limit)} " + sql[len("SELECT ") :]

        cur.execute(sql, params)
        col_index = {name.upper(): i for i, name in enumerate(select_cols)}

        def get(row, key: str):
            col = mapping.get(key)
            if not col:
                return None
            return row[col_index[col.upper()]]

        raw_rows: List[Tuple[Any, Dict[str, Any]]] = []
        for row in cur.fetchall():
            when = _as_datetime(get(row, "ts"))
            if when is None:
                when = _as_datetime(get(row, "date"), get(row, "time"))
            if when is None:
                continue
            if when.tzinfo is None:
                when = when.replace(tzinfo=ROME)
            when_utc = when.astimezone(timezone.utc)

            amount = _as_amount(get(row, "amount"))
            # ignora movimenti a zero
            if amount is None or amount <= 0:
                continue

            store_raw = get(row, "store")
            store_key, model_id, model_label = resolve_store(
                "" if store_raw is None else str(store_raw),
                default_model_id,
            )
            external = get(row, "id")
            if external is None or str(external).strip() == "":
                external = f"{store_key}:{when_utc.isoformat()}"
                external_key = str(external).strip()
            else:
                external_key = _norm_id_key(external)
            is_void = _as_void(get(row, "void"))
            row_vals = {
                "amount": amount,
                "cash_amount": get(row, "cash_amount"),
                "card_amount": get(row, "card_amount"),
                "payment_type": get(row, "payment_type"),
            }
            raw_rows.append(
                (
                    external_key,
                    {
                        "source": SOURCE_EASYRETAIL,
                        "store_key": store_key,
                        "model_id": model_id,
                        "model_label": model_label,
                        "external_id": external_key[:120],
                        "receipt_at": when_utc,
                        "amount_eur": amount,
                        "is_void": 1 if is_void else 0,
                        "raw_store": None if store_raw is None else str(store_raw)[:120],
                        "_row_vals": row_vals,
                    },
                )
            )

        payment_breakdown: Dict[str, Dict[str, Any]] = {}
        if payment_lines_map:
            receipt_ids = [r[0] for r in raw_rows if r[0] is not None]
            payment_breakdown = _fetch_payment_lines_breakdown(
                cur,
                payment_mapping=payment_lines_map,
                lookup=lookup,
                receipt_ids=receipt_ids,
                since=cutoff,
                receipt_table=table,
                receipt_id_col=mapping.get("id"),
                receipt_ts_col=mapping.get("ts") or mapping.get("date"),
            )

        has_receipt_payment_cols = any(
            mapping.get(k) for k in ("cash_amount", "card_amount", "payment_type")
        )
        rows: List[Dict[str, Any]] = []
        matched_lines = 0
        for external, base in raw_rows:
            pay: Dict[str, Any] = {}
            ext_key = str(external).strip()
            row_vals = base.pop("_row_vals", {})
            # Prima prova dalla testata (NUMEROFORMAPAGAMENTO), poi overlay righe se migliori
            if has_receipt_payment_cols:
                pay = _payment_fields_from_receipt_row(row_vals, mapping, lookup)
            if ext_key in payment_breakdown:
                line_pay = payment_breakdown[ext_key]
                matched_lines += 1
                if (line_pay.get("payment_type") or "unknown") != "unknown":
                    pay = line_pay
                elif (pay.get("payment_type") or "unknown") == "unknown":
                    pay = line_pay
            rows.append({**base, **pay})
        meta = {
            "table": table,
            "mapping": {
                k: mapping.get(k)
                for k in (
                    "id",
                    "ts",
                    "date",
                    "time",
                    "amount",
                    "store",
                    "void",
                    "cash_amount",
                    "card_amount",
                    "payment_type",
                )
            },
            "payment_schema": {
                "mode": payment_schema.get("mode"),
                "receipt_payment_columns": payment_schema.get("receipt_payment_columns"),
                "payment_lines_table": (payment_lines_map or {}).get("table"),
                "payment_lookup_table": (lookup_map or {}).get("table"),
                "payment_lines_matched": matched_lines,
                "payment_lines_keys": len(payment_breakdown),
            },
            "fetched": len(rows),
            "with_payment_type": sum(1 for r in rows if r.get("payment_type") and r["payment_type"] != "unknown"),
            "dsn": dsn,
            "fbclient": resolve_fbclient(fbclient),
        }
        return rows, meta
    finally:
        try:
            con.close()
        except Exception:
            pass


def _payment_debug_sample(cur, receipt_mapping: Dict[str, Any], payment_schema: Dict[str, Any]) -> Dict[str, Any]:
    """Diagnostica leggera: niente COUNT(*) / ORDER BY data (lenti su GDB grandi)."""
    out: Dict[str, Any] = {}
    rtable = receipt_mapping.get("table")
    rid = receipt_mapping.get("id")
    rpay = receipt_mapping.get("payment_type")
    ramt = receipt_mapping.get("amount")
    rts = receipt_mapping.get("ts")
    if not (rtable and rid):
        return {"error": "receipt mapping incompleto"}

    print("PROBE: debug receipt sample…", flush=True)
    cols = [c for c in (rid, rts, rpay, ramt, "TIPODOCUMENTO") if c]
    # TIPODOCUMENTO solo se esiste
    all_cols = {x.upper() for x in (receipt_mapping.get("columns") or [])}
    cols = [c for c in cols if c.upper() in all_cols or c == rid]
    try:
        # ORDER BY id (di solito indicizzato) evita full-scan su DATAMOVIMENTO
        cur.execute(
            f"SELECT FIRST 15 {', '.join(cols)} FROM {rtable} ORDER BY {rid} DESC"
        )
        names = [c.upper() for c in cols]
        samples = []
        receipt_ids = []
        for row in cur.fetchall():
            samples.append({names[i]: row[i] for i in range(len(names))})
            if row[0] is not None:
                receipt_ids.append(row[0])
        out["receipt_sample"] = samples
    except Exception as e:
        out["receipt_sample_error"] = str(e)
        receipt_ids = []

    lines = payment_schema.get("payment_lines") or {}
    ptable = lines.get("table")
    if ptable:
        print(f"PROBE: debug payment lines ({ptable})…", flush=True)
        link = lines.get("link_col") or "NUMEROMOVIMENTO"
        amount_col = lines.get("amount_col") or "IMPORTOPAGAMENTO"
        type_col = lines.get("type_col") or "NUMEROFORMAPAGAMENTO"
        p_id = "NUMEROMOVIMENTOPAGAMENTO"
        pcols = {c.upper() for c in (lines.get("columns") or [])}
        order_p = p_id if p_id in pcols else link
        sel = [link, amount_col, type_col]
        try:
            cur.execute(
                f"SELECT FIRST 15 {', '.join(sel)} FROM {ptable} ORDER BY {order_p} DESC"
            )
            pnames = [c.upper() for c in sel]
            out["payment_lines_sample"] = [
                {pnames[i]: row[i] for i in range(len(pnames))} for row in cur.fetchall()
            ]
            out["payment_lines_nonempty"] = bool(out["payment_lines_sample"])
        except Exception as e:
            out["payment_lines_sample_error"] = str(e)

        if receipt_ids and link:
            print("PROBE: debug overlap…", flush=True)
            try:
                ids = [_coerce_sql_id(x) for x in receipt_ids]
                placeholders = ", ".join("?" for _ in ids)
                cur.execute(
                    f"SELECT {link}, COUNT(*) FROM {ptable} "
                    f"WHERE {link} IN ({placeholders}) GROUP BY {link}",
                    ids,
                )
                found = {_norm_id_key(r[0]): int(r[1]) for r in cur.fetchall()}
                out["overlap_on_sample"] = {
                    "receipt_ids": [_norm_id_key(x) for x in receipt_ids],
                    "with_payments": found,
                    "matched": len(found),
                    "sample_size": len(receipt_ids),
                }
            except Exception as e:
                out["overlap_error"] = str(e)

        # JOIN solo sugli id campione (niente ORDER BY su tutta la testata)
        if receipt_ids and link and rpay:
            print("PROBE: debug join sample…", flush=True)
            try:
                ids = [_coerce_sql_id(x) for x in receipt_ids[:15]]
                placeholders = ", ".join("?" for _ in ids)
                cur.execute(
                    f"SELECT M.{rid}, M.{rpay}, P.{amount_col}, P.{type_col} "
                    f"FROM {rtable} M "
                    f"LEFT JOIN {ptable} P ON P.{link} = M.{rid} "
                    f"WHERE M.{rid} IN ({placeholders})",
                    ids,
                )
                out["join_sample"] = [
                    {
                        "movimento": r[0],
                        "forma_testata": r[1],
                        "importo_riga": r[2],
                        "forma_riga": r[3],
                    }
                    for r in cur.fetchall()
                ]
            except Exception as e:
                out["join_sample_error"] = str(e)

    # distribuzione forme sugli ultimi id (veloce)
    if rpay and rid:
        print("PROBE: debug payment type dist…", flush=True)
        try:
            cur.execute(
                f"SELECT FIRST 200 {rpay} FROM {rtable} ORDER BY {rid} DESC"
            )
            dist: Dict[str, int] = {}
            nulls = 0
            for (v,) in cur.fetchall():
                if v is None:
                    nulls += 1
                    continue
                k = _norm_id_key(v)
                dist[k] = dist.get(k, 0) + 1
            out["receipt_payment_type_dist"] = {"nulls": nulls, "codes": dist}
        except Exception as e:
            out["receipt_payment_type_dist_error"] = str(e)

    # anteprima PAGAMENTI: overlap con gli stessi id scontrino
    try:
        print("PROBE: debug tabella PAGAMENTI…", flush=True)
        pcols = _table_columns(cur, "PAGAMENTI")
        out["pagamenti_columns"] = pcols[:40]
        cur.execute(
            "SELECT FIRST 10 NUMEROMOVIMENTO, NUMEROFORMAPAGAMENTO, IMPORTO "
            "FROM PAGAMENTI WHERE NUMEROMOVIMENTO IS NOT NULL "
            "ORDER BY NUMEROPAGAMENTO DESC"
        )
        out["pagamenti_sample"] = [
            {"NUMEROMOVIMENTO": r[0], "NUMEROFORMAPAGAMENTO": r[1], "IMPORTO": r[2]}
            for r in cur.fetchall()
        ]
        if receipt_ids:
            ids = [_coerce_sql_id(x) for x in receipt_ids]
            placeholders = ", ".join("?" for _ in ids)
            cur.execute(
                f"SELECT NUMEROMOVIMENTO, NUMEROFORMAPAGAMENTO, IMPORTO FROM PAGAMENTI "
                f"WHERE NUMEROMOVIMENTO IN ({placeholders})",
                ids,
            )
            out["pagamenti_overlap"] = [
                {"NUMEROMOVIMENTO": r[0], "NUMEROFORMAPAGAMENTO": r[1], "IMPORTO": r[2]}
                for r in cur.fetchall()
            ]
            out["pagamenti_overlap_matched"] = len({_norm_id_key(r["NUMEROMOVIMENTO"]) for r in out["pagamenti_overlap"]})
    except Exception as e:
        out["pagamenti_error"] = str(e)

    return out


def probe_gdb(dsn: str, **kwargs) -> Dict[str, Any]:
    """Diagnostica connessione + mapping colonne e flusso pagamenti."""
    print("PROBE: connect…", flush=True)
    con = connect_gdb(dsn, **{k: v for k, v in kwargs.items() if k in ("user", "password", "fbclient", "charset")})
    try:
        cur = con.cursor()
        print("PROBE: elenco tabelle…", flush=True)
        tables = _list_user_tables(cur)
        print(f"PROBE: tabelle={len(tables)}, mapping scontrini…", flush=True)
        mapping = discover_receipt_mapping(cur)
        print(
            f"PROBE: mapping ok table={mapping.get('table')} pay={mapping.get('payment_type')}",
            flush=True,
        )
        print("PROBE: schema pagamenti…", flush=True)
        payment_schema = discover_payment_schema(cur, mapping)
        print(f"PROBE: mode={payment_schema.get('mode')}", flush=True)
        lookup_sample: Dict[str, Any] = {}
        lookup_map = payment_schema.get("payment_lookup")
        if lookup_map:
            print(f"PROBE: lookup {lookup_map.get('table')}…", flush=True)
            try:
                full = _load_payment_lookup(cur, lookup_map)
                for i, (k, v) in enumerate(full.items()):
                    if i >= 20:
                        break
                    lookup_sample[k] = v
            except Exception as e:
                lookup_sample = {"_error": str(e)}
        payment_debug: Dict[str, Any] = {}
        try:
            payment_debug = _payment_debug_sample(cur, mapping, payment_schema)
        except Exception as e:
            payment_debug = {"_error": str(e)}
            print(f"PROBE: payment_debug errore: {e}", flush=True)
        print("PROBE: fine query, preparo JSON…", flush=True)
        return {
            "ok": True,
            "agent_schema_version": "2026-09-04-pagamenti-table-5",
            "tables_count": len(tables),
            "tables_sample": tables[:60],
            "payment_related_tables": _payment_tables_hint(tables),
            "mapping": {
                k: mapping.get(k)
                for k in (
                    "table",
                    "id",
                    "ts",
                    "date",
                    "time",
                    "amount",
                    "store",
                    "void",
                    "cash_amount",
                    "card_amount",
                    "payment_type",
                )
            },
            "mapping_columns_count": len(mapping.get("columns") or []),
            "payment_schema": payment_schema,
            "payment_lookup_sample": lookup_sample,
            "payment_debug": payment_debug,
        }
    finally:
        try:
            con.close()
        except Exception:
            pass
