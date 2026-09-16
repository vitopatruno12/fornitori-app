"""Profili credenziali home banking (multi-conto / multi-società)."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional


def _env(name: str, default: str = "") -> str:
  return (os.getenv(name, default) or default).strip()


def _normalize_iban(raw: Optional[str]) -> str:
  return re.sub(r"\s+", "", str(raw or "")).upper()


@dataclass
class BankProfile:
  id: str
  label: str
  bank_name: str = ""
  iban: str = ""
  account_number: str = ""
  company: str = ""
  username: str = ""
  password: str = ""
  portal_url: str = ""
  enable_banking_app_id: str = ""
  enable_banking_key_path: str = ""
  enabled: bool = True


def default_profiles_path() -> Path:
  raw = _env("BANK_PROFILES_PATH")
  if raw:
    return Path(raw)
  keys = Path(__file__).resolve().parent.parent.parent / "keys" / "bank_profiles.json"
  if keys.is_file():
    return keys
  uploads = Path(__file__).resolve().parent.parent.parent / "uploads" / "banca" / "bank_profiles.json"
  if uploads.is_file():
    return uploads
  return Path(__file__).resolve().parent.parent.parent / "keys" / "bank_profiles.example.json"


def _resolve_eb_fields(company: str, item: Optional[dict] = None, env_prefix: str = "") -> tuple[str, str]:
  item = item or {}
  eb_app = str(
    item.get("enable_banking_app_id")
    or (_env(f"{env_prefix}_ENABLE_BANKING_APP_ID") if env_prefix else "")
    or (_env("ENABLE_BANKING_VIA_LATTEA_APP_ID") if company == "via_lattea" else "")
    or ""
  ).strip()
  eb_key = str(
    item.get("enable_banking_key_path")
    or (_env(f"{env_prefix}_ENABLE_BANKING_KEY_PATH") if env_prefix else "")
    or (_env("ENABLE_BANKING_VIA_LATTEA_KEY_PATH") if company == "via_lattea" else "")
    or ""
  ).strip()
  if eb_app and not eb_key:
    eb_key = f"./keys/{eb_app}.pem"
  return eb_app, eb_key


def _profile_from_dict(item: dict) -> Optional[BankProfile]:
  pid = str(item.get("id") or "").strip()
  if not pid:
    return None
  env_prefix = f"BANK_PROFILE_{pid.upper().replace('-', '_')}"
  username = str(item.get("username") or _env(f"{env_prefix}_USERNAME") or "").strip()
  password = str(item.get("password") or _env(f"{env_prefix}_PASSWORD") or "").strip()
  company = str(item.get("company") or _env(f"{env_prefix}_COMPANY") or "").strip().lower()
  eb_app, eb_key = _resolve_eb_fields(company, item, env_prefix)
  return BankProfile(
    id=pid,
    label=str(item.get("label") or pid).strip(),
    bank_name=str(item.get("bank_name") or _env(f"{env_prefix}_NAME") or "").strip(),
    iban=_normalize_iban(item.get("iban") or _env(f"{env_prefix}_IBAN")),
    account_number=str(item.get("account_number") or _env(f"{env_prefix}_ACCOUNT_NUMBER") or "").strip(),
    company=company,
    username=username,
    password=password,
    portal_url=str(item.get("portal_url") or _env(f"{env_prefix}_PORTAL_URL") or "").strip(),
    enable_banking_app_id=eb_app,
    enable_banking_key_path=eb_key,
    enabled=bool(item.get("enabled", True)),
  )


def load_profiles(path: Optional[Path] = None) -> List[BankProfile]:
  p = path or default_profiles_path()
  profiles: List[BankProfile] = []

  if p.is_file():
    try:
      raw = json.loads(p.read_text(encoding="utf-8"))
      if isinstance(raw, list):
        for item in raw:
          if isinstance(item, dict):
            prof = _profile_from_dict(item)
            if prof:
              profiles.append(prof)
    except Exception:
      profiles = []

  if not profiles:
    for i in range(1, 9):
      pid = _env(f"BANK_PROFILE_{i}_ID")
      if not pid:
        continue
      company = _env(f"BANK_PROFILE_{i}_COMPANY").lower()
      eb_app, eb_key = _resolve_eb_fields(
        company,
        {
          "enable_banking_app_id": _env(f"BANK_PROFILE_{i}_ENABLE_BANKING_APP_ID"),
          "enable_banking_key_path": _env(f"BANK_PROFILE_{i}_ENABLE_BANKING_KEY_PATH"),
        },
        f"BANK_PROFILE_{i}",
      )
      profiles.append(
        BankProfile(
          id=pid,
          label=_env(f"BANK_PROFILE_{i}_LABEL", pid),
          bank_name=_env(f"BANK_PROFILE_{i}_NAME"),
          iban=_normalize_iban(_env(f"BANK_PROFILE_{i}_IBAN")),
          account_number=_env(f"BANK_PROFILE_{i}_ACCOUNT_NUMBER"),
          company=company,
          username=_env(f"BANK_PROFILE_{i}_USERNAME"),
          password=_env(f"BANK_PROFILE_{i}_PASSWORD"),
          portal_url=_env(f"BANK_PROFILE_{i}_PORTAL_URL"),
          enable_banking_app_id=eb_app,
          enable_banking_key_path=eb_key,
          enabled=_env(f"BANK_PROFILE_{i}_ENABLED", "1") not in ("0", "false", "no"),
        )
      )

  return [p for p in profiles if p.enabled]


def _global_env_profile() -> BankProfile:
  return BankProfile(
    id="env_default",
    label="Default (.env)",
    bank_name=_env("BANK_NAME"),
    iban=_normalize_iban(_env("BANK_IBAN")),
    account_number=_env("BANK_ACCOUNT_NUMBER"),
    username=_env("BANK_USERNAME"),
    password=_env("BANK_PASSWORD"),
    portal_url=_env("BANK_PORTAL_URL"),
    enabled=True,
  )


def resolve_profile_for_account(account: Optional[Dict[str, Any]] = None) -> BankProfile:
  """Trova profilo per IBAN, id profilo, banca o società; fallback su BANK_* .env.

  Priorità: profile_id → IBAN esatto → società+nome banca → società (match univoco) → .env.
  """
  acct = account or {}
  iban = _normalize_iban(acct.get("iban"))
  company = str(acct.get("company") or "").strip().lower()
  bank_name = str(acct.get("bank_name") or "").strip().lower()
  profile_id = str(acct.get("bank_profile_id") or acct.get("credentials_profile_id") or "").strip().lower()

  profiles = load_profiles()

  for prof in profiles:
    if profile_id and prof.id.lower() == profile_id:
      return prof

  for prof in profiles:
    if iban and prof.iban and prof.iban == iban:
      return prof

  def _bank_hint_match(a: str, b: str) -> bool:
    if not a or not b:
      return False
    if "otranto" in a or ("bcc" in a and "terra" in a):
      return "otranto" in b or ("bcc" in b and "terra" in b) or "bcc" in b and "otranto" in b
    if "bppb" in a or "puglia" in a or "basilicata" in a:
      return "bppb" in b or "puglia" in b or "basilicata" in b
    return False

  # Preferisci match banca+società prima dell'app EB generica (evita Via Lattea BPPB → profilo BCC).
  if company:
    company_matches = [p for p in profiles if p.company and p.company == company]
    if bank_name and company_matches:
      for prof in company_matches:
        if _bank_hint_match(bank_name, (prof.bank_name or "").lower()) or _bank_hint_match(
          (prof.bank_name or "").lower(), bank_name
        ):
          return prof
      # Match su id profilo (es. bcc_via_lattea / bppb_via_lattea)
      for prof in company_matches:
        pid = (prof.id or "").lower()
        if "bcc" in bank_name or "otranto" in bank_name:
          if "bcc" in pid:
            return prof
        if "bppb" in bank_name or "puglia" in bank_name or "basilicata" in bank_name:
          if "bppb" in pid:
            return prof
    if len(company_matches) == 1:
      return company_matches[0]
    # Più conti stessa società: preferisci match IBAN già fatto sopra; poi banca da id profilo.
    if bank_name:
      for prof in company_matches:
        pid = (prof.id or "").lower()
        if ("bppb" in bank_name or "puglia" in bank_name) and "bppb" in pid:
          return prof
        if ("bcc" in bank_name or "otranto" in bank_name) and "bcc" in pid:
          return prof
    for prof in company_matches:
      if prof.username and prof.password:
        return prof
    for prof in company_matches:
      if prof.enable_banking_app_id:
        return prof

  fallback = _global_env_profile()
  if fallback.username and fallback.password:
    return fallback

  for prof in profiles:
    if prof.username and prof.password:
      return prof
  return fallback


def profile_public(prof: BankProfile) -> Dict[str, Any]:
  return {
    "id": prof.id,
    "label": prof.label,
    "bank_name": prof.bank_name or None,
    "iban": prof.iban or None,
    "company": prof.company or None,
    "portal_url": prof.portal_url or None,
    "credentials_configured": bool(prof.username and prof.password),
    "username_hint": _mask_user(prof.username),
    "enable_banking_app_id": prof.enable_banking_app_id or None,
  }


def profiles_public_list() -> List[Dict[str, Any]]:
  seen = set()
  out: List[Dict[str, Any]] = []
  for prof in load_profiles():
    if prof.id in seen:
      continue
    seen.add(prof.id)
    out.append(profile_public(prof))
  env_prof = _global_env_profile()
  if env_prof.username and env_prof.password and "env_default" not in seen:
    out.append(profile_public(env_prof))
  return out


def _mask_user(user: str) -> str:
  u = (user or "").strip()
  if len(u) <= 2:
    return "***"
  if "@" in u:
    name, _, domain = u.partition("@")
    return f"{name[:2]}***@{domain}"
  return f"{u[:2]}***{u[-1:]}"
