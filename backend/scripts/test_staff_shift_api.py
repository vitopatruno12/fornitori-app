"""Test rapido endpoint turni (richiede FastAPI su :8000)."""

import json
import sys

import requests

URL = "http://127.0.0.1:8000/ai/staff/shift-suggest"
BODY = {
    "text": "Marianna 8-16",
    "member_names": ["Marianna Rossi", "Luco Test"],
    "context": {
        "selected_date": "2026-05-20",
        "week_start": "2026-05-18",
        "week_end": "2026-05-24",
        "today": "2026-05-19",
        "plan_view": "week",
    },
}


def main() -> int:
    try:
        r = requests.post(URL, json=BODY, timeout=30)
    except requests.RequestException as exc:
        print(f"ERRORE connessione: {exc}")
        print("Avvia FastAPI: cd backend && .venv\\Scripts\\uvicorn app.main:app --reload --port 8000")
        return 1
    print(f"HTTP {r.status_code}")
    data = r.json()
    print(json.dumps(data, indent=2, ensure_ascii=False))
    shifts = data.get("suggested_shifts") or []
    if not shifts:
        print("FAIL: nessun turno suggerito")
        return 2
    print(f"OK: {len(shifts)} turno/i, primo giorno={shifts[0].get('work_date')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
