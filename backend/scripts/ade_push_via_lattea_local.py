#!/usr/bin/env python3
"""Unwrap .p7m Via Lattea (downloads + drop) e push su Atlas /sdi/receive."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("ATLAS_API_BASE", "https://www.atlass.it/api")


def main() -> int:
  from app.integrations.ade.sync import _unwrap_p7m_bytes
  from app.integrations.ade.push_to_atlas import assign_sdi_section, push_xml_bytes
  from app.integrations.ade.state import (
    default_state_path,
    load_state,
    mark_sent,
    profile_hashes,
    save_state,
  )

  dirs = [
    ROOT / "uploads" / "ade_debug" / "via_lattea" / "downloads",
    ROOT / "uploads" / "ade" / "via_lattea",
  ]
  files: list[Path] = []
  seen = set()
  for d in dirs:
    if not d.is_dir():
      continue
    for p in sorted(d.rglob("*")):
      if not p.is_file():
        continue
      low = p.name.lower()
      if "metadato" in low:
        continue
      if not (low.endswith(".p7m") or low.endswith(".xml")):
        continue
      key = p.name
      # preferisci file senza prefix hash se duplicato
      if key in seen:
        continue
      seen.add(key)
      files.append(p)

  print(f"files candidati={len(files)}")
  state_path = Path(os.getenv("ADE_STATE_PATH") or str(default_state_path()))
  state = load_state(state_path)
  already = profile_hashes(state, "via_lattea")

  ok = dup = err = skip = 0
  for i, path in enumerate(files, 1):
    raw = path.read_bytes()
    payload, name, reason = _unwrap_p7m_bytes(raw, path.name)
    if reason or not payload:
      skip += 1
      continue
    import hashlib

    digest = hashlib.sha256(payload).hexdigest()
    if digest in already:
      dup += 1
      continue
    push = push_xml_bytes(
      payload,
      filename=name,
      sede="via_lattea",
      profile_id="via_lattea",
    )
    if push.get("ok"):
      mark_sent(state, "via_lattea", digest)
      already.add(digest)
      res = push.get("result") or {}
      inv_id = res.get("id")
      if inv_id:
        assign_sdi_section(int(inv_id), "via_lattea")
      if res.get("duplicate"):
        dup += 1
      else:
        ok += 1
      if i % 20 == 0 or i == len(files):
        print(f"  progress {i}/{len(files)} ok={ok} dup={dup} err={err} skip={skip}")
        save_state(state_path, state)
    else:
      err += 1
      print(f"  ERR {name} {push.get('status')} {push.get('result')}")

  save_state(state_path, state)
  print(f"DONE ok={ok} duplicate={dup} errors={err} skipped={skip}")
  return 0 if err == 0 else 1


if __name__ == "__main__":
  raise SystemExit(main())
