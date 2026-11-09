"""Run: python pipeline/tests/test_mapping.py  (no pytest needed)"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from build_data import world_to_uv

def px(m, x, z):
    u, v = world_to_uv(m, x, z)
    return round(u * 1024), round((1 - v) * 1024)   # same flip as web/js/data.js

# Worked example from the dataset README: AmbroseValley (-301.45, -355.55) -> (78, 890)
assert px("AmbroseValley", -301.45, -355.55) == (78, 890), px("AmbroseValley", -301.45, -355.55)
# Origin corner maps to bottom-left of the image; origin+scale maps to top-right
assert px("Lockdown", -500, -500) == (0, 1024)
assert px("Lockdown", 500, 500) == (1024, 0)
assert px("GrandRift", -290 + 581 / 2, -290 + 581 / 2) == (512, 512)
print("coordinate mapping OK")
