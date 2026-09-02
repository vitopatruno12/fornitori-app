"""Società destinatario fatture passive SDI (classificazione per P.IVA)."""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Set

# Ordine fisso per menu UI
SDI_COMPANY_ORDER: tuple[str, ...] = ("mediazione", "via_lattea", "risacca", "pg")

SDI_COMPANY_LABELS: Dict[str, str] = {
  "mediazione": "Mediazione",
  "via_lattea": "Via Lattea",
  "risacca": "Risacca",
  "pg": "PG",
}

# Sezioni legacy (indirizzo XML) → società
LEGACY_SECTION_TO_COMPANY: Dict[str, str] = {
  "abba": "mediazione",
  "zanardelli": "mediazione",
}

DEFAULT_COMPANY_PIVAS: Dict[str, List[str]] = {
  "mediazione": ["04945600759"],
  "via_lattea": ["04886500752"],  # LA VIA LATTEA SOCIETA' AGRICOLA A R.L.
  "risacca": ["05186540752"],  # RISACCA S.R.L. (visura 13/02/2026)
  "pg": ["05440050754"],  # PG S.R.L. (visura 23/01/2026)
}

ENV_PIVA_KEYS: Dict[str, str] = {
  "mediazione": "SDI_COMPANY_MEDIAZIONE_PIVA",
  "via_lattea": "SDI_COMPANY_VIA_LATTEA_PIVA",
  "risacca": "SDI_COMPANY_RISACCA_PIVA",
  "pg": "SDI_COMPANY_PG_PIVA",
}


def _env(name: str, default: str = "") -> str:
  return (os.getenv(name, default) or default).strip()


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


def company_pivas(company_id: str) -> List[str]:
  cid = (company_id or "").strip().lower()
  if not cid:
    return []
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
      if cid not in SDI_COMPANY_LABELS:
        continue
      piva = normalize_vat(profile.partita_iva)
      if not piva:
        continue
      out.setdefault(cid, [])
      if piva not in out[cid]:
        out[cid].append(piva)
    return out
  except Exception:
    return {}


def vat_to_company_map() -> Dict[str, str]:
  mapping: Dict[str, str] = {}
  ade = _ade_profile_pivas()
  for cid in SDI_COMPANY_ORDER:
    pivas = set(company_pivas(cid))
    pivas.update(ade.get(cid, []))
    for piva in pivas:
      mapping[piva] = cid
  return mapping


def company_from_vat(raw: Optional[str]) -> Optional[str]:
  norm = normalize_vat(raw)
  if not norm:
    return None
  return vat_to_company_map().get(norm)


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
  1) P.IVA cessionario/committente nell'XML
  2) Profilo AdE usato per lo scarico
  3) Euristiche legacy su indirizzo (abba/zanardelli → Mediazione)
  """
  by_vat = company_from_vat(receiver_vat)
  if by_vat:
    return by_vat

  pid = (ade_profile_id or "").strip().lower()
  if pid in SDI_COMPANY_LABELS:
    return pid

  legacy = normalize_company_section(legacy_destination_section)
  if legacy != "non_classificata":
    return legacy

  return "non_classificata"
