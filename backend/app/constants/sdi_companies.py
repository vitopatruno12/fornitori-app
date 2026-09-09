"""Società destinatario fatture passive SDI (classificazione per P.IVA + sede Mediazione A/Z)."""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Set

# Ordine fisso per menu UI — Mediazione divisa in A (Abba) e Z (Zanardelli)
SDI_COMPANY_ORDER: tuple[str, ...] = (
  "mediazione_a",
  "mediazione_z",
  "via_lattea",
  "risacca",
  "pg",
)

SDI_COMPANY_LABELS: Dict[str, str] = {
  "mediazione_a": "Mediazione A",
  "mediazione_z": "Mediazione Z",
  "via_lattea": "Via Lattea",
  "risacca": "Risacca",
  "pg": "PG",
}

# Sezioni legacy (indirizzo XML / alias) → società
LEGACY_SECTION_TO_COMPANY: Dict[str, str] = {
  "abba": "mediazione_a",
  "via_abba": "mediazione_a",
  "mediazione_a": "mediazione_a",
  "zanardelli": "mediazione_z",
  "via_zanardelli": "mediazione_z",
  "mediazione_z": "mediazione_z",
  # Vecchio id unico → da riassegnare manualmente a A o Z
  "mediazione": "non_classificata",
}

# Profili AdE / sedi Atlas → società (quando non serve euristica indirizzo)
PROFILE_TO_COMPANY: Dict[str, str] = {
  "via_abba": "mediazione_a",
  "mediazione_a": "mediazione_a",
  "via_zanardelli": "mediazione_z",
  "mediazione_z": "mediazione_z",
}

# Stessa P.IVA legale per A e Z — lo split avviene da destinazione / profilo sede
MEDIAZIONE_SHARED_PIVAS: List[str] = ["04945600759"]
MEDIAZIONE_COMPANY_IDS: frozenset[str] = frozenset({"mediazione_a", "mediazione_z"})

DEFAULT_COMPANY_PIVAS: Dict[str, List[str]] = {
  "mediazione_a": list(MEDIAZIONE_SHARED_PIVAS),
  "mediazione_z": list(MEDIAZIONE_SHARED_PIVAS),
  "via_lattea": ["04886500752"],  # LA VIA LATTEA SOCIETA' AGRICOLA A R.L.
  "risacca": ["05186540752"],  # RISACCA S.R.L. (visura 13/02/2026)
  "pg": ["05440050754"],  # PG S.R.L. (visura 23/01/2026)
}

ENV_PIVA_KEYS: Dict[str, str] = {
  "mediazione_a": "SDI_COMPANY_MEDIAZIONE_PIVA",
  "mediazione_z": "SDI_COMPANY_MEDIAZIONE_PIVA",
  "via_lattea": "SDI_COMPANY_VIA_LATTEA_PIVA",
  "risacca": "SDI_COMPANY_RISACCA_PIVA",
  "pg": "SDI_COMPANY_PG_PIVA",
}

_DEFAULT_ABBA_KEYWORDS = "abba,via abba"
_DEFAULT_ZAN_KEYWORDS = "zanardelli,via zanardelli"


def _env(name: str, default: str = "") -> str:
  return (os.getenv(name, default) or default).strip()


def _keyword_list(name: str, default: str) -> List[str]:
  raw = _env(name, default)
  return [k.strip().lower() for k in raw.split(",") if k.strip()]


def normalize_vat(raw: Optional[str]) -> str:
  """Normalizza P.IVA italiana: solo cifre (11), senza prefisso IT."""
  if not raw:
    return ""
  s = str(raw).strip().upper().replace(" ", "")
  if s.startswith("IT"):
    s = s[2:]
  digits = "".join(ch for ch in s if ch.isdigit())
  return digits if len(digits) == 11 else ""


def _split_pivas(raw: str) -> List[str]:
  out: List[str] = []
  for part in raw.replace(";", ",").split(","):
    norm = normalize_vat(part)
    if norm:
      out.append(norm)
  return out


def mediazione_shared_pivas() -> List[str]:
  env_raw = _env("SDI_COMPANY_MEDIAZIONE_PIVA")
  if env_raw:
    return _split_pivas(env_raw)
  return list(MEDIAZIONE_SHARED_PIVAS)


def is_mediazione_vat(raw: Optional[str]) -> bool:
  norm = normalize_vat(raw)
  return bool(norm) and norm in set(mediazione_shared_pivas())


def company_pivas(company_id: str) -> List[str]:
  cid = (company_id or "").strip().lower()
  if not cid:
    return []
  if cid in MEDIAZIONE_COMPANY_IDS or cid == "mediazione":
    return mediazione_shared_pivas()
  env_key = ENV_PIVA_KEYS.get(cid)
  env_raw = _env(env_key) if env_key else ""
  if env_raw:
    return _split_pivas(env_raw)
  return list(DEFAULT_COMPANY_PIVAS.get(cid, []))


