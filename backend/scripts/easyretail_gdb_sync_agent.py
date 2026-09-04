#!/usr/bin/env python3
"""Agent sync EasyRetail GDB → ATLAS (da eseguire sul PC cassa).

Legge scontrini dal database Firebird EasyRetail e invia ad ATLAS anche
la ripartizione contanti vs carta/POS quando disponibile nel GDB.

Esempio (Task Scheduler ogni 3 minuti):
  python easyretail_gdb_sync_agent.py

Probe flusso pagamenti (solo diagnostica, senza invio):
  python easyretail_gdb_sync_agent.py --probe

Variabili (o file .env accanto allo script):
  ATLAS_API_BASE=https://www.atlass.it/api
  EASYRETAIL_SYNC_TOKEN=...          # stesso token sul server
  EASYRETAIL_GDB_PATH=C:\\EasyRetail\\DBase\\DBRETAIL.GDB
  EASYRETAIL_FBCLIENT=C:\\EasyRetail\\DBase\\fbclient.dll
  EASYRETAIL_MODEL_ID=model-2        # opzionale: Mani in Pasta
  EASYRETAIL_GDB_LOOKBACK_HOURS=48
  EASYRETAIL_GDB_USER=SYSDBA
  EASYRETAIL_GDB_PASSWORD=masterkey
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Root = cartella che contiene `app/`
# - repo: backend/scripts/agent.py → backend/
# - PC cassa flat: C:\AtlasSync\agent.py → C:\AtlasSync\ (con app\ accanto)
_HERE = Path(__file__).resolve().parent
if (_HERE / "app").is_dir():
    ROOT = _HERE
elif (_HERE.parent / "app").is_dir():
    ROOT = _HERE.parent
else:
    ROOT = _HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_dotenv():
    for p in (Path(__file__).with_name(".env"), ROOT / ".env", ROOT / "app" / ".." / ".env"):
        p = p.resolve()
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


def _serialize_receipt(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if k == "receipt_at" and isinstance(v, datetime):
            out[k] = v.astimezone(timezone.utc).isoformat()
        elif k in ("amount_eur", "cash_amount_eur", "card_amount_eur") and v is not None:
            out[k] = float(v)
        else:
            out[k] = v
    return out


def run_probe() -> int:
    print("PROBE: avvio…", flush=True)
    print(f"PROBE: script={Path(__file__).resolve()}", flush=True)
    print(f"PROBE: root={ROOT}", flush=True)

    try:
        from app.services.easyretail_gdb_service import gdb_config_from_env, probe_gdb
    except Exception as e:
        print(f"ERRORE import: {e}", file=sys.stderr, flush=True)
        return 2

    cfg = gdb_config_from_env()
    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or os.getenv("EASYRETAIL_GDB_DSN") or cfg.get("dsn") or "").strip()
    if not dsn:
        print("ERRORE: imposta EASYRETAIL_GDB_PATH", file=sys.stderr, flush=True)
        return 2

    print(f"PROBE: connessione a {dsn} …", flush=True)
    print("(puo richiedere 10-60s se EasyRetail tiene aperto il GDB)", flush=True)
    try:
        result = probe_gdb(
            dsn,
            user=os.getenv("EASYRETAIL_GDB_USER", "SYSDBA") or "SYSDBA",
            password=os.getenv("EASYRETAIL_GDB_PASSWORD", "masterkey") or "masterkey",
            fbclient=(os.getenv("EASYRETAIL_FBCLIENT") or None),
            charset=os.getenv("EASYRETAIL_GDB_CHARSET", "WIN1252") or "WIN1252",
        )
    except Exception as e:
        print(f"ERRORE probe: {e}", file=sys.stderr, flush=True)
        return 1

    print("PROBE: ok, stampo risultato…", flush=True)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str), flush=True)
    print(f"\nagent_schema_version: {result.get('agent_schema_version')}", flush=True)
    schema = (result.get("payment_schema") or {})
    mode = schema.get("mode") or "unknown"
    print(f"\nFlusso pagamenti rilevato: {mode}", flush=True)
    if mode == "receipt_columns":
        print("Colonne importo pagamento su scontrini:", schema.get("receipt_payment_columns"), flush=True)
    elif mode == "payment_lines":
        lines = schema.get("payment_lines") or {}
        lookup = schema.get("payment_lookup") or {}
        print(
            f"Tabella righe pagamento: {lines.get('table')} "
            f"(link={lines.get('link_col')}, tipo={lines.get('type_col')}, importo={lines.get('amount_col')})",
            flush=True,
        )
        if lookup:
            print(
                f"Lookup forme: {lookup.get('table')} "
                f"({lookup.get('id_col')}→{lookup.get('desc_col')})",
                flush=True,
            )
        sample = result.get("payment_lookup_sample") or {}
        if sample and "_error" not in sample:
            print("Esempi forme pagamento:", sample, flush=True)
    elif mode == "receipt_payment_ref":
        lookup = schema.get("payment_lookup") or {}
        cols = schema.get("receipt_payment_columns") or {}
        print(
            f"Codice pagamento sullo scontrino ({cols.get('payment_type')}) "
            f"→ lookup {lookup.get('table')} ({lookup.get('id_col')}→{lookup.get('desc_col')})",
            flush=True,
        )
        sample = result.get("payment_lookup_sample") or {}
        if sample and "_error" not in sample:
            print("Esempi forme pagamento:", sample, flush=True)
    elif mode == "receipt_payment_code":
        cols = schema.get("receipt_payment_columns") or {}
        print(
            f"Trovato codice pagamento ({cols.get('payment_type')}) ma nessuna tabella lookup. "
            f"Tabelle correlate: {result.get('payment_related_tables') or []}",
            flush=True,
        )
    else:
        print("ATTENZIONE: pagamenti non mappati automaticamente — verifica tabelle nel GDB.", flush=True)
        related = result.get("payment_related_tables") or []
        if related:
            print("Tabelle correlate trovate:", related, flush=True)

    debug = result.get("payment_debug") or {}
    if debug:
        print("\n--- payment_debug ---", flush=True)
        overlap = debug.get("overlap_on_sample")
        if overlap:
            print(
                f"Overlap sample: matched={overlap.get('matched')}/{overlap.get('sample_size')} "
                f"with_payments={overlap.get('with_payments')}",
                flush=True,
            )
        dist = debug.get("receipt_payment_type_dist")
        if dist:
            print(f"Distribuzione NUMEROFORMAPAGAMENTO (ultimi 500): {dist}", flush=True)
        if debug.get("payment_lines_count") is not None:
            print(f"Righe in tabella pagamenti: {debug.get('payment_lines_count')}", flush=True)
        if debug.get("join_sample"):
            print("Join sample (movimento / forma_testata / importo_riga / forma_riga):", flush=True)
            for row in debug["join_sample"][:8]:
                print(" ", row, flush=True)
        if debug.get("pagamenti_overlap") is not None:
            print(
                f"PAGAMENTI overlap: matched_movimenti={debug.get('pagamenti_overlap_matched')} "
                f"righe={len(debug.get('pagamenti_overlap') or [])}",
                flush=True,
            )
            for row in (debug.get("pagamenti_overlap") or [])[:8]:
                print(" ", row, flush=True)
        if debug.get("pagamenti_sample"):
            print("PAGAMENTI sample recenti:", flush=True)
            for row in (debug.get("pagamenti_sample") or [])[:5]:
                print(" ", row, flush=True)
        for err_key in (
            "overlap_error",
            "join_sample_error",
            "payment_lines_sample_error",
            "receipt_sample_error",
            "_error",
        ):
            if debug.get(err_key):
                print(f"{err_key}: {debug.get(err_key)}", flush=True)
    else:
        print("\n(nessun payment_debug — ricopia anche app\\services\\easyretail_gdb_service.py)", flush=True)
    return 0


def _post_ingest(api: str, token: str, model_id: str | None, receipts: list[dict]) -> str:
    payload = {
        "model_id": model_id,
        "receipts": receipts,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{api}/pos-receipts/ingest",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Atlas-Sync-Token": token,
            "User-Agent": "atlas-easyretail-gdb-agent/1.2",
        },
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return resp.read().decode("utf-8", errors="replace")


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync EasyRetail GDB → ATLAS")
    parser.add_argument("--probe", action="store_true", help="Solo diagnostica flusso pagamenti (no invio API)")
    args = parser.parse_args()

    print(f"AtlasSync agent start argv={sys.argv}", flush=True)
    _load_dotenv()
    if args.probe:
        return run_probe()

    api = (os.getenv("ATLAS_API_BASE") or "https://www.atlass.it/api").rstrip("/")
    token = (os.getenv("EASYRETAIL_SYNC_TOKEN") or os.getenv("POS_RECEIPTS_SYNC_TOKEN") or "").strip()
    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or os.getenv("EASYRETAIL_GDB_DSN") or "").strip()
    if not dsn:
        print("ERRORE: imposta EASYRETAIL_GDB_PATH (es. C:\\EasyRetail\\DBase\\DBRETAIL.GDB)", file=sys.stderr)
        return 2
    if not token:
        print("ERRORE: imposta EASYRETAIL_SYNC_TOKEN (stesso valore sul server ATLAS)", file=sys.stderr)
        return 2

    from app.services.easyretail_gdb_service import fetch_receipts_from_gdb

    lookback = int(os.getenv("EASYRETAIL_GDB_LOOKBACK_HOURS", "48") or "48")
    model_id = (os.getenv("EASYRETAIL_MODEL_ID") or "").strip() or None
    # nginx default ~1MB: batch piccoli evitano 413
    batch_size = max(50, int(os.getenv("EASYRETAIL_INGEST_BATCH_SIZE", "200") or "200"))
    print(f"SYNC: lettura GDB lookback={lookback}h model={model_id} …", flush=True)
    rows, meta = fetch_receipts_from_gdb(
        dsn=dsn,
        user=os.getenv("EASYRETAIL_GDB_USER", "SYSDBA") or "SYSDBA",
        password=os.getenv("EASYRETAIL_GDB_PASSWORD", "masterkey") or "masterkey",
        fbclient=(os.getenv("EASYRETAIL_FBCLIENT") or None),
        charset=os.getenv("EASYRETAIL_GDB_CHARSET", "WIN1252") or "WIN1252",
        lookback_hours=lookback,
        default_model_id=model_id,
    )

    serialized = [_serialize_receipt(r) for r in rows]
    if not serialized:
        print(
            f"OK fetched=0 with_payment=0 "
            f"mode={(meta.get('payment_schema') or {}).get('mode')} "
            f"table={meta.get('table')} (nessuno scontrino)",
            flush=True,
        )
        return 0

    total_batches = (len(serialized) + batch_size - 1) // batch_size
    try:
        for i in range(0, len(serialized), batch_size):
            chunk = serialized[i : i + batch_size]
            batch_no = i // batch_size + 1
            body = _post_ingest(api, token, model_id, chunk)
            print(f"batch {batch_no}/{total_batches} sent={len(chunk)} → {body}", flush=True)
        print(
            f"OK fetched={meta.get('fetched')} "
            f"with_payment={meta.get('with_payment_type', 0)} "
            f"mode={(meta.get('payment_schema') or {}).get('mode')} "
            f"matched={(meta.get('payment_schema') or {}).get('payment_lines_matched')} "
            f"table={meta.get('table')} batches={total_batches}",
            flush=True,
        )
        return 0
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {err}", file=sys.stderr, flush=True)
        return 1
    except Exception as e:
        print(f"ERRORE: {e}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
