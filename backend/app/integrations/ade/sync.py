"""Orchestrazione sync AdE multi-profilo → Atlas."""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .playwright_client import AdePlaywrightClient, AdeSyncResult, _looks_like_fatturapa
from .profiles import AdeProfile, load_profiles
from .push_to_atlas import assign_sdi_section, push_xml_bytes
from .state import (
  default_state_path,
  load_state,
  mark_sent,
  profile_hashes,
  save_state,
  touch_run,
)


def _env(name: str, default: str = "") -> str:
  return (os.getenv(name, default) or default).strip()


def _openssl_bin() -> Optional[str]:
  found = shutil.which("openssl")
  if found:
    return found
  for candidate in (
    r"C:\Program Files\Git\usr\bin\openssl.exe",
    r"C:\Program Files\OpenSSL-Win64\bin\openssl.exe",
  ):
    if Path(candidate).is_file():
      return candidate
  return None


def _unwrap_p7m_bytes(data: bytes, filename: str) -> Tuple[Optional[bytes], str, Optional[str]]:
  """
  Converte .p7m CMS in XML plain via OpenSSL.
  Ritorna (payload, nome, skip_reason). Se skip_reason è set, non fare push.
  """
  name = filename or "fattura.xml"
  low = name.lower()
  if "metadato" in low or low.endswith("_metadato.xml") or "metadato.xml" in low:
    return None, name, "metadato"

  # XML plain già leggibile (non .p7m)
  head = data[:200].lstrip()
  is_xml_plain = head.startswith(b"<?xml") or head.startswith(b"<FatturaElettronica") or head.startswith(b"<p:FatturaElettronica") or head.startswith(b"<ns2:FatturaElettronica") or head.startswith(b"<ns3:FatturaElettronica")
  if is_xml_plain and _looks_like_fatturapa(data) and not low.endswith(".p7m"):
    return data, name, None

  # .p7m / CMS: sempre OpenSSL (non usare _looks_like sul binario)
  if not (low.endswith(".p7m") or data[:1] == b"\x30"):
    if _looks_like_fatturapa(data):
      return data, name, None
    return None, name, "not_fatturapa"

  openssl = _openssl_bin()
  if not openssl:
    return None, name, "openssl_missing"

  try:
    with tempfile.TemporaryDirectory() as td:
      tin = Path(td) / "in.p7m"
      tout = Path(td) / "out.xml"
      tin.write_bytes(data)
      proc = subprocess.run(
        [
          openssl,
          "smime",
          "-verify",
          "-noverify",
          "-inform",
          "DER",
          "-in",
          str(tin),
          "-out",
          str(tout),
        ],
        capture_output=True,
        timeout=60,
        check=False,
      )
      if proc.returncode == 0 and tout.is_file():
        out = tout.read_bytes()
        if _looks_like_fatturapa(out):
          out_name = name
          if out_name.lower().endswith(".p7m"):
            out_name = out_name[:-4]
          if not out_name.lower().endswith(".xml"):
            out_name += ".xml"
          while out_name.lower().endswith(".xml.xml"):
            out_name = out_name[:-4]
          # Atlas produzione: gate storico cerca "<FatturaElettronica" (senza prefisso ns)
          import re

          text = out.decode("utf-8", errors="replace")
          text = re.sub(
            r"<(/?)(?:[\w.-]+):FatturaElettronica\b",
            r"<\1FatturaElettronica",
            text,
            count=4,
          )
          out = text.encode("utf-8")
          return out, out_name, None
  except Exception as e:
    return None, name, f"openssl_error:{e}"
  return None, name, "unwrap_failed"


def sync_profile(profile: AdeProfile, state: Dict[str, Any]) -> Tuple[AdeSyncResult, List[Dict[str, Any]]]:
  already = profile_hashes(state, profile.id)
  client = AdePlaywrightClient(profile)
  result = client.run_download()
  pushes: List[Dict[str, Any]] = []

  if not result.downloaded:
    return result, pushes

  imported = 0
  duplicates = 0
  errors = 0
  for item in result.downloaded:
    payload, push_name, skip_reason = _unwrap_p7m_bytes(item.data, item.filename)
    if skip_reason or not payload:
      pushes.append(
        {
          "filename": item.filename,
          "sha256": item.sha256,
          "profile_id": profile.id,
          "sede": profile.sede,
          "skipped": True,
          "reason": skip_reason or "unwrap_empty",
        }
      )
      continue
    digest = hashlib.sha256(payload).hexdigest()
    if digest in already or item.sha256 in already:
      pushes.append(
        {
          "filename": push_name,
          "sha256": digest,
          "profile_id": profile.id,
          "sede": profile.sede,
          "skipped": True,
          "reason": "local_state",
        }
      )
      duplicates += 1
      continue

    push = push_xml_bytes(
      payload,
      filename=push_name,
      sede=profile.sede,
      profile_id=profile.id,
    )
    entry: Dict[str, Any] = {
      "filename": push_name,
      "sha256": digest,
      "source": item.source,
      "profile_id": profile.id,
      "sede": profile.sede,
      "sdi_section": profile.sdi_section,
      **push,
    }
    pushes.append(entry)

    if push.get("ok"):
      mark_sent(state, profile.id, digest)
      mark_sent(state, profile.id, item.sha256)
      already.add(digest)
      already.add(item.sha256)
      res = push.get("result") or {}
      inv_id = res.get("id")
      if inv_id and profile.sdi_section:
        assign = assign_sdi_section(int(inv_id), profile.sdi_section)
        entry["assign"] = assign
      elif inv_id and profile.auto_section:
        entry["assign"] = {"ok": True, "skipped": True, "reason": "auto_section_from_xml"}
      if res.get("duplicate"):
        duplicates += 1
      else:
        imported += 1
    else:
      errors += 1

  summary = (
    f"{result.message} | push imported={imported} duplicate={duplicates} errors={errors}"
  )
  result.message = summary
  result.ok = errors == 0 and (imported + duplicates > 0 or result.ok)
  return result, pushes


def sync_all_profiles() -> Tuple[List[AdeSyncResult], List[Dict[str, Any]]]:
  """
  Esegue sync su tutti i profili abilitati.
  Ritorna (risultati per profilo, lista push aggregata).
  """
  state_path = Path(_env("ADE_STATE_PATH") or str(default_state_path()))
  state = load_state(state_path)
  profiles = load_profiles()

  if not profiles:
    empty = AdeSyncResult(
      ok=False,
      message=(
        "Nessun profilo AdE abilitato. Copia profiles.example.json, "
        "imposta ADE_PROFILES_PATH e enabled=true, oppure ADE_PROFILE_1_ID/SEDE/..."
      ),
    )
    touch_run(state, ok=False, message=empty.message)
    save_state(state_path, state)
    return [empty], []

  results: List[AdeSyncResult] = []
  all_pushes: List[Dict[str, Any]] = []

  for profile in profiles:
    result, pushes = sync_profile(profile, state)
    results.append(result)
    all_pushes.extend(pushes)

  ok_any = any(r.ok for r in results)
  login_any = any(r.login_ok for r in results)
  msgs = " || ".join(r.message for r in results)
  touch_run(
    state,
    ok=ok_any and login_any,
    message=msgs[:2000],
  )
  save_state(state_path, state)
  return results, all_pushes
