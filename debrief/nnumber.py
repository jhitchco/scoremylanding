"""US N-number <-> ICAO 24-bit address.

The FAA assigns US Mode S codes A00001..ADF7C7 in a fixed order, so the
mapping is pure arithmetic and needs no registry lookup.
"""

CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ"  # no I or O
DIGITS = "0123456789"
ICAO_OFFSET = 0xA00001

SUFFIX_SIZE = 1 + len(CHARSET) * (1 + len(CHARSET))  # 601
BUCKET4_SIZE = 1 + len(CHARSET) + len(DIGITS)  # 35
BUCKET3_SIZE = len(DIGITS) * BUCKET4_SIZE + SUFFIX_SIZE  # 951
BUCKET2_SIZE = len(DIGITS) * BUCKET3_SIZE + SUFFIX_SIZE  # 10111
BUCKET1_SIZE = len(DIGITS) * BUCKET2_SIZE + SUFFIX_SIZE  # 101711


def _suffix_offset(s: str) -> int:
    """Offset of a one or two letter suffix within a suffix block."""
    if not s:
        return 0
    count = (len(CHARSET) + 1) * CHARSET.index(s[0]) + 1
    if len(s) == 2:
        count += CHARSET.index(s[1]) + 1
    return count


def normalize(tail: str) -> str:
    t = tail.strip().upper().replace("-", "").replace(" ", "")
    if not t.startswith("N"):
        t = "N" + t
    return t


def is_valid(tail: str) -> bool:
    n = normalize(tail)[1:]
    if not 1 <= len(n) <= 5 or n[0] not in "123456789":
        return False
    letters = False
    for i, ch in enumerate(n):
        if ch in CHARSET:
            letters = True
        elif ch in DIGITS:
            if letters:
                return False  # digits cannot follow letters
        else:
            return False
    # at most two trailing letters
    tail_letters = len(n) - len(n.rstrip(CHARSET))
    return tail_letters <= 2


def n_to_icao(tail: str) -> str:
    """'N31SF' -> 'a3460e'. Raises ValueError for an invalid N-number."""
    if not is_valid(tail):
        raise ValueError(f"not a valid US N-number: {tail!r}")
    n = normalize(tail)[1:]
    out = ICAO_OFFSET + (int(n[0]) - 1) * BUCKET1_SIZE
    sizes = [BUCKET2_SIZE, BUCKET3_SIZE, BUCKET4_SIZE]
    for pos in range(1, len(n)):
        ch = n[pos]
        if pos == 4:  # last position: one letter or one digit
            if ch in CHARSET:
                out += CHARSET.index(ch) + 1
            else:
                out += 1 + len(CHARSET) + int(ch)
            break
        if ch in CHARSET:
            out += _suffix_offset(n[pos:])
            break
        out += SUFFIX_SIZE + int(ch) * sizes[pos - 1]
    return f"{out:06x}"


def resolve(query: str) -> str:
    """Accept an N-number or a raw 6-hex ICAO address; return lowercase hex."""
    q = query.strip().lower().lstrip("~")
    if len(q) == 6 and all(c in "0123456789abcdef" for c in q) and not q.startswith("n"):
        return q
    return n_to_icao(query)
