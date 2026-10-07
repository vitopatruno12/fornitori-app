from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.enable_banking_service import (
  CONSENT_WARN_DAYS,
  consent_monitor_for_account,
  extract_session_consent_valid_until,
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
