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
_DATE_COL_CANDIDATES = ("DATA", "GIORNO", "DATAGIORNATA", "GIORNATA")
_TIME_COL_CANDIDATES = ("ORA", "ORAMOVIMENTO", "ORASCONTRINO", "ORARIO")
_AMOUNT_COL_CANDIDATES = (
    "TOTALEIVATO",
    "TOTALEVENDITA",
    "TOTALENETTO",
    "TOTALESCONTRINO",
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
    "IDPOS",
)
_VOID_COL_CANDIDATES = (
    "ANNULLATO",
    "FLAGANNULLATO",
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
    "TIPOPAGAMENTO",
    "CODICEPAGAMENTO",
    "FORMAPAGAMENTO",
    "MODALITAPAGAMENTO",
    "REF_FORMAPAGAMENTO",
    "PAGAMENTO",
)
_PAYMENT_TABLE_CANDIDATES = (
    "PAGAMENTISCONTRINI",
    "SCONTRINIPAGAMENTI",
    "PAGAMENTI",
    "DETTAGLIOPAGAMENTI",
    "RIGHEPAGAMENTI",
    "PAGAMENTIPOS",
    "SCONTRINIPAG",
)
_PAYMENT_LINK_COL_CANDIDATES = (
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
)
_PAYMENT_DESC_COL_CANDIDATES = ("DESCRIZIONE", "NOTE", "PAGAMENTO", "NOMEPAGAMENTO")
_PAYMENT_LOOKUP_TABLE_CANDIDATES = (
    "FORMEPAGAMENTO",
    "TIPOPAGAMENTO",
    "TIPOPAGAMENTOPOS",
    "TIPIDIPAGAMENTO",
    "MODALITAPAGAMENTO",
)
_PAYMENT_LOOKUP_ID_COLS = ("CODICE", "ID", "NUMERO", "NUMEROINTERNO", "CODPAGAMENTO")
_PAYMENT_LOOKUP_DESC_COLS = ("DESCRIZIONE", "NOME", "PAGAMENTO", "LABEL")


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


def connect_gdb(
    dsn: str,
    *,
    user: str = "SYSDBA",
    password: str = "masterkey",
    fbclient: Optional[str] = None,
    charset: str = "WIN1252",
):
    fdb, lib = _load_fdb(fbclient)
    path = dsn
    # File locale: normalizza path Windows
    if ":" not in dsn.split("\\")[0] or dsn.lower().endswith(".gdb"):
        # already path-like; if no host prefix, use as dsn file
        p = Path(dsn)
        if p.exists():
            path = str(p.resolve())
    kwargs: Dict[str, Any] = {
        "dsn": path,
        "user": user,
        "password": password,
        "charset": charset,
    }
    if lib:
        kwargs["fb_library_name"] = lib
    try:
        return fdb.connect(**kwargs)
    except Exception as e:
        raise RuntimeError(f"Connessione Firebird fallita ({path}): {e}") from e


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


def _pick_col(cols: Sequence[str], candidates: Sequence[str]) -> Optional[str]:
    upper = {c.upper(): c for c in cols}
    for name in candidates:
        if name.upper() in upper:
            return upper[name.upper()]
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

    for cand in _PAYMENT_TABLE_CANDIDATES:
        for t in tables:
            if t.upper() == cand or cand in t.upper():
                cols = _table_columns(cur, t)
                link = _pick_col(cols, _PAYMENT_LINK_COL_CANDIDATES)
                if not link:
                    continue
                amount_col = _pick_col(cols, _PAYMENT_AMOUNT_COL_CANDIDATES)
                if not amount_col:
                    continue
                return {
                    "table": t,
                    "columns": cols,
                    "link_col": link,
                    "type_col": _pick_col(cols, _PAYMENT_TYPE_COL_CANDIDATES),
                    "amount_col": amount_col,
                    "desc_col": _pick_col(cols, _PAYMENT_DESC_COL_CANDIDATES),
                }

    # fuzzy: tabella con PAGAM e collegamento a scontrino
    for t in tables:
        if "PAGAM" not in t.upper() or "SCONTR" not in t.upper():
            if "PAGAM" not in t.upper():
                continue
        cols = _table_columns(cur, t)
        link = _pick_col(cols, _PAYMENT_LINK_COL_CANDIDATES)
        amount_col = _pick_col(cols, _PAYMENT_AMOUNT_COL_CANDIDATES)
        if link and amount_col:
            return {
                "table": t,
                "columns": cols,
                "link_col": link,
                "type_col": _pick_col(cols, _PAYMENT_TYPE_COL_CANDIDATES),
                "amount_col": amount_col,
                "desc_col": _pick_col(cols, _PAYMENT_DESC_COL_CANDIDATES),
            }
    return None


