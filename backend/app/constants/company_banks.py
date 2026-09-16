"""Conti bancari attesi per società Atlas (riconciliazione / mastrini).

Fonte operativa (marzo 2026):
- Mediazione A/Z → BPPB + BCC Terra d'Otranto
- Via Lattea → BCC + BPPB
- Risacca (Bar Momento) → Intesa Sanpaolo
- PG (Gazza Ladra) → BPPB
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

# IBAN canoniche (senza spazi, maiuscole)
IBAN_MEDIAZIONE_BPPB = "IT55B0538516000CC1410004512"
IBAN_MEDIAZIONE_BCC = "IT06B0844516000000000972450"
IBAN_VIA_LATTEA_BPPB = "IT25D0538516000CC1410004514"
IBAN_VIA_LATTEA_BPPB_LEGACY = "IT25D0538516000CC410004514"
IBAN_VIA_LATTEA_BCC = "IT37M0844516000000000967252"
IBAN_RISACCA_INTESA = "IT88N0306979822100000008926"

MEDIAZIONE_COMPANIES: frozenset[str] = frozenset({"mediazione_a", "mediazione_z", "mediazione"})

# Società → IBAN noti + keyword banca (fallback se IBAN non ancora in anagrafica)
COMPANY_BANK_EXPECTATIONS: Dict[str, Dict[str, Any]] = {
  "mediazione_a": {
    "label": "Mediazione · Mani in Pasta",
    "banks": ("BPPB", "BCC Terra d'Otranto"),
    "ibans": frozenset({IBAN_MEDIAZIONE_BPPB, IBAN_MEDIAZIONE_BCC}),
    "company_tags": MEDIAZIONE_COMPANIES,
    "bank_keywords": ("bppb", "puglia", "basilicata", "bcc", "terra d'otranto", "terra dotranto"),
  },
  "mediazione_z": {
    "label": "Mediazione · Mani in Pasta",
    "banks": ("BPPB", "BCC Terra d'Otranto"),
    "ibans": frozenset({IBAN_MEDIAZIONE_BPPB, IBAN_MEDIAZIONE_BCC}),
    "company_tags": MEDIAZIONE_COMPANIES,
    "bank_keywords": ("bppb", "puglia", "basilicata", "bcc", "terra d'otranto", "terra dotranto"),
  },
  "via_lattea": {
    "label": "Via Lattea · Mucche Volanti",
    "banks": ("BCC Terra d'Otranto", "BPPB"),
    "ibans": frozenset({IBAN_VIA_LATTEA_BPPB, IBAN_VIA_LATTEA_BPPB_LEGACY, IBAN_VIA_LATTEA_BCC}),
    "company_tags": frozenset({"via_lattea"}),
    "bank_keywords": ("bppb", "puglia", "basilicata", "bcc", "terra d'otranto", "terra dotranto"),
  },
  "risacca": {
    "label": "Risacca · Bar Momento",
    "banks": ("Intesa Sanpaolo",),
    "ibans": frozenset({IBAN_RISACCA_INTESA}),
    "company_tags": frozenset({"risacca"}),
    "bank_keywords": ("intesa", "sanpaolo", "san paolo"),
  },
  "pg": {
    "label": "PG · Gazza Ladra",
    "banks": ("BPPB",),
    "ibans": frozenset(),  # IBAN specifico da impostare su Conti correnti (company=pg)
    "company_tags": frozenset({"pg"}),
    "bank_keywords": ("bppb", "puglia", "basilicata"),
  },
}

# IBAN → società da assegnare in anagrafica conti
IBAN_TO_COMPANY: Dict[str, str] = {
  IBAN_MEDIAZIONE_BPPB: "mediazione_a",
  IBAN_MEDIAZIONE_BCC: "mediazione_a",
  IBAN_VIA_LATTEA_BPPB: "via_lattea",
  IBAN_VIA_LATTEA_BPPB_LEGACY: "via_lattea",
  IBAN_VIA_LATTEA_BCC: "via_lattea",
  IBAN_RISACCA_INTESA: "risacca",
}


def normalize_iban(raw: Optional[str]) -> str:
  return "".join(ch for ch in str(raw or "").upper() if ch.isalnum())


def expected_banks_for_company(company_id: Optional[str]) -> List[str]:
  cid = (company_id or "").strip().lower()
  spec = COMPANY_BANK_EXPECTATIONS.get(cid)
  if not spec:
    return []
  return list(spec.get("banks") or [])


def company_tags_for(company_id: Optional[str]) -> Set[str]:
  cid = (company_id or "").strip().lower()
  spec = COMPANY_BANK_EXPECTATIONS.get(cid)
  if not spec:
    return {cid} if cid else set()
  return set(spec.get("company_tags") or {cid})


def account_matches_company(
  *,
  company_id: Optional[str],
  account_company: Optional[str],
  bank_name: Optional[str],
  account_name: Optional[str],
  iban: Optional[str],
  notes: Optional[str] = None,
) -> bool:
  """True se il conto appartiene alla società (P.IVA operativa / IBAN / tag company)."""
  cid = (company_id or "").strip().lower()
  if not cid:
    return True
  spec = COMPANY_BANK_EXPECTATIONS.get(cid)
  if not spec:
    return (account_company or "").strip().lower() == cid

  iban_n = normalize_iban(iban)
  known_ibans: Set[str] = set(spec.get("ibans") or ())
  if iban_n and iban_n in known_ibans:
    return True

  tags = set(spec.get("company_tags") or {cid})
  acc_co = (account_company or "").strip().lower()
  if acc_co and acc_co in tags:
    # Evita che un BPPB Mediazione (company mediazione_a) finisca sotto PG
    # se PG non ha IBAN noti: richiedi anche keyword banca + nome account/pg
    if cid == "pg" and not known_ibans:
      blob = f"{bank_name or ''} {account_name or ''} {notes or ''}".lower()
      if "gazza" in blob or " pg" in f" {blob}" or blob.strip().startswith("pg"):
        return True
      # company=pg esplicito sul conto → ok
      return acc_co == "pg"
    return True

  # Solo per società con IBAN noti: non usare keyword banca da sole
  # (altrimenti tutti i BPPB matchano Mediazione e Via Lattea).
  # Eccezione Risacca: Intesa senza company tag ma IBAN già sopra; se manca IBAN
  # accetta keyword intesa + (risacca|momento) nel nome/note.
  if cid == "risacca" and not iban_n:
    blob = f"{bank_name or ''} {account_name or ''} {notes or ''}".lower()
    if any(k in blob for k in ("intesa", "sanpaolo", "san paolo")) and (
      "risacca" in blob or "momento" in blob or not acc_co
    ):
      return True

  return False
