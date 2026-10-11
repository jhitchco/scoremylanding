"""Default reference speeds by ICAO type designator.

Approximate published figures meant as a starting point. Every pilot should set
the slider to their own AFM/POH Vref for their usual landing weight.
weights: (light_lb, heavy_lb) paired with vref (light_kias, heavy_kias).
"""

TYPES = {
    "SF50": {"vref": (76, 89), "weights": (4500, 6000), "default": 81,
             "drag_tip": "With no speed brakes, use early gear extension as the drag device when ATC keeps you fast"},
    "SR22": {"vref": (74, 82), "default": 78},
    "S22T": {"vref": (74, 82), "default": 78},
    "SR20": {"vref": (70, 78), "default": 75},
    "C172": {"vref": (58, 66), "default": 62},
    "C182": {"vref": (60, 70), "default": 65},
    "P28A": {"vref": (60, 68), "default": 64},
    "BE36": {"vref": (70, 80), "default": 75},
    "TBM9": {"vref": (78, 90), "default": 85},
    "TBM8": {"vref": (78, 90), "default": 85},
    "TBM7": {"vref": (78, 90), "default": 85},
    "PC12": {"vref": (78, 95), "default": 85},
    "EA50": {"vref": (80, 95), "default": 88},
    "C510": {"vref": (85, 100), "default": 92},
    "C525": {"vref": (95, 110), "default": 102},
    "C25A": {"vref": (95, 112), "default": 105},
    "C25B": {"vref": (95, 115), "default": 108},
    "BE20": {"vref": (95, 110), "default": 102},
    "PC24": {"vref": (90, 110), "default": 100},
}

GENERIC = {"vref": (55, 140), "default": 80}


def info(type_code):
    d = dict(TYPES.get((type_code or "").upper(), GENERIC))
    d["known"] = (type_code or "").upper() in TYPES
    return d