def _ade_profile_pivas() -> Dict[str, List[str]]:
  """Integra P.IVA da profili AdE (id profilo = id società quando coincide)."""
  try:
    from ..integrations.ade.profiles import load_profiles

    out: Dict[str, List[str]] = {}
    for profile in load_profiles():
      cid = (profile.id or "").strip().lower()
      mapped = PROFILE_TO_COMPANY.get(cid, cid)
      if mapped not in SDI_COMPANY_LABELS and cid not in ("mediazione",):
        continue
      piva = normalize_vat(profile.partita_iva)
      if not piva:
        continue
      # Profilo unico "mediazione" → P.IVA condivisa A/Z
      targets = list(MEDIAZIONE_COMPANY_IDS) if cid == "mediazione" or mapped in MEDIAZIONE_COMPANY_IDS else [mapped]
      for target in targets:
        if target not in SDI_COMPANY_LABELS:
          continue
        out.setdefault(target, [])
        if piva not in out[target]:
          out[target].append(piva)
    return out
  except Exception:
    return {}


def vat_to_company_map() -> Dict[str, str]:
  """
  Mappa P.IVA → società.
  La P.IVA Mediazione NON è inclusa: A/Z si risolvono da destinazione / profilo sede.
  """
  mapping: Dict[str, str] = {}
  ade = _ade_profile_pivas()
  shared = set(mediazione_shared_pivas())
  for cid in SDI_COMPANY_ORDER:
    if cid in MEDIAZIONE_COMPANY_IDS:
      continue
    pivas = set(company_pivas(cid))
    pivas.update(ade.get(cid, []))
    for piva in pivas:
      if piva in shared:
        continue
      mapping[piva] = cid
  return mapping


def company_from_vat(raw: Optional[str]) -> Optional[str]:
  norm = normalize_vat(raw)
  if not norm:
    return None
  if norm in set(mediazione_shared_pivas()):
    return None  # richiede pick_company con destinazione
  return vat_to_company_map().get(norm)


def destination_to_legacy_section(destination: Optional[str]) -> str:
  """Euristica indirizzo XML → abba | zanardelli | non_classificata."""
  dest = (destination or "").lower()
  if not dest:
    return "non_classificata"
  abba = _keyword_list("SDI_DEST_ABBA_KEYWORDS", _DEFAULT_ABBA_KEYWORDS)
  zan = _keyword_list("SDI_DEST_ZANARDELLI_KEYWORDS", _DEFAULT_ZAN_KEYWORDS)
  if any(k in dest for k in abba):
    return "abba"
  if any(k in dest for k in zan):
    return "zanardelli"
  return "non_classificata"


def normalize_company_section(section: Optional[str]) -> str:
  """Mappa sezione legacy o società → id società valido o non_classificata."""
  key = (section or "").strip().lower()
  if not key or key == "non_classificata":
    return "non_classificata"
  if key in SDI_COMPANY_LABELS:
    return key
  if key in LEGACY_SECTION_TO_COMPANY:
    return LEGACY_SECTION_TO_COMPANY[key]
  return "non_classificata"


def valid_assign_sections() -> Set[str]:
  return set(SDI_COMPANY_LABELS) | {"non_classificata"} | set(LEGACY_SECTION_TO_COMPANY)


def company_label(company_id: str) -> str:
  cid = normalize_company_section(company_id)
  if cid == "non_classificata":
    return "Non classificate"
  return SDI_COMPANY_LABELS.get(cid, cid)


def list_companies() -> List[Dict[str, Any]]:
  ade = _ade_profile_pivas()
  rows: List[Dict[str, Any]] = []
  for cid in SDI_COMPANY_ORDER:
    pivas = list(dict.fromkeys([*company_pivas(cid), *ade.get(cid, [])]))
    rows.append(
      {
        "id": cid,
        "label": SDI_COMPANY_LABELS[cid],
        "partita_iva": pivas[0] if pivas else "",
        "partite_iva": pivas,
      }
    )
  return rows


def pick_company(
  *,
  receiver_vat: Optional[str] = None,
  ade_profile_id: Optional[str] = None,
  legacy_destination_section: Optional[str] = None,
) -> str:
  """
  Classificazione automatica:
  1) Mediazione (stessa P.IVA) → A/Z da indirizzo o profilo sede (via_abba / via_zanardelli)
  2) Altre società da P.IVA cessionario
  3) Profilo AdE
  4) Euristiche legacy indirizzo
  """
  legacy = normalize_company_section(legacy_destination_section)
  pid = (ade_profile_id or "").strip().lower()

  mediazione_context = (
    is_mediazione_vat(receiver_vat)
    or pid in ("mediazione", *PROFILE_TO_COMPANY.keys())
    or legacy in MEDIAZIONE_COMPANY_IDS
  )
  if mediazione_context:
    if legacy in MEDIAZIONE_COMPANY_IDS:
      return legacy
    if pid in PROFILE_TO_COMPANY:
      return PROFILE_TO_COMPANY[pid]
    # P.IVA Mediazione senza sede riconoscibile → da assegnare a A o Z
    return "non_classificata"

  by_vat = company_from_vat(receiver_vat)
  if by_vat:
    return by_vat

  if pid in SDI_COMPANY_LABELS:
    return pid

  if legacy != "non_classificata":
    return legacy

  return "non_classificata"
