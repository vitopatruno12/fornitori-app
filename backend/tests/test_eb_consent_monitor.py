from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.enable_banking_service import (
  CONSENT_WARN_DAYS,
  DEFAULT_CONSENT_DAYS,
  apply_session_consent,
  bank_link_is_down,
  consent_monitor_for_account,
  consent_monitor_summary,
  extract_session_consent_valid_until,
  fill_missing_consent_deadline,
)


def test_extract_session_consent_valid_until():
  vu = extract_session_consent_valid_until(
    {"access": {"valid_until": "2026-12-01T12:00:00Z"}}
  )
  assert vu is not None
  assert vu.year == 2026 and vu.month == 12


def test_consent_warn_within_five_days():
  row = SimpleNamespace(
    id=9,
    bank_name="BCC",
    account_name="Mediazione Z",
    company="mediazione_z",
    connection_status="connected",
    eb_account_uid="uid-9",
    is_active=True,
    eb_consent_valid_until=datetime.now(timezone.utc) + timedelta(days=3),
  )
  hit = consent_monitor_for_account(row)
  assert hit["status"] == "warn"
  assert hit["days_left"] == 3
  assert CONSENT_WARN_DAYS >= 5 or hit["days_left"] <= CONSENT_WARN_DAYS


def test_consent_ok_far_future():
  row = SimpleNamespace(
    id=3,
    bank_name="BPPB",
    account_name="Mediazione",
    company="mediazione_a",
    connection_status="connected",
    eb_account_uid="uid-3",
    is_active=True,
    eb_consent_valid_until=datetime.now(timezone.utc) + timedelta(days=40),
  )
  hit = consent_monitor_for_account(row)
  assert hit["status"] == "ok"
  assert hit["days_left"] >= 39


def test_missing_deadline_starts_at_180_days_once():
  row = SimpleNamespace(
    id=10,
    bank_name="BPPB",
    account_name="Via Lattea",
    company="via_lattea",
    connection_status="connected",
    eb_account_uid="uid-10",
    is_active=True,
    eb_consent_valid_until=None,
  )
  assert fill_missing_consent_deadline(row) is True
  assert fill_missing_consent_deadline(row) is False
  hit = consent_monitor_for_account(row)
  assert hit["status"] == "ok"
  assert hit["days_left"] >= DEFAULT_CONSENT_DAYS - 1
  kept = row.eb_consent_valid_until
  apply_session_consent(row, {"access": {}})
  assert row.eb_consent_valid_until == kept


def test_conto_in_errore_e_staccato():
  row = SimpleNamespace(
    id=11,
    bank_name="BCC",
    account_name="Via Lattea",
    company="via_lattea",
    connection_status="error",
    eb_account_uid="uid-11",
    is_active=True,
    eb_consent_valid_until=datetime.now(timezone.utc) + timedelta(days=70),
  )
  hit = consent_monitor_for_account(row)
  assert hit["status"] == "detached"
  assert hit["message"] == "Conto staccato — ricollega"


def test_sessione_rifiutata_accende_il_conto_staccato(monkeypatch):
  assert bank_link_is_down("Enable Banking HTTP 401: Session expired")
  assert not bank_link_is_down("")
  row = SimpleNamespace(
    id=8,
    bank_name="BCC Terra d'Otranto",
    account_name="Via Lattea",
    company="via_lattea",
    connection_status="connected",
    eb_account_uid="uid-8",
    is_active=True,
    eb_consent_valid_until=datetime.now(timezone.utc) + timedelta(days=70),
  )
  hit = consent_monitor_for_account(row)
  assert hit["status"] == "ok"
  monkeypatch.setattr(
    "app.services.enable_banking_service._detached_account_ids",
    lambda: {8},
  )
  summary = consent_monitor_summary([row])
  marked = summary["items"][0]
  assert marked["status"] == "detached"
  assert summary["detached"] == 1
  assert summary["needs_action"] == 0


def test_real_session_date_replaces_missing_deadline():
  row = SimpleNamespace(
    id=5,
    bank_name="Intesa",
    account_name="Risacca",
    company="risacca",
    connection_status="connected",
    eb_account_uid="uid-5",
    is_active=True,
    eb_consent_valid_until=None,
  )
  apply_session_consent(row, {"access": {"valid_until": "2027-04-01T00:00:00Z"}})
  assert row.eb_consent_valid_until.year == 2027
  assert row.eb_consent_valid_until.month == 4
