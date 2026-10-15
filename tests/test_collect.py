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


class Subscribers(unittest.TestCase):
    def test_parse(self):
        from debrief.notify import parse_subscribers
        s = parse_subscribers("n31sf:84=a@x.com, b@y.com;\nN2=c@z.com; junk")
        self.assertEqual(s[0], {"tail": "N31SF", "vref": 84, "to": ["a@x.com", "b@y.com"]})
        self.assertEqual(s[1], {"tail": "N2", "vref": None, "to": ["c@z.com"]})
        self.assertEqual(len(s), 2)


class AfterGoAround(unittest.TestCase):
    def test_link(self):
        rec = {"landings": {"l1": {"t": 1000 + 600, "apt": "KASH"}, "l2": {"t": 9000, "apt": "KMHT"}},
               "go_arounds": {"g1": {"t": 1000, "apt": "KASH"}, "g2": {"t": 8000, "apt": "KASH"}, "g3": {"t": 50000, "apt": "KASH"}}}
        a = collect.link_after(rec)
        self.assertEqual(a["g1"], {"kind": "landed", "id": "l1", "min": 10})
        self.assertEqual(a["g2"]["kind"], "diverted")
        self.assertEqual(a["g3"], {"kind": "unseen"})


if __name__ == "__main__":
    unittest.main()
