"""Client Enable Banking (AIS): JWT RS256, /auth, /sessions, accounts & transactions."""

from __future__ import annotations

import logging
import os
import re
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple
from urllib.parse import urlencode

import jwt as pyjwt
import requests
from dotenv import load_dotenv
from sqlalchemy.orm import Session

from ..models.bank_account import BankAccount
from ..models.bank_movement import BankMovement

logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
_ENV_FILE = _BACKEND_ROOT / ".env"
API_ORIGIN = "https://api.enablebanking.com"
STATE_RE = re.compile(r"^atlas-(\d+)-([a-f0-9]{16,})$", re.IGNORECASE)
_ACTIVE_EB_CFG: ContextVar[Optional[Dict[str, Any]]] = ContextVar("active_eb_cfg", default=None)


def _reload_env() -> None:
  load_dotenv(_ENV_FILE, override=True)


def _dec(v: Any) -> Decimal:
  return Decimal(str(v or 0)).quantize(Decimal("0.01"))


def _backend_path(raw: str) -> Path:
  p = Path((raw or "").strip())
  if not p.is_absolute():
    p = (_BACKEND_ROOT / p).resolve()
  return p


def _base_enable_banking_config() -> Dict[str, Any]:
  _reload_env()
  app_id = (os.getenv("ENABLE_BANKING_APP_ID") or "").strip()
  key_path = _backend_path(os.getenv("ENABLE_BANKING_KEY_PATH") or "")
  redirect = (os.getenv("ENABLE_BANKING_REDIRECT_URL") or "").strip()
  env_name = (os.getenv("ENABLE_BANKING_ENVIRONMENT") or "sandbox").strip().lower()
  aspsp_name = (os.getenv("ENABLE_BANKING_ASPSP_NAME") or "Nordea").strip()
  aspsp_country = (os.getenv("ENABLE_BANKING_ASPSP_COUNTRY") or "FI").strip().upper()
  frontend = (
    os.getenv("ENABLE_BANKING_FRONTEND_URL")
    or os.getenv("PUBLIC_APP_URL")
    or "https://www.atlass.it"
  ).strip().rstrip("/")
  consent_days = max(1, min(180, int(os.getenv("ENABLE_BANKING_CONSENT_DAYS", "90") or "90")))
  configured = bool(app_id and key_path.is_file() and redirect)
  return {
    "configured": configured,
    "app_id": app_id or None,
    "key_path": str(key_path) if key_path else None,
    "key_exists": key_path.is_file() if key_path else False,
    "redirect_url": redirect or None,
    "environment": env_name,
    "aspsp_name": aspsp_name,
    "aspsp_country": aspsp_country,
    "frontend_url": frontend,
    "consent_days": consent_days,
    "profile_id": None,
    "message": (
      "Enable Banking configurato"
      if configured
      else "Mancano ENABLE_BANKING_APP_ID / KEY_PATH / REDIRECT_URL o il file .pem"
    ),
  }


