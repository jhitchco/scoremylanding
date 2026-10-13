"""Pseudonyms and owner-only encryption for the public site.

Every aircraft is published under a keyed pseudonym such as sf50-7c3a9e12. It is an
HMAC of the ICAO address with a secret, not a plain hash: there are only a few hundred
tails per type, so an unkeyed MD5 or SHA of the tail could be reversed by hashing them all.

Details that identify an aircraft (tail, ICAO address, owner, exact times, raw METARs,
and airports for LADD/PIA aircraft) go into AES-256-GCM blobs that only the secret
opens. The site decrypts them in the browser once the owner enters the secret.

The secret comes from the SML_SECRET environment variable (a GitHub Actions secret).
"""

import base64
import gzip
import hashlib
import hmac
import json
import os

LADD = 8
PIA = 4


def secret():
    s = os.environ.get("SML_SECRET")
    if not s:
        raise SystemExit("SML_SECRET is not set")
    return s.strip().encode()


def _mac(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def pseudonym(key, hex_, type_code="ac"):
    return f"{(type_code or 'ac').lower()}-{_mac(key, 'pid:' + hex_.lower()).hex()[:8]}"


def landing_id(key, hex_, t):
    return _mac(key, f"lid:{hex_.lower()}:{int(t)}").hex()[:10]


def enc_key(key):
    return _mac(key, "enc")


def seal(key, obj):
    """gzip'd JSON under AES-256-GCM. Output: base64(12-byte nonce + ciphertext + tag).
    The site opens it with WebCrypto plus DecompressionStream('gzip')."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    raw = gzip.compress(json.dumps(obj, separators=(",", ":")).encode(), mtime=0)
    nonce = os.urandom(12)
    return base64.b64encode(nonce + AESGCM(enc_key(key)).encrypt(nonce, raw, None)).decode()


def unseal(key, blob):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    raw = base64.b64decode(blob)
    return json.loads(gzip.decompress(AESGCM(enc_key(key)).decrypt(raw[:12], raw[12:], None)))


def restricted(db_flags):
    """LADD or PIA aircraft: their owners asked not to be tracked publicly."""
    return bool((db_flags or 0) & (LADD | PIA))
