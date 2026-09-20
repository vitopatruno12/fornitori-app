"""Società destinatario fatture passive SDI (classificazione per P.IVA + sede Mediazione A/Z).

P.IVA da visure Camera di Commercio (gen–feb 2026):
- LA MEDIAZIONE SRL 04945600759 → locali Mani in Pasta (Abba / Zanardelli)
- LA VIA LATTEA SOCIETA' AGRICOLA A R.L. 04886500752 → Mucche Volanti
- RISACCA S.R.L. 05186540752 → Bar Momento (Nardò / Santa Caterina)
- PG S.R.L. 05440050754 → Gazza Ladra (Lecce / Arco di Trionfo)
"""
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

# Etichette: società legale · locale operativo
SDI_COMPANY_LABELS: Dict[str, str] = {
  "mediazione_a": "Mediazione A · Mani in Pasta Abba",
  "mediazione_z": "Mediazione Z · Mani in Pasta Zanardelli",
  "via_lattea": "Via Lattea · Mucche Volanti",
  "risacca": "Risacca · Bar Momento",
  "pg": "PG · Gazza Ladra",
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
  "mani_in_pasta": "non_classificata",
  "mani_in_pasta_abba": "mediazione_a",
  "mani_in_pasta_zanardelli": "mediazione_z",
  "mucche_volanti": "via_lattea",
  "bar_momento": "risacca",
  "momento": "risacca",
  "gazza_ladra": "pg",
  "gazza": "pg",
}

# Profili AdE / sedi Atlas → società (solo se manca P.IVA cessionario)
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
  "pg": ["05440050754"],  # PG S.R.L. (visura 23/01/2026) — locale Gazza Ladra
}

ENV_PIVA_KEYS: Dict[str, str] = {
  "mediazione_a": "SDI_COMPANY_MEDIAZIONE_PIVA",
  "mediazione_z": "SDI_COMPANY_MEDIAZIONE_PIVA",
  "via_lattea": "SDI_COMPANY_VIA_LATTEA_PIVA",
  "risacca": "SDI_COMPANY_RISACCA_PIVA",
  "pg": "SDI_COMPANY_PG_PIVA",
}

_DEFAULT_ABBA_KEYWORDS = (
  "abba,via abba,cesare abba,mani in pasta abba,le mani in pasta"
)
_DEFAULT_ZAN_KEYWORDS = (
  "zanardelli,via zanardelli,oberdan,guglielmo oberdan,mani in pasta zanardelli"
)


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


def all_our_company_vats() -> Set[str]:
  """Tutte le P.IVA delle società Atlas (Mediazione + Via Lattea + Risacca + PG)."""
  out: Set[str] = set(mediazione_shared_pivas())
  for cid in SDI_COMPANY_ORDER:
    if cid in MEDIAZIONE_COMPANY_IDS:
      continue
    out.update(company_pivas(cid))
  return {v for v in out if v}


def is_our_company_vat(raw: Optional[str]) -> bool:
  norm = normalize_vat(raw)
  return bool(norm) and norm in all_our_company_vats()


def is_our_issued_to_external(
  *,
  seller_vat: Optional[str] = None,
  receiver_vat: Optional[str] = None,
) -> bool:
  """
  True se il cedente è una nostra società e il cessionario NO:
  fattura emessa verso cliente esterno (non va in ricevute / da registrare).
  """
  if not is_our_company_vat(seller_vat):
    return False
  if is_our_company_vat(receiver_vat) or is_mediazione_vat(receiver_vat):
    return False
  # Cessionario assente o P.IVA esterna
  return True


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


# Società fatture → slug locali (suppliers.locales / Prima Nota)
COMPANY_TO_LOCALES: Dict[str, tuple[str, ...]] = {
  "mediazione_a": ("via_abba",),
  "mediazione_z": ("via_zanardelli",),
  "via_lattea": ("via_lattea",),
  "risacca": ("risacca",),
  "pg": ("pg",),
}


