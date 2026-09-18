"""Profili società / sedi per sync AdE."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


# Mappa sede Atlas → società inbox SDI (mediazione_a | mediazione_z | via_lattea | risacca | pg)
SEDE_TO_SDI_SECTION = {
  "via_abba": "mediazione_a",
  "mediazione_a": "mediazione_a",
  "via_zanardelli": "mediazione_z",
  "mediazione_z": "mediazione_z",
  # Profilo AdE "mediazione": usare auto_section e classificare A/Z da indirizzo XML
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


def _backend_root() -> Path:
  # .../backend/app/integrations/ade/profiles.py → backend/
  return Path(__file__).resolve().parents[2]


def _uploads_profiles_path() -> Path:
  return _backend_root() / "uploads" / "ade" / "profiles.json"


def _example_profiles_path() -> Path:
  return Path(__file__).resolve().parent / "profiles.example.json"


def _default_seed_profiles() -> List[dict]:
  """Profili UI/agent senza segreti (password da impostare da Impostazioni)."""
  return [
    {
      "id": "mediazione",
      "label": "La Mediazione S.R.L. · Mani in Pasta",
      "sede": "mediazione",
      "codice_fiscale": "",
      "partita_iva": "04945600759",
      "utenza_mode": "incaricato",
      "auth_mode": "fisconline",
      "auto_section": True,
      "enabled": True,
    },
    {
      "id": "via_lattea",
      "label": "La Via Lattea · Mucche Volanti",
      "sede": "via_lattea",
      "codice_fiscale": "",
      "partita_iva": "04886500752",
      "utenza_mode": "incaricato",
      "auth_mode": "fisconline",
      "enabled": True,
    },
    {
      "id": "risacca",
      "label": "Risacca S.R.L. · Bar Momento",
      "sede": "risacca",
      "codice_fiscale": "",
      "partita_iva": "05186540752",
      "utenza_mode": "incaricato",
      "auth_mode": "fisconline",
      "enabled": True,
    },
    {
      "id": "pg",
      "label": "PG S.R.L. · Gazza Ladra",
      "sede": "pg",
      "codice_fiscale": "",
      "partita_iva": "05440050754",
      "utenza_mode": "incaricato",
      "auth_mode": "fisconline",
      "enabled": True,
    },
  ]


def resolve_profiles_path() -> Path:
  """
  Path file profili:
  1) ADE_PROFILES_PATH se impostato e il file esiste
  2) altrimenti backend/uploads/ade/profiles.json (scrivibile)
  3) se ADE_PROFILES_PATH è impostato ma assente → usa quel path come destinazione create
  """
  raw = _env("ADE_PROFILES_PATH")
  uploads = _uploads_profiles_path()
  if raw:
    p = Path(raw)
    if p.is_file():
      return p
    if uploads.is_file():
      return uploads
    return p
  if uploads.is_file():
    return uploads
  return uploads


def default_profiles_path() -> Path:
  """Compat: path usato da sync/agent (con ensure)."""
  return ensure_profiles_file()


def ensure_profiles_file(path: Optional[Path] = None) -> Path:
  """Garantisce un profiles.json scrivibile; se manca lo crea da example/seed."""
  p = path or resolve_profiles_path()
  if p.is_file():
    return p

  example = _example_profiles_path()
  seed: List[dict]
  if example.is_file():
    try:
      raw = json.loads(example.read_text(encoding="utf-8"))
      seed = [x for x in raw if isinstance(x, dict)] if isinstance(raw, list) else []
    except Exception:
      seed = []
  else:
    seed = []

  if not seed:
    seed = _default_seed_profiles()
  else:
    # Abilita i profili fisconline in UI anche se l'example li aveva disabled
    for item in seed:
      pid = str(item.get("id") or "").strip().lower()
      if pid in {"mediazione", "via_lattea", "risacca", "pg", "via_abba", "via_zanardelli"}:
        item.setdefault("auth_mode", "fisconline")
        item["enabled"] = True
        # Non copiare password dall'example (non devono esserci)
        item.pop("fisconline_password", None)
        item.pop("fisconline_pin", None)

  p.parent.mkdir(parents=True, exist_ok=True)
  tmp = p.with_suffix(p.suffix + ".tmp")
  tmp.write_text(json.dumps(seed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
  tmp.replace(p)
  return p


def load_profiles(path: Optional[Path] = None) -> List[AdeProfile]:
  """
  Carica profili da JSON (ADE_PROFILES_PATH / uploads/ade) oppure da env ADE_PROFILE_<n>_*.
  """
  p = path or ensure_profiles_file()
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
  out = [pr for pr in profiles if pr.enabled]
  if only:
    ids = {x.strip().lower() for x in only.split(",") if x.strip()}
    # ADE_ONLY_PROFILE include anche profili disabled (es. prova via_lattea)
    out = [pr for pr in profiles if pr.id.lower() in ids]
  return out


def load_profiles_raw(path: Optional[Path] = None) -> List[dict]:
  """Lista dict grezzi dal JSON profili (tutti, anche disabled)."""
  p = path or ensure_profiles_file()
  if not p.is_file():
    return []
  try:
    raw = json.loads(p.read_text(encoding="utf-8"))
  except Exception:
    return []
  if not isinstance(raw, list):
    return []
  return [item for item in raw if isinstance(item, dict) and str(item.get("id") or "").strip()]


def _password_configured(item: dict, pid: str) -> bool:
  if str(item.get("fisconline_password") or "").strip():
    return True
  if _env(f"ADE_PROFILE_{pid.upper()}_FISCONLINE_PASSWORD") or _env("ADE_FISCONLINE_PASSWORD"):
    return True
  return False


def _pin_configured(item: dict, pid: str) -> bool:
  if str(item.get("fisconline_pin") or "").strip():
    return True
  if _env(f"ADE_PROFILE_{pid.upper()}_FISCONLINE_PIN") or _env("ADE_FISCONLINE_PIN"):
    return True
  return False


def profiles_public_list(path: Optional[Path] = None) -> List[dict]:
  """Profili per UI: mai password/PIN in chiaro."""
  p = path or ensure_profiles_file()
  out: List[dict] = []
  for item in load_profiles_raw(p):
    pid = str(item.get("id") or "").strip()
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
        "password_set": _password_configured(item, pid),
        "pin_set": _pin_configured(item, pid),
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
  p = ensure_profiles_file(path)

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
    found["enabled"] = True

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
    "profiles_path": str(p),
    "updated": True,
  }