def get_enable_banking_config(account: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
  """Config EB globale, oppure override per conto/società (es. Via Lattea)."""
  active = _ACTIVE_EB_CFG.get()
  if active is not None and account is None:
    return active

  cfg = _base_enable_banking_config()
  if account is None:
    return cfg

  from .bank_profiles import resolve_profile_for_account

  prof = resolve_profile_for_account(account)
  if prof.enable_banking_app_id:
    key_raw = prof.enable_banking_key_path or f"./keys/{prof.enable_banking_app_id}.pem"
    key_path = _backend_path(key_raw)
    env_override = (
      (os.getenv("ENABLE_BANKING_VIA_LATTEA_ENVIRONMENT") or "").strip().lower()
      if (prof.company or "").lower() == "via_lattea"
      else ""
    )
    cfg = {
      **cfg,
      "app_id": prof.enable_banking_app_id,
      "key_path": str(key_path),
      "key_exists": key_path.is_file(),
      "profile_id": prof.id,
      "aspsp_name": (prof.bank_name or cfg["aspsp_name"] or "Banca Popolare di Puglia e Basilicata"),
      "aspsp_country": "IT",
      "environment": env_override or "production",
    }
    # Preferisci nome ASPSP Enable Banking noto
    bank_l = (prof.bank_name or "").lower()
    if "bppb" in bank_l or "puglia" in bank_l:
      cfg["aspsp_name"] = "Banca Popolare di Puglia e Basilicata"
    elif "terra d'otranto" in bank_l or "terra dotranto" in bank_l.replace("'", "") or (
      "bcc" in bank_l and "otranto" in bank_l
    ):
      cfg["aspsp_name"] = "BCC Terra d'Otranto"
    configured = bool(cfg["app_id"] and key_path.is_file() and cfg.get("redirect_url"))
    cfg["configured"] = configured
    cfg["message"] = (
      f"Enable Banking configurato ({prof.label})"
      if configured
      else f"Manca .pem o redirect per profilo {prof.label} (app {prof.enable_banking_app_id})"
    )
  return cfg


@contextmanager
def enable_banking_for_account(account: Optional[Dict[str, Any]]) -> Iterator[Dict[str, Any]]:
  cfg = get_enable_banking_config(account)
  token = _ACTIVE_EB_CFG.set(cfg)
  try:
    yield cfg
  finally:
    _ACTIVE_EB_CFG.reset(token)


def _account_dict(row: BankAccount) -> Dict[str, Any]:
  return {
    "id": row.id,
    "iban": row.iban,
    "company": getattr(row, "company", None),
    "bank_name": row.bank_name,
    "account_name": row.account_name,
  }


def _load_private_key() -> bytes:
  cfg = get_enable_banking_config()
  path = Path(cfg["key_path"] or "")
  if not path.is_file():
    raise RuntimeError(f"Chiave Enable Banking non trovata: {path}")
  return path.read_bytes()


def make_jwt(*, ttl_sec: int = 3600) -> str:
  """Firma JWT RS256 richiesto da Enable Banking su ogni richiesta."""
  cfg = get_enable_banking_config()
  app_id = cfg.get("app_id")
  if not app_id:
    raise RuntimeError("ENABLE_BANKING_APP_ID mancante")
  try:
    private_key = _load_private_key()
  except RuntimeError:
    raise
  except Exception as exc:
    raise RuntimeError(f"Chiave Enable Banking non leggibile ({cfg.get('key_path')}): {exc}") from exc
  iat = int(datetime.now(timezone.utc).timestamp())
  payload = {
    "iss": "enablebanking.com",
    "aud": "api.enablebanking.com",
    "iat": iat,
    "exp": iat + max(60, min(ttl_sec, 86400)),
  }
  try:
    token = pyjwt.encode(
      payload,
      private_key,
      algorithm="RS256",
      headers={"kid": app_id, "typ": "JWT", "alg": "RS256"},
    )
  except Exception as exc:
    raise RuntimeError(
      f"Firma JWT Enable Banking fallita (app {app_id}). "
      f"Verifica che il file .pem corrisponda all'App ID. Dettaglio: {exc}"
    ) from exc
  if isinstance(token, bytes):
    return token.decode("ascii")
  return str(token)


def _auth_headers() -> Dict[str, str]:
  return {
    "Authorization": f"Bearer {make_jwt()}",
    "Content-Type": "application/json",
    "Accept": "application/json",
  }


def _request(method: str, path: str, *, json_body: Any = None, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
  url = f"{API_ORIGIN}{path}"
  try:
    resp = requests.request(
      method,
      url,
      headers=_auth_headers(),
      json=json_body,
      params=params,
      timeout=60,
    )
  except requests.RequestException as exc:
    raise RuntimeError(f"Enable Banking rete: {exc}") from exc
  if resp.status_code >= 400:
    detail = (resp.text or "")[:800]
    low = detail.lower()
    if resp.status_code == 403 and "application is not active" in low:
      cfg = get_enable_banking_config()
      app_id = cfg.get("app_id") or "?"
      env = cfg.get("environment") or "?"
      raise RuntimeError(
        "Enable Banking: applicazione non attiva (403). "
        f"App ID {app_id} · ambiente {env}. "
        "Apri https://enablebanking.com/cp/applications , seleziona questa app e "
        "attivala (Restricted Mode collegando un conto, oppure Production dopo contratto/KYB). "
        "Finché lo stato non è Active / Active (Restricted), Atlas non può collegare o sincronizzare."
      )
    raise RuntimeError(f"Enable Banking HTTP {resp.status_code}: {detail}")
  if not resp.content:
    return {}
  data = resp.json()
  if not isinstance(data, dict):
    return {"data": data}
  return data


def get_application() -> Dict[str, Any]:
  return _request("GET", "/application")


def list_aspsps(*, country: Optional[str] = None) -> List[Dict[str, Any]]:
  params = {}
  if country:
    params["country"] = country.upper()
  data = _request("GET", "/aspsps", params=params or None)
  items = data.get("aspsps") if isinstance(data, dict) else None
  return items if isinstance(items, list) else []


def build_state(account_id: int) -> str:
  return f"atlas-{int(account_id)}-{uuid.uuid4().hex}"


def parse_state(state: Optional[str]) -> Optional[int]:
  m = STATE_RE.match((state or "").strip())
  if not m:
    return None
  try:
    return int(m.group(1))
  except ValueError:
    return None


def start_authorization(
  *,
  account_id: int,
  aspsp_name: Optional[str] = None,
  aspsp_country: Optional[str] = None,
  psu_type: str = "personal",
  prefer_iban: Optional[str] = None,
) -> Dict[str, Any]:
  cfg = get_enable_banking_config()
  if not cfg["configured"]:
    raise RuntimeError(cfg["message"])
  name = (aspsp_name or cfg["aspsp_name"] or "Nordea").strip()
  country = (aspsp_country or cfg["aspsp_country"] or "FI").strip().upper()
  valid_until = (datetime.now(timezone.utc) + timedelta(days=int(cfg["consent_days"]))).isoformat()
  state = build_state(account_id)
  # Access minimo: BCC Terra d'Otranto (beta) spesso risponde server_error se si
  # forzano accounts/balances/transactions nel consenso.
  access: Dict[str, Any] = {"valid_until": valid_until}
  # Per banche stabili (es. BPPB) si può richiedere l'IBAN; per BCC/beta no.
  bank_l = name.lower()
  is_bcc_beta = "bcc" in bank_l or "otranto" in bank_l
  if not is_bcc_beta:
    access["balances"] = True
    access["transactions"] = True
    iban = (prefer_iban or "").replace(" ", "").upper()
    if iban:
      access["accounts"] = [{"iban": iban}]
  body = {
    "access": access,
    "aspsp": {"name": name, "country": country},
    "state": state,
    "redirect_url": cfg["redirect_url"],
    "psu_type": psu_type if psu_type in {"personal", "business"} else "personal",
  }
  data = _request("POST", "/auth", json_body=body)
  url = (data.get("url") or "").strip()
  if not url:
    raise RuntimeError("Enable Banking /auth non ha restituito url di login")
  return {
    "ok": True,
    "url": url,
    "state": state,
    "aspsp_name": name,
    "aspsp_country": country,
    "redirect_url": cfg["redirect_url"],
    "psu_type": body["psu_type"],
    "message": f"Apri il link per autenticarti su {name} ({country}).",
  }


def create_session(code: str) -> Dict[str, Any]:
  code = (code or "").strip()
  if not code:
    raise ValueError("Parametro code mancante dal callback banca")
  return _request("POST", "/sessions", json_body={"code": code})


def get_session(session_id: str) -> Dict[str, Any]:
  return _request("GET", f"/sessions/{session_id}")


def get_account_balances(account_uid: str) -> Dict[str, Any]:
  return _request("GET", f"/accounts/{account_uid}/balances")


def get_account_transactions(
  account_uid: str,
  *,
  date_from: Optional[date] = None,
  date_to: Optional[date] = None,
  max_pages: int = 20,
) -> List[Dict[str, Any]]:
  if date_from is None:
    date_from = (datetime.now(timezone.utc) - timedelta(days=90)).date()
  params: Dict[str, Any] = {"date_from": date_from.isoformat()}
  if date_to:
    params["date_to"] = date_to.isoformat()
  out: List[Dict[str, Any]] = []
  continuation: Optional[str] = None
  for _ in range(max(1, max_pages)):
    q = dict(params)
    if continuation:
      q["continuation_key"] = continuation
    data = _request("GET", f"/accounts/{account_uid}/transactions", params=q)
    txs = data.get("transactions") if isinstance(data, dict) else None
    if isinstance(txs, list):
      out.extend(txs)
    continuation = data.get("continuation_key") if isinstance(data, dict) else None
    if not continuation:
      break
  return out


def _normalize_session_accounts(session: Dict[str, Any]) -> List[Dict[str, Any]]:
  """Estrae conti dalla risposta POST/GET session (accounts o accounts_data)."""
  if not isinstance(session, dict):
    return []
  accounts = session.get("accounts")
  if isinstance(accounts, list) and accounts:
    out = [a for a in accounts if isinstance(a, dict) and (a.get("uid") or _extract_iban(a))]
    if out:
      return out
  # GET /sessions/{id} può restituire accounts_data con uid
  data = session.get("accounts_data")
  if isinstance(data, list):
    out = []
    for item in data:
      if not isinstance(item, dict):
        continue
      uid = str(item.get("uid") or item.get("account_uid") or "").strip()
      if not uid:
        continue
      out.append(
        {
          "uid": uid,
          "identification_hash": item.get("identification_hash"),
          "account_id": item.get("account_id") if isinstance(item.get("account_id"), dict) else None,
        }
      )
    return out
  return []


def _resolve_session_accounts(session: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
  accounts = _normalize_session_accounts(session)
  if accounts:
    return session, accounts
  session_id = str(session.get("session_id") or "").strip()
  if not session_id:
    return session, []
  try:
    refreshed = get_session(session_id)
  except Exception:
    logger.warning("GET /sessions/%s fallito dopo create senza conti", session_id, exc_info=True)
    return session, []
  return refreshed, _normalize_session_accounts(refreshed)


def _pick_session_account(session: Dict[str, Any], prefer_iban: Optional[str] = None) -> Dict[str, Any]:
  session, accounts = _resolve_session_accounts(session)
  if not accounts:
    cfg = get_enable_banking_config()
    app_id = str(cfg.get("app_id") or "").strip() or "?"
    profile_id = str(cfg.get("profile_id") or "").strip() or "?"
    iban_hint = (prefer_iban or "").replace(" ", "").upper()
    session_keys = ",".join(sorted(str(k) for k in (session or {}).keys())) if isinstance(session, dict) else ""
    logger.error(
      "EB sessione senza conti app=%s profile=%s iban=%s keys=%s session=%s",
      app_id,
      profile_id,
      iban_hint,
      session_keys,
      {k: session.get(k) for k in ("session_id", "accounts", "accounts_data", "status") if isinstance(session, dict)},
    )
    raise RuntimeError(
      "Sessione Enable Banking senza conti autorizzati. "
      f"App usata da Atlas: {app_id} (profilo {profile_id}). "
      "Gli IBAN devono essere in whitelist SU QUESTA STESSA app nel Control Panel "
      "(non su un'altra applicazione). "
      + (f"IBAN atteso: {iban_hint}. " if iban_hint else "")
      + "Se l'app è corretta e gli IBAN sono già collegati: in banca seleziona proprio quel conto "
      "e riprova con l'altro canale (privato↔impresa)."
    )
  prefer = (prefer_iban or "").replace(" ", "").upper()
  if prefer:
    for acc in accounts:
      if not isinstance(acc, dict):
        continue
      iban = _extract_iban(acc)
      if iban and iban.replace(" ", "").upper() == prefer:
        return acc
  first = accounts[0]
  if not isinstance(first, dict):
    raise RuntimeError("Formato conti sessione non valido")
  return first


def _extract_iban(acc: Dict[str, Any]) -> Optional[str]:
  aid = acc.get("account_id")
  if isinstance(aid, dict):
    iban = (aid.get("iban") or "").strip()
    if iban:
      return iban.upper().replace(" ", "")
  for item in acc.get("all_account_ids") or []:
    if isinstance(item, dict) and item.get("iban"):
      return str(item["iban"]).upper().replace(" ", "")
  return None


def _extract_balances(balances_payload: Dict[str, Any]) -> Tuple[Decimal, Decimal]:
  rows = balances_payload.get("balances") if isinstance(balances_payload, dict) else None
  available = Decimal("0.00")
  booked = Decimal("0.00")
  if not isinstance(rows, list):
    return available, booked
  for row in rows:
    if not isinstance(row, dict):
      continue
    bal_type = str(row.get("balance_type") or row.get("type") or "").upper()
    amount_obj = row.get("balance_amount") or row.get("amount") or {}
    if isinstance(amount_obj, dict):
      amount = _dec(amount_obj.get("amount"))
    else:
      amount = _dec(amount_obj)
    if "INTERIMAVAILABLE" in bal_type or "AVAILABLE" in bal_type or bal_type.endswith("AV"):
      available = amount
    if "CLOSINGBOOKED" in bal_type or "BOOKED" in bal_type or "EXPECTED" in bal_type:
      booked = amount
  if available == 0 and booked != 0:
    available = booked
  if booked == 0 and available != 0:
    booked = available
  return available, booked


def _tx_to_movement(tx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
  if not isinstance(tx, dict):
    return None
  amount_obj = tx.get("transaction_amount") or {}
  amount = _dec(amount_obj.get("amount") if isinstance(amount_obj, dict) else amount_obj)
  if amount <= 0:
    return None
  indicator = str(tx.get("credit_debit_indicator") or "").upper()
  mov_type = "entrata" if indicator in {"CRDT", "CREDIT", "C"} else "uscita"
  date_raw = (
    str(tx.get("booking_date") or tx.get("value_date") or tx.get("transaction_date") or "")
    .strip()[:10]
  )
  try:
    mov_date = date.fromisoformat(date_raw)
  except ValueError:
    return None
  remittance = tx.get("remittance_information")
  if isinstance(remittance, list):
    description = " · ".join(str(x) for x in remittance if x)[:512]
  else:
    description = str(remittance or "").strip()
  if not description:
    btc = tx.get("bank_transaction_code") or {}
    description = str((btc.get("description") if isinstance(btc, dict) else None) or "Movimento Enable Banking")[:512]
  creditor = tx.get("creditor") if isinstance(tx.get("creditor"), dict) else {}
  debtor = tx.get("debtor") if isinstance(tx.get("debtor"), dict) else {}
  counterparty = (creditor.get("name") if mov_type == "uscita" else debtor.get("name")) or None
  if counterparty:
    counterparty = str(counterparty)[:256]
  tx_id = str(tx.get("transaction_id") or tx.get("entry_reference") or "").strip()
  notes = f"Enable Banking{f' · id={tx_id}' if tx_id else ''}"
  return {
    "movement_date": mov_date,
    "description": description,
    "causale": (str((tx.get("bank_transaction_code") or {}).get("code") or "").strip() or None),
    "movement_type": mov_type,
    "amount": amount,
    "counterparty": counterparty,
    "external_key": tx_id or None,
    "notes": notes[:512],
  }


def begin_enable_banking_connect(
  db: Session,
  account_id: int,
  *,
  aspsp_name: Optional[str] = None,
  aspsp_country: Optional[str] = None,
  psu_type: str = "personal",
) -> Dict[str, Any]:
  row = db.query(BankAccount).filter(BankAccount.id == account_id, BankAccount.is_active.is_(True)).first()
  if not row:
    raise ValueError("Conto non trovato")
  bank_l = f"{row.bank_name or ''} {row.account_name or ''}".lower()
  is_bcc = "bcc" in bank_l or "otranto" in bank_l or "terra" in bank_l
  with enable_banking_for_account(_account_dict(row)):
    cfg = get_enable_banking_config()
    app_id = str(cfg.get("app_id") or "").strip()
    if is_bcc and app_id and app_id != "4625919e-22a1-4d40-8267-7587ff2360c0":
      raise RuntimeError(
        f"Profilo Enable Banking sbagliato per BCC: Atlas userebbe app {app_id} "
        f"(profilo {cfg.get('profile_id')}), ma i conti BCC sono legati all'app "
        "4625919e-22a1-4d40-8267-7587ff2360c0. "
        "Controlla /opt/fornitori-app/backend/keys/bank_profiles.json "
        "(devono esserci bcc_via_lattea e bcc_mediazione con quell'app_id)."
      )
    auth = start_authorization(
      account_id=account_id,
      aspsp_name=aspsp_name or None,
      aspsp_country=aspsp_country or None,
      psu_type=psu_type,
      prefer_iban=row.iban,
    )
    auth["enable_banking_app_id"] = app_id
    auth["enable_banking_profile_id"] = cfg.get("profile_id")
  row.connection_status = "pending"
  if auth.get("aspsp_name"):
    row.eb_aspsp_name = str(auth["aspsp_name"])[:120]
  if auth.get("aspsp_country"):
    row.eb_aspsp_country = str(auth["aspsp_country"])[:2]
  db.commit()
  return auth


def complete_enable_banking_callback(
  db: Session,
  *,
  code: str,
  state: Optional[str],
) -> Dict[str, Any]:
  account_id = parse_state(state)
  if not account_id:
    raise ValueError("State callback non valido o scaduto")
  row = db.query(BankAccount).filter(BankAccount.id == account_id, BankAccount.is_active.is_(True)).first()
  if not row:
    raise ValueError("Conto Atlas non trovato per questo callback")

  with enable_banking_for_account(_account_dict(row)):
    session = create_session(code)
    session_id = str(session.get("session_id") or "").strip()
    if not session_id:
      raise RuntimeError("Sessione Enable Banking senza session_id")

    acc = _pick_session_account(session, prefer_iban=row.iban)
    account_uid = str(acc.get("uid") or "").strip()
    if not account_uid:
      raise RuntimeError("Conto banca senza uid nella sessione")

    iban = _extract_iban(acc)
    row.eb_session_id = session_id[:64]
    row.eb_account_uid = account_uid[:64]
    if iban and not row.iban:
      row.iban = iban[:34]
    bank_label = (row.eb_aspsp_name or row.bank_name or "Banca").strip()
    current_bank = (row.bank_name or "").strip().lower()
    if current_bank in {"banca", "conto principale", ""} and row.eb_aspsp_name:
      row.bank_name = row.eb_aspsp_name[:160]

    try:
      bal = get_account_balances(account_uid)
      available, booked = _extract_balances(bal)
      row.saldo_disponibile = available
      row.saldo_contabile = booked
    except Exception:
      logger.warning("Enable Banking balances non disponibili per account %s", account_uid, exc_info=True)

    imported = _import_transactions(db, row, account_uid)
    row.connection_status = "connected"
    row.last_sync_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)

    frontend = get_enable_banking_config()["frontend_url"]
  qs = urlencode({"eb": "ok", "account_id": str(row.id), "imported": str(imported)})
  return {
    "ok": True,
    "account_id": row.id,
    "session_id": session_id,
    "account_uid": account_uid,
    "iban": row.iban,
    "imported": imported,
    "bank_name": bank_label,
    "redirect_to": f"{frontend}/banca/conti?{qs}",
    "message": f"Conto collegato via Enable Banking ({imported} movimenti importati).",
  }


def sync_enable_banking_account(db: Session, account_id: int) -> Dict[str, Any]:
  row = db.query(BankAccount).filter(BankAccount.id == account_id, BankAccount.is_active.is_(True)).first()
  if not row:
    raise ValueError("Conto non trovato")
  if not row.eb_account_uid:
    raise ValueError("Conto non collegato a Enable Banking: avvia prima Collega Enable Banking")

  with enable_banking_for_account(_account_dict(row)):
    try:
      bal = get_account_balances(row.eb_account_uid)
      available, booked = _extract_balances(bal)
      row.saldo_disponibile = available
      row.saldo_contabile = booked
    except Exception:
      logger.warning("Sync balances fallito account %s", account_id, exc_info=True)

    imported = _import_transactions(db, row, row.eb_account_uid)
    row.connection_status = "connected"
    row.last_sync_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
  return {
    "ok": True,
    "imported": imported,
    "account": {
      "id": row.id,
      "iban": row.iban,
      "saldo_disponibile": float(_dec(row.saldo_disponibile)),
      "saldo_contabile": float(_dec(row.saldo_contabile)),
      "connection_status": row.connection_status,
      "last_sync_at": row.last_sync_at.isoformat() if row.last_sync_at else None,
      "eb_session_id": row.eb_session_id,
      "eb_account_uid": row.eb_account_uid,
    },
    "message": f"Sync Enable Banking: {imported} nuovi movimenti.",
  }


def _import_transactions(db: Session, account: BankAccount, account_uid: str) -> int:
  txs = get_account_transactions(account_uid)
  existing_keys = set()
  existing_ext = set()
  for m in (
    db.query(BankMovement)
    .filter(BankMovement.bank_account_id == account.id)
    .order_by(BankMovement.id.desc())
    .limit(5000)
    .all()
  ):
    existing_keys.add(
      (
        m.movement_date.isoformat() if m.movement_date else "",
        m.movement_type or "",
        f"{_dec(m.amount):.2f}",
        (m.description or "")[:80],
      )
    )
    if m.notes and "id=" in m.notes:
      existing_ext.add(m.notes.split("id=", 1)[-1].strip()[:120])

  created = 0
  for tx in txs:
    mapped = _tx_to_movement(tx)
    if not mapped:
      continue
    ext = mapped.get("external_key")
    if ext and ext in existing_ext:
      continue
    key = (
      mapped["movement_date"].isoformat(),
      mapped["movement_type"],
      f"{mapped['amount']:.2f}",
      mapped["description"][:80],
    )
    if key in existing_keys:
      continue
    db.add(
      BankMovement(
        bank_account_id=account.id,
        movement_date=mapped["movement_date"],
        description=mapped["description"],
        causale=mapped.get("causale"),
        movement_type=mapped["movement_type"],
        amount=mapped["amount"],
        counterparty=mapped.get("counterparty"),
        category=None,
        reconciliation_status="unmatched",
        source="enable_banking",
        notes=mapped.get("notes"),
      )
    )
    existing_keys.add(key)
    if ext:
      existing_ext.add(ext)
    created += 1
  return created


def frontend_error_redirect(message: str) -> str:
  frontend = get_enable_banking_config()["frontend_url"]
  qs = urlencode({"eb": "error", "msg": (message or "Errore Enable Banking")[:200]})
  return f"{frontend}/banca/conti?{qs}"
