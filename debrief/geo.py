import datetime as dt
import math

R_NM = 3440.065
FT_PER_NM = 6076.1


def hav(lat1, lon1, lat2, lon2):
    """Great-circle distance in nm."""
    a, b, c, d = map(math.radians, (lat1, lon1, lat2, lon2))
    h = math.sin((c - a) / 2) ** 2 + math.cos(a) * math.cos(c) * math.sin((d - b) / 2) ** 2
    return 2 * R_NM * math.asin(math.sqrt(h))


def bearing(lat1, lon1, lat2, lon2):
    a, b, c, d = map(math.radians, (lat1, lon1, lat2, lon2))
    y = math.sin(d - b) * math.cos(c)
    x = math.cos(a) * math.sin(c) - math.sin(a) * math.cos(c) * math.cos(d - b)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def angdiff(a, b):
    return (a - b + 540) % 360 - 180


def runway_frame(lat, lon, rwy):
    """Position relative to a runway threshold: (x, c) in nm.

    x > 0 is before the threshold on the approach side; c is right of course.
    """
    d = hav(rwy["lat"], rwy["lon"], lat, lon)
    b = bearing(rwy["lat"], rwy["lon"], lat, lon)
    a = math.radians(b - rwy["hdg"])
    return -d * math.cos(a), d * math.sin(a)


def utc(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc)


def sun_elevation(ts, lat, lon):
    """Approximate solar elevation in degrees (good to ~1 degree)."""
    n = (ts - 946728000) / 86400  # days since J2000.0
    L = (280.46 + 0.9856474 * n) % 360
    g = math.radians((357.528 + 0.9856003 * n) % 360)
    lam = math.radians(L + 1.915 * math.sin(g) + 0.02 * math.sin(2 * g))
    eps = math.radians(23.439 - 4e-7 * n)
    dec = math.asin(math.sin(eps) * math.sin(lam))
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    gmst = (280.46061837 + 360.98564736629 * n) % 360
    ha = math.radians(gmst + lon) - ra
    la = math.radians(lat)
    return math.degrees(math.asin(math.sin(la) * math.sin(dec) + math.cos(la) * math.cos(dec) * math.cos(ha)))
