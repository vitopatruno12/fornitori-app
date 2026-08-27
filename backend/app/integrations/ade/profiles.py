"""Profili società / sedi per sync AdE."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


# Mappa sede Atlas → sezione inbox SDI attuale (abba / zanardelli / non_classificata)
SEDE_TO_SDI_SECTION = {
  "via_abba": "abba",
  "mediazione": "abba",
  "via_zanardelli": "zanardelli",
  "via_lattea": "non_classificata",
  "risacca": "non_classificata",
}


@dataclass
class AdeProfile:
  id: str
  label: str
  sede: str  # slug Atlas: via_abba | via_lattea | risacca | via_zanardelli | mediazione
  codice_fiscale: str = ""
  partita_iva: str = ""
  # cns | storage | drop
  auth_mode: str = "cns"
  drop_dir: str = ""
  storage_state_path: str = ""
  enabled: bool = True
  # Se True: non forza assign; Atlas classifica da indirizzo XML (abba/zanardelli)
  auto_section: bool = False

  @property
  def sdi_section(self) -> Optional[str]:
    if self.auto_section:
      return None
    sede = (self.sede or "").strip().lower()
    if sede in ("auto", "mediazione"):
      return None
    return SEDE_TO_SDI_SECTION.get(sede, "non_classificata")


def _env(name: str, default: str = "") -> str:
  return (os.getenv(name, default) or default).strip()


def default_profiles_path() -> Path:
  raw = _env("ADE_PROFILES_PATH")
  if raw:
    return Path(raw)
  return Path(__file__).resolve().parent / "profiles.example.json"


def load_profiles(path: Optional[Path] = None) -> List[AdeProfile]:
  """
  Carica profili da JSON (ADE_PROFILES_PATH) oppure da env ADE_PROFILE_<n>_*.

  JSON esempio:
  [
    {
      "id": "via_abba",
      "label": "Mediazione Via Abba",
      "sede": "via_abba",
      "codice_fiscale": "",
      "partita_iva": "",
      "auth_mode": "cns",
      "drop_dir": "C:/AtlasSync/ade/via_abba",
      "enabled": true
    }
  ]
  """
  p = path or default_profiles_path()
  profiles: List[AdeProfile] = []

  if p.is_file():
    try:
      raw = json.loads(p.read_text(encoding="utf-8"))
      if isinstance(raw, list):
        for item in raw:
          if not isinstance(item, dict):
            continue
          pid = str(item.get("id") or "").strip()
          sede = str(item.get("sede") or pid).strip()
          if not pid:
            continue
          profiles.append(
            AdeProfile(
              id=pid,
              label=str(item.get("label") or pid).strip(),
              sede=sede,
              codice_fiscale=str(item.get("codice_fiscale") or "").strip(),
              partita_iva=str(item.get("partita_iva") or item.get("piva") or "").strip(),
              auth_mode=str(item.get("auth_mode") or "cns").strip().lower() or "cns",
              drop_dir=str(item.get("drop_dir") or "").strip(),
              storage_state_path=str(item.get("storage_state_path") or "").strip(),
              enabled=bool(item.get("enabled", True)),
              auto_section=bool(
                item.get("auto_section")
                or str(item.get("sede") or "").strip().lower() in ("auto", "mediazione")
              ),
            )
          )
    except Exception:
      profiles = []

  # Fallback / integrazione env ADE_PROFILE_1_ID=...
  if not profiles:
    for i in range(1, 9):
      pid = _env(f"ADE_PROFILE_{i}_ID")
      if not pid:
        continue
      sede = _env(f"ADE_PROFILE_{i}_SEDE", pid)
      profiles.append(
        AdeProfile(
          id=pid,
          label=_env(f"ADE_PROFILE_{i}_LABEL", pid),
          sede=sede,
          codice_fiscale=_env(f"ADE_PROFILE_{i}_CF"),
          partita_iva=_env(f"ADE_PROFILE_{i}_PIVA"),
          auth_mode=_env(f"ADE_PROFILE_{i}_AUTH", "cns").lower() or "cns",
          drop_dir=_env(f"ADE_PROFILE_{i}_DROP_DIR"),
          storage_state_path=_env(f"ADE_PROFILE_{i}_STORAGE_STATE"),
          enabled=_env(f"ADE_PROFILE_{i}_ENABLED", "1") not in ("0", "false", "no"),
          auto_section=_env(f"ADE_PROFILE_{i}_AUTO_SECTION", "0") in ("1", "true", "yes")
          or sede.lower() in ("auto", "mediazione"),
        )
      )

  return [p for p in profiles if p.enabled]