def discover_payment_form_lookup(cur) -> Optional[Dict[str, Any]]:
    """Tabella lookup forme di pagamento (codice → descrizione)."""
    tables = _list_user_tables(cur)
    for cand in _PAYMENT_LOOKUP_TABLE_CANDIDATES:
        for t in tables:
            if t.upper() == cand or cand in t.upper():
                cols = _table_columns(cur, t)
                id_col = _pick_col(cols, _PAYMENT_LOOKUP_ID_COLS)
                desc_col = _pick_col(cols, _PAYMENT_LOOKUP_DESC_COLS)
                if id_col and desc_col:
                    return {"table": t, "id_col": id_col, "desc_col": desc_col}
    return None


def discover_payment_schema(cur, receipt_mapping: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Diagnostica completa flusso pagamenti nel GDB."""
    if receipt_mapping is None:
        receipt_mapping = discover_receipt_mapping(cur)
    lines = discover_payment_lines_mapping(cur, receipt_mapping)
    lookup = discover_payment_form_lookup(cur)
    return {
        "receipt_table": receipt_mapping.get("table"),
        "receipt_payment_columns": {
            k: receipt_mapping.get(k)
            for k in ("cash_amount", "card_amount", "payment_type")
            if receipt_mapping.get(k)
        },
        "payment_lines": lines,
        "payment_lookup": lookup,
        "mode": (
            "receipt_columns"
            if any(receipt_mapping.get(k) for k in ("cash_amount", "card_amount", "payment_type"))
            else "payment_lines"
            if lines
            else "unknown"
        ),
    }


def _load_payment_lookup(cur, lookup_mapping: Dict[str, Any]) -> Dict[str, str]:
    table = lookup_mapping["table"]
    id_col = lookup_mapping["id_col"]
    desc_col = lookup_mapping["desc_col"]
    cur.execute(f"SELECT {id_col}, {desc_col} FROM {table}")
    out: Dict[str, str] = {}
    for row in cur.fetchall():
        if row[0] is None:
            continue
        key = str(row[0]).strip()
        desc = "" if row[1] is None else str(row[1]).strip()
        if key and desc:
            out[key] = desc
    return out


def _resolve_payment_label(type_value: Any, lookup: Dict[str, str], desc_value: Any = None) -> str:
    if desc_value is not None and str(desc_value).strip():
        return str(desc_value).strip()[:120]
    if type_value is None:
        return ""
    key = str(type_value).strip()
    if key in lookup:
        return lookup[key][:120]
    return key[:120]


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
) -> Dict[str, Dict[str, Any]]:
    from .pos_payment_classifier import classify_payment, label_suggests_card, label_suggests_cash

    table = payment_mapping["table"]
    link_col = payment_mapping["link_col"]
    amount_col = payment_mapping["amount_col"]
    type_col = payment_mapping.get("type_col")
    desc_col = payment_mapping.get("desc_col")

    select_cols = [link_col, amount_col]
    if type_col:
        select_cols.append(type_col)
    if desc_col and desc_col not in select_cols:
        select_cols.append(desc_col)

    sql = f"SELECT {', '.join(select_cols)} FROM {table}"
    params: List[Any] = []
    where: List[str] = []
    ids = [x for x in receipt_ids if x is not None]
    if ids:
        placeholders = ", ".join("?" for _ in ids[:5000])
        where.append(f"{link_col} IN ({placeholders})")
        params.extend(ids[:5000])
    if since is not None and not ids:
        # fallback: nessun filtro id, limita per performance
        pass
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql = f"SELECT FIRST 50000 {sql[len('SELECT ') :]}"

    cur.execute(sql, params)
    col_index = {name.upper(): i for i, name in enumerate(select_cols)}

    def get(row, col: Optional[str]):
        if not col:
            return None
        return row[col_index[col.upper()]]

    buckets: Dict[str, Dict[str, Any]] = {}
    for row in cur.fetchall():
        receipt_key = str(get(row, link_col)).strip()
        if not receipt_key:
            continue
        amount = _as_amount(get(row, amount_col)) or Decimal("0")
        type_val = get(row, type_col) if type_col else None
        desc_val = get(row, desc_col) if desc_col else None
        label = _resolve_payment_label(type_val, lookup, desc_val)
        raw = str(type_val or desc_val or "").strip()
        cash = Decimal("0")
        card = Decimal("0")
        if label_suggests_cash(label) and not label_suggests_card(label):
            cash = amount
        elif label_suggests_card(label):
            card = amount
        else:
            # codice numerico ECR: 0=contanti tipico, 2=carta in molti ECR
            code = str(type_val or "").strip()
            if code in ("0", "1") and amount > 0:
                cash = amount
            elif code in ("2", "3", "4", "5") and amount > 0:
                card = amount
        _accumulate_payment_bucket(
            buckets,
            receipt_key,
            cash=cash,
            card=card,
            label=label,
            raw=raw,
        )

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
        ):
            col = mapping.get(key)
            if col and col not in aliases:
                select_cols.append(col)
                aliases.append(col)
        sql = f'SELECT {", ".join(select_cols)} FROM "{table}"'
        # Firebird unquoted identifiers are uppercased; prefer unquoted
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

            store_raw = get(row, "store")
            store_key, model_id, model_label = resolve_store(
                "" if store_raw is None else str(store_raw),
                default_model_id,
            )
            external = get(row, "id")
            if external is None or str(external).strip() == "":
                external = f"{store_key}:{when_utc.isoformat()}"
            amount = _as_amount(get(row, "amount"))
            is_void = _as_void(get(row, "void"))
            row_vals = {
                "amount": amount,
                "cash_amount": get(row, "cash_amount"),
                "card_amount": get(row, "card_amount"),
                "payment_type": get(row, "payment_type"),
            }
            raw_rows.append(
                (
                    external,
                    {
                        "source": SOURCE_EASYRETAIL,
                        "store_key": store_key,
                        "model_id": model_id,
                        "model_label": model_label,
                        "external_id": str(external).strip()[:120],
                        "receipt_at": when_utc,
                        "amount_eur": amount,
                        "is_void": 1 if is_void else 0,
                        "raw_store": None if store_raw is None else str(store_raw)[:120],
                        "_row_vals": row_vals,
                    },
                )
            )

        payment_breakdown: Dict[str, Dict[str, Any]] = {}
        has_receipt_payment_cols = any(mapping.get(k) for k in ("cash_amount", "card_amount", "payment_type"))
        if payment_lines_map and not has_receipt_payment_cols:
            receipt_ids = [str(r[0]).strip() for r in raw_rows if r[0] is not None]
            payment_breakdown = _fetch_payment_lines_breakdown(
                cur,
                payment_mapping=payment_lines_map,
                lookup=lookup,
                receipt_ids=receipt_ids,
                since=cutoff,
            )

        rows: List[Dict[str, Any]] = []
        for external, base in raw_rows:
            pay: Dict[str, Any] = {}
            ext_key = str(external).strip()
            row_vals = base.pop("_row_vals", {})
            if has_receipt_payment_cols:
                pay = _payment_fields_from_receipt_row(row_vals, mapping, lookup)
            elif ext_key in payment_breakdown:
                pay = payment_breakdown[ext_key]
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


def probe_gdb(dsn: str, **kwargs) -> Dict[str, Any]:
    """Diagnostica connessione + mapping colonne e flusso pagamenti."""
    con = connect_gdb(dsn, **{k: v for k, v in kwargs.items() if k in ("user", "password", "fbclient", "charset")})
    try:
        cur = con.cursor()
        tables = _list_user_tables(cur)
        mapping = discover_receipt_mapping(cur)
        payment_schema = discover_payment_schema(cur, mapping)
        return {
            "ok": True,
            "tables_count": len(tables),
            "tables_sample": tables[:60],
            "mapping": mapping,
            "payment_schema": payment_schema,
        }
    finally:
        con.close()
