#!/usr/bin/env python3
"""Pick Tentacles radii by measurement.

The number that matters is how many candidates survive one answer, averaged
over what the answer might be: sum(bucket^2)/N. A balanced yes/no question
leaves 50% of the map standing, so Tentacles wants to sit a little under that
-- stronger than any other question, which is what its 4-draw/2-keep price is
buying, but nowhere near a solve.

    python3 tools/tune_tentacles.py brno
"""
import sys, os, json, math, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osmlib import haversine

TARGET_LO, TARGET_HI = 0.42, 0.62
RADII = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50]


def main(map_id):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", f"{map_id}.json")
    d = json.load(open(path, encoding="utf-8"))
    stations, pois, n = d["stations"], d["pois"], len(d["stations"])

    print(f"{map_id}: {n} stations. Expected share of the map still standing "
          f"after one answer; aim for {TARGET_LO:.0%}-{TARGET_HI:.0%}.\n")
    picks = []
    for cat, lst in sorted(pois.items()):
        if len(lst) < 2:
            print(f"  {cat:11s} only {len(lst)} on this map, skipped")
            continue
        near = [min((haversine(s["lat"], s["lon"], p["lat"], p["lon"]), p["name"]) for p in lst)
                for s in stations]
        row, best = [], None
        for r in RADII:
            counts = collections.Counter(name if km <= r else None for km, name in near)
            share = sum(c * c for c in counts.values()) / n / n
            row.append((r, share))
            if TARGET_LO <= share <= TARGET_HI and (best is None or abs(share - 0.5) < abs(best[1] - 0.5)):
                best = (r, share)
        shown = " ".join(f"{r:g}km:{s:.0%}" for r, s in row if 0.2 < s < 0.9)
        print(f"  {cat:11s} {shown}")
        if best:
            picks.append((cat, best[0], best[1]))
    print("\nsuggested:")
    for cat, r, share in sorted(picks, key=lambda x: x[1]):
        print(f'    {{ cat: "{cat}", km: {r:g}, label: "..." }},   // leaves {share:.0%}')


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "south-moravia")
