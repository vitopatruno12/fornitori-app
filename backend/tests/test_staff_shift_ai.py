"""Test compilazione turni (euristiche, senza Ollama)."""

import unittest

from app.ai import service as ai_service
from app.services import ai_heuristics


class StaffShiftAiTests(unittest.TestCase):
    def test_single_employee_selected_day(self):
        ctx = {
            "selected_date": "2026-05-20",
            "week_start": "2026-05-18",
            "week_end": "2026-05-24",
        }
        names = ["Marianna Rossi", "Luca Bianchi"]
        r = ai_heuristics.suggest_staff_shift("Marianna 8-16", names, ctx)
        shifts = r.get("suggested_shifts") or []
        self.assertEqual(len(shifts), 1)
        self.assertEqual(shifts[0]["work_date"], "2026-05-20")
        self.assertEqual(shifts[0]["time_start"], "08:00")
        self.assertEqual(shifts[0]["time_end"], "16:00")

    def test_tuesday_in_week(self):
        ctx = {
            "selected_date": "2026-05-18",
            "week_start": "2026-05-18",
            "week_end": "2026-05-24",
        }
        r = ai_heuristics.suggest_staff_shift("Luca martedì 9-17", ["Luca Bianchi"], ctx)
        shifts = r.get("suggested_shifts") or []
        self.assertEqual(len(shifts), 1)
        self.assertEqual(shifts[0]["work_date"], "2026-05-19")

    def test_all_staff_mon_fri(self):
        ctx = {
            "selected_date": "2026-05-18",
            "week_start": "2026-05-18",
            "week_end": "2026-05-24",
        }
        names = ["Anna Verdi", "Luca Bianchi"]
        r = ai_heuristics.suggest_staff_shift("tutti i dipendenti lunedì venerdì 8-16", names, ctx)
        shifts = r.get("suggested_shifts") or []
        self.assertEqual(len(shifts), 10)
        dates = {s["work_date"] for s in shifts}
        self.assertEqual(len(dates), 5)

    def test_service_uses_heuristics_without_ollama(self):
        import os

        os.environ["AI_PROVIDER"] = "heuristics"
        r = ai_service.suggest_staff_shift(
            "Marianna 8-16",
            ["Marianna Rossi"],
            {"selected_date": "2026-05-20", "week_start": "2026-05-18", "week_end": "2026-05-24"},
        )
        self.assertTrue(r.get("suggested_shifts"))

    def test_bulk_command_fast_path(self):
        self.assertTrue(
            ai_heuristics.is_staff_bulk_command("tutti i dipendenti lunedì venerdì 8-16")
        )
        ctx = {
            "selected_date": "2026-05-18",
            "week_start": "2026-05-18",
            "week_end": "2026-05-24",
        }
        names = ["Anna Verdi", "Luca Bianchi"]
        r = ai_service.suggest_staff_shift(
            "tutti i dipendenti lunedì venerdì 8-16", names, ctx
        )
        shifts = r.get("suggested_shifts") or []
        self.assertGreaterEqual(len(shifts), 10)
        if r.get("fast_path"):
            self.assertEqual(len(shifts), 10)


if __name__ == "__main__":
    unittest.main()
