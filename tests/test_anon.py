import unittest

from debrief import anon


class Anon(unittest.TestCase):
    key = b"unit-test-secret"

    def test_pseudonym_is_stable_and_keyed(self):
        a = anon.pseudonym(self.key, "a3460e", "SF50")
        self.assertEqual(a, anon.pseudonym(self.key, "A3460E", "SF50"))
        self.assertRegex(a, r"^sf50-[0-9a-f]{8}$")
        self.assertNotEqual(a, anon.pseudonym(b"other", "a3460e", "SF50"))
        self.assertNotIn("a3460e", a)

    def test_seal_roundtrip(self):
        obj = {"tail": "N31SF", "n": [1, 2, 3]}
        blob = anon.seal(self.key, obj)
        self.assertNotIn("N31SF", blob)
        self.assertEqual(anon.unseal(self.key, blob), obj)
        with self.assertRaises(Exception):
            anon.unseal(b"wrong", blob)

    def test_restricted_flags(self):
        self.assertTrue(anon.restricted(8))
        self.assertTrue(anon.restricted(4))
        self.assertFalse(anon.restricted(0))
        self.assertFalse(anon.restricted(None))


if __name__ == "__main__":
    unittest.main()
