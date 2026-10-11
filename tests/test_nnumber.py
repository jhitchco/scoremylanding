import unittest

from debrief.nnumber import is_valid, n_to_icao, resolve


class NNumber(unittest.TestCase):
    def test_known_codes(self):
        cases = {"N1": "a00001", "N1A": "a00002", "N1AA": "a00003", "N31SF": "a3460e", "N99999": "adf7c7"}
        for tail, hex_ in cases.items():
            self.assertEqual(n_to_icao(tail), hex_, tail)

    def test_unique_and_in_range(self):
        seen = set()
        for n in ["N1", "N12", "N123", "N1234", "N12345", "N1234Z", "N123AB", "N12AB", "N1AB"]:
            if not is_valid(n):
                continue
            h = int(n_to_icao(n), 16)
            self.assertTrue(0xA00001 <= h <= 0xADF7C7)
            self.assertNotIn(h, seen)
            seen.add(h)

    def test_invalid(self):
        for bad in ["N0", "N1I", "N1O", "N123456", "NABC", "N1A2"]:
            self.assertFalse(is_valid(bad), bad)

    def test_resolve(self):
        self.assertEqual(resolve("a3460e"), "a3460e")
        self.assertEqual(resolve("31sf"), "a3460e")
        self.assertEqual(resolve(" n31sf "), "a3460e")


if __name__ == "__main__":
    unittest.main()