def company_locale_slugs(company_id: Optional[str]) -> List[str]:
  """Slug locali da associare al fornitore in base alla società della fattura ricevuta."""
  cid = normalize_company_section(company_id)
  if cid == "non_classificata":
    return []
  return list(COMPANY_TO_LOCALES.get(cid, ()))


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
  seller_vat: Optional[str] = None,
) -> str:
  """
  Classificazione automatica fatture ricevute (P.IVA cessionario ha priorità):
  1) Emessa nostra verso cliente esterno → non_classificata (non è ricevuta)
  2) Mediazione (stessa P.IVA) → A/Z da indirizzo o profilo sede
  3) Altre società da P.IVA cessionario (Via Lattea / Risacca / PG)
  4) Solo se manca P.IVA cessionario: profilo AdE o euristiche indirizzo
     (P.IVA presente ma sconosciuta ≠ fallback profilo: evita Vergari sotto Via Lattea)
  """
  legacy = normalize_company_section(legacy_destination_section)
  pid = (ade_profile_id or "").strip().lower()

  if is_our_issued_to_external(seller_vat=seller_vat, receiver_vat=receiver_vat):
    return "non_classificata"

  # 1) P.IVA cessionario nota → non lasciare che il profilo AdE sbagli società
  if is_mediazione_vat(receiver_vat):
    if legacy in MEDIAZIONE_COMPANY_IDS:
      return legacy
    if pid in PROFILE_TO_COMPANY:
      return PROFILE_TO_COMPANY[pid]
    return "non_classificata"

  by_vat = company_from_vat(receiver_vat)
  if by_vat:
    return by_vat

  # 2) Solo senza P.IVA cessionario: fallback profilo / indirizzo
  if not normalize_vat(receiver_vat):
    if pid in PROFILE_TO_COMPANY:
      return PROFILE_TO_COMPANY[pid]
    if pid in SDI_COMPANY_LABELS:
      return pid
    if legacy != "non_classificata":
      return legacy

  return "non_classificata"


def pick_issued_company(
  *,
  seller_vat: Optional[str] = None,
  ade_profile_id: Optional[str] = None,
  seller_destination: Optional[str] = None,
  form_company: Optional[str] = None,
) -> str:
  """
  Classificazione fatture emesse: P.IVA del cedente (chi emette) decide la società.
  Via Lattea 04886500752 · Risacca 05186540752 · PG 05440050754 · Mediazione 04945600759.
  Il profilo AdE / form UI è solo fallback se la P.IVA non è mappata.
  """
  legacy = normalize_company_section(destination_to_legacy_section(seller_destination))
  pid = (ade_profile_id or "").strip().lower()
  form = normalize_company_section(form_company) if form_company else "non_classificata"

  if is_mediazione_vat(seller_vat):
    if legacy in MEDIAZIONE_COMPANY_IDS:
      return legacy
    if pid in PROFILE_TO_COMPANY:
      return PROFILE_TO_COMPANY[pid]
    if form in MEDIAZIONE_COMPANY_IDS:
      return form
    return "non_classificata"

  by_vat = company_from_vat(seller_vat)
  if by_vat:
    return by_vat

  if pid in PROFILE_TO_COMPANY:
    return PROFILE_TO_COMPANY[pid]
  if pid in SDI_COMPANY_LABELS:
    return pid
  if form != "non_classificata":
    return form
  if legacy != "non_classificata":
    return legacy
  return "non_classificata"


def resolve_list_company(
  *,
  receiver_vat: Optional[str],
  auto_company: str,
  manual_company: Optional[str],
) -> str:
  """
  Società mostrata in elenco fatture ricevute.
  Se c'è P.IVA cessionario mappata, ignora assign manuali/AdE errati
  (es. Gazza Ladra scaricata nel profilo Risacca).
  Eccezione: Mediazione A/Z resta assegnabile a mano sulla stessa P.IVA.
  """
  manual = normalize_company_section(manual_company) if manual_company else None
  auto = normalize_company_section(auto_company)

  if is_mediazione_vat(receiver_vat):
    if manual in MEDIAZIONE_COMPANY_IDS:
      return manual
    return auto if auto != "non_classificata" else (manual or "non_classificata")

  if company_from_vat(receiver_vat):
    return auto

  if manual and manual != "non_classificata":
    return manual
  return auto
