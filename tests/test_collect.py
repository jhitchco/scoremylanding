import datetime as dt
import unittest

from debrief import collect


class DaysToDo(unittest.TestCase):
    def test_new_days_first_then_stale_newest_first(self):
        today = dt.datetime.now(dt.timezone.utc).date()
        day = lambda n: str(today - dt.timedelta(days=n))
        v = collect.ANALYSIS_VERSION
        done = {day(1): {"v": v}, day(2): {}, day(3): {"v": v - 1}, day(5): {"v": v}}
        todo = [str(d) for d in collect._days_to_do(done, today - dt.timedelta(days=5), 3)]
        self.assertEqual(todo, [day(4), day(2), day(3)])

    def test_priority_extends_budget(self):
        today = dt.datetime.now(dt.timezone.utc).date()
        p = [today - dt.timedelta(days=30)]
        todo = collect._days_to_do({}, today - dt.timedelta(days=3), 2, p)
        self.assertEqual(todo[0], p[0])
        self.assertEqual(len(todo), 3)


if __name__ == "__main__":
    unittest.main()
