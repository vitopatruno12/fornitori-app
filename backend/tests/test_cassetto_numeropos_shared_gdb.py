"""Abba/Zanardelli condividono il GDB: il cassetto deve restare sulla propria cassa."""

from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_agent():
  agent_path = Path(__file__).resolve().parents[1] / "scripts" / "easyretail_gdb_sync_agent.py"
  spec = importlib.util.spec_from_file_location("easyretail_gdb_sync_agent_test", agent_path)
  assert spec and spec.loader
  mod = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(mod)
  return mod


def test_shared_gdb_ignora_numeropos_all(monkeypatch):
  monkeypatch.setenv("EASYRETAIL_NUMEROPOS", "all")
  mod = _load_agent()
  assert mod._resolve_numeropos("model-2", ()) == "1"
  assert mod._resolve_numeropos("model-4", ()) == "2"


def test_shared_gdb_defaults():
  mod = _load_agent()
  assert mod._resolve_numeropos("model-2", ()) == "1"
  assert mod._resolve_numeropos("model-4", ()) == "2"
  assert mod._resolve_numeropos("model-3", ()) is None


def test_shared_gdb_require_numeropos():
  mod = _load_agent()
  assert mod._require_shared_gdb_numeropos("model-2", None, what="CASSETTO") is False
  assert mod._require_shared_gdb_numeropos("model-2", "1", what="CASSETTO") is True
  assert mod._require_shared_gdb_numeropos("model-3", None, what="CASSETTO") is True


def test_pad_cassetto_days_azzera_giorni_mancanti():
  from datetime import date

  mod = _load_agent()
  padded = mod._pad_cassetto_days(
    [{"day": "2026-10-02", "amount_uscita": 10.0, "amount_net": -10.0, "count": 1, "causali": ["MIWA"], "operazioni": []}],
    date_from=date(2026, 10, 1),
    date_to=date(2026, 10, 3),
  )
  assert [r["day"] for r in padded] == ["2026-10-01", "2026-10-02", "2026-10-03"]
  assert padded[0]["amount_uscita"] == 0.0
  assert padded[0]["operazioni"] == []
  assert padded[1]["amount_uscita"] == 10.0
  assert padded[2]["amount_uscita"] == 0.0
