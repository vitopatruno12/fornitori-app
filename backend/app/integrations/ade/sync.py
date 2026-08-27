"""Orchestrazione sync AdE multi-profilo → Atlas."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .playwright_client import AdePlaywrightClient, AdeSyncResult
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
    if item.sha256 in already:
      pushes.append(
        {
          "filename": item.filename,
          "sha256": item.sha256,
          "profile_id": profile.id,
          "sede": profile.sede,
          "skipped": True,
          "reason": "local_state",
        }
      )
      duplicates += 1
      continue

    push = push_xml_bytes(
      item.data,
      filename=item.filename,
      sede=profile.sede,
      profile_id=profile.id,
    )
    entry: Dict[str, Any] = {
      "filename": item.filename,
      "sha256": item.sha256,
      "source": item.source,
      "profile_id": profile.id,
      "sede": profile.sede,
      "sdi_section": profile.sdi_section,
      **push,
    }
    pushes.append(entry)

    if push.get("ok"):
      mark_sent(state, profile.id, item.sha256)
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
