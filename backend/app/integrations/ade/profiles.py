"""Profili società / sedi per sync AdE."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


# Mappa sede Atlas → società inbox SDI (mediazione | via_lattea | risacca | pg)
SEDE_TO_SDI_SECTION = {
  "via_abba": "mediazione",
  "mediazione": "mediazione",
  "via_zanardelli": "mediazione",
  "via_lattea": "via_lattea",
  "risacca": "risacca",
  "pg": "pg",
}


@dataclass
class AdeProfile:
  id: str
  label: str
  sede: str  # slug Atlas: via_abba | via_lattea | risacca | via_zanardelli | mediazione
  codice_fiscale: str = ""
  partita_iva: str = ""
  # cns | fisconline | storage | drop
  auth_mode: str = "cns"
  drop_dir: str = ""
  storage_state_path: str = ""
  fisconline_password: str = ""
  fisconline_pin: str = ""
  enabled: bool = True
  # Se True: non forza assign; Atlas classifica da indirizzo XML (abba/zanardelli)
  auto_section: bool = False
  # me_stesso | incaricato | auto (auto = incaricato se c'è partita_iva)
  utenza_mode: str = "auto"

  @property
  def sdi_section(self) -> Optional[str]:
    if self.auto_section:
      return None
    pid = (self.id or "").strip().lower()
    if pid in SEDE_TO_SDI_SECTION:
      return SEDE_TO_SDI_SECTION[pid]
    sede = (self.sede or "").strip().lower()
    return SEDE_TO_SDI_SECTION.get(sede)


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
              fisconline_password=str(
                item.get("fisconline_password")
                or _env(f"ADE_PROFILE_{pid.upper()}_FISCONLINE_PASSWORD")
                or _env("ADE_FISCONLINE_PASSWORD")
                or ""
              ).strip(),
              fisconline_pin=str(
                item.get("fisconline_pin")
                or _env(f"ADE_PROFILE_{pid.upper()}_FISCONLINE_PIN")
                or _env("ADE_FISCONLINE_PIN")
                or ""
              ).strip(),
              enabled=bool(item.get("enabled", True)),
              auto_section=bool(
                item.get("auto_section")
                or str(item.get("sede") or "").strip().lower() in ("auto", "mediazione")
              ),
              utenza_mode=str(item.get("utenza_mode") or "auto").strip().lower() or "auto",
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
          fisconline_password=_env(f"ADE_PROFILE_{i}_FISCONLINE_PASSWORD") or _env("ADE_FISCONLINE_PASSWORD"),
          fisconline_pin=_env(f"ADE_PROFILE_{i}_FISCONLINE_PIN") or _env("ADE_FISCONLINE_PIN"),
          enabled=_env(f"ADE_PROFILE_{i}_ENABLED", "1") not in ("0", "false", "no"),
          auto_section=_env(f"ADE_PROFILE_{i}_AUTO_SECTION", "0") in ("1", "true", "yes")
          or sede.lower() in ("auto", "mediazione"),
        )
      )

  only = _env("ADE_ONLY_PROFILE")
  out = [p for p in profiles if p.enabled]
  if only:
    ids = {x.strip().lower() for x in only.split(",") if x.strip()}
    # ADE_ONLY_PROFILE include anche profili disabled (es. prova via_lattea)
    out = [p for p in profiles if p.id.lower() in ids]
  return out


def load_profiles_raw(path: Optional[Path] = None) -> List[dict]:
  """Lista dict grezzi dal JSON profili (tutti, anche disabled)."""
  p = path or default_profiles_path()
  if not p.is_file():
    return []
  try:
    raw = json.loads(p.read_text(encoding="utf-8"))
  except Exception:
    return []
  if not isinstance(raw, list):
    return []
  return [item for item in raw if isinstance(item, dict) and str(item.get("id") or "").strip()]


def profiles_public_list(path: Optional[Path] = None) -> List[dict]:
  """Profili per UI: mai password/PIN in chiaro."""
  out: List[dict] = []
  for item in load_profiles_raw(path):
    pid = str(item.get("id") or "").strip()
    pwd = str(item.get("fisconline_password") or "").strip()
    pin = str(item.get("fisconline_pin") or "").strip()
    out.append(
      {
        "id": pid,
        "label": str(item.get("label") or pid).strip(),
        "sede": str(item.get("sede") or pid).strip(),
        "codice_fiscale": str(item.get("codice_fiscale") or "").strip(),
        "partita_iva": str(item.get("partita_iva") or item.get("piva") or "").strip(),
        "auth_mode": str(item.get("auth_mode") or "cns").strip().lower() or "cns",
        "utenza_mode": str(item.get("utenza_mode") or "auto").strip().lower() or "auto",
        "enabled": bool(item.get("enabled", True)),
        "password_set": bool(pwd),
        "pin_set": bool(pin),
      }
    )
  return out


def update_fisconline_credentials(
  profile_id: str,
  *,
  password: Optional[str] = None,
  pin: Optional[str] = None,
  path: Optional[Path] = None,
) -> dict:
  """
  Aggiorna password/PIN Fisconline nel JSON profili.
  Campi None = non modificare; stringa (anche vuota) = sovrascrivere.
  """
  p = path or default_profiles_path()
  if not p.is_file():
    raise FileNotFoundError(f"File profili AdE non trovato: {p}")

  raw = json.loads(p.read_text(encoding="utf-8"))
  if not isinstance(raw, list):
    raise ValueError("profiles.json non è una lista")

  pid = (profile_id or "").strip().lower()
  found = None
  for item in raw:
    if not isinstance(item, dict):
      continue
    if str(item.get("id") or "").strip().lower() == pid:
      found = item
      break
  if found is None:
    raise KeyError(f"Profilo AdE non trovato: {profile_id}")

  if password is not None:
    found["fisconline_password"] = str(password)
  if pin is not None:
    found["fisconline_pin"] = str(pin)
  # Preferisci Fisconline se stiamo salvando credenziali
  if password is not None or pin is not None:
    mode = str(found.get("auth_mode") or "").strip().lower()
    if mode in ("", "cns"):
      found["auth_mode"] = "fisconline"

  tmp = p.with_suffix(p.suffix + ".tmp")
  tmp.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
  tmp.replace(p)

  pwd = str(found.get("fisconline_password") or "").strip()
  pin_v = str(found.get("fisconline_pin") or "").strip()
  return {
    "id": str(found.get("id") or "").strip(),
    "label": str(found.get("label") or "").strip(),
    "auth_mode": str(found.get("auth_mode") or "").strip(),
    "password_set": bool(pwd),
    "pin_set": bool(pin_v),
    "updated": True,
  }
