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
    }
    if not mapping["ts"] and not mapping["date"]:
        raise RuntimeError(
            f"Nella tabella {table} non trovo colonne data/ora. Colonne: {', '.join(cols[:40])}"
        )
    if not mapping["id"]:
        mapping["id"] = mapping["ts"] or mapping["date"]
    return mapping


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
    from .pos_receipts_service import SOURCE_EASYRETAIL, resolve_store

    con = connect_gdb(dsn, user=user, password=password, fbclient=fbclient, charset=charset)
    try:
        cur = con.cursor()
        mapping = discover_receipt_mapping(cur)
        table = mapping["table"]
        select_cols = []
        aliases = []
        for key in ("id", "ts", "date", "time", "amount", "store", "void"):
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

        rows: List[Dict[str, Any]] = []
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
            rows.append(
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
                }
            )
        meta = {
            "table": table,
            "mapping": {k: mapping.get(k) for k in ("id", "ts", "date", "time", "amount", "store", "void")},
            "fetched": len(rows),
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
    """Diagnostica connessione + mapping colonne (senza import)."""
    con = connect_gdb(dsn, **{k: v for k, v in kwargs.items() if k in ("user", "password", "fbclient", "charset")})
    try:
        cur = con.cursor()
        tables = _list_user_tables(cur)
        mapping = discover_receipt_mapping(cur)
        return {
            "ok": True,
            "tables_count": len(tables),
            "tables_sample": tables[:60],
            "mapping": mapping,
        }
    finally:
        con.close()
