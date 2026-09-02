#!/usr/bin/env python3
"""Survey candidate POI categories for a map, and score them as questions.

Counting OSM objects is not enough to decide whether something makes a good
question. Only *named* features can be used (Tentacles has to name its answer),
and a category is only worth adding if it actually splits the map. So for each
candidate this reports:

  named     how many named features exist
  cells     how many distinct "nearest one" answers the stops produce
  match     share of the map still standing after "is your nearest X the same
            as mine?" -- 100% means the question tells you nothing
  tent@r    the best Tentacles radius, and the share still standing there

    python3 tools/survey_pois.py brno
"""
import sys, os, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from overpass import query
from osmlib import area_filter, haversine

CANDS = {
 "park":            ['["leisure"="park"]'],
 "place_of_worship":['["amenity"="place_of_worship"]'],
 "cemetery":        ['["amenity"="grave_yard"]', '["landuse"="cemetery"]'],
 "viewpoint":       ['["tourism"="viewpoint"]'],
 "peak":            ['["natural"="peak"]'],
 "spring":          ['["natural"="spring"]'],
 "nature_reserve":  ['["leisure"="nature_reserve"]'],
 "hotel":           ['["tourism"="hotel"]'],
 "supermarket":     ['["shop"="supermarket"]'],
 "mall":            ['["shop"="mall"]'],
 "pharmacy":        ['["amenity"="pharmacy"]'],
 "post_office":     ['["amenity"="post_office"]'],
 "theatre":         ['["amenity"="theatre"]'],
 "school":          ['["amenity"="school"]'],
 "college":         ['["amenity"="college"]'],
 "townhall":        ['["amenity"="townhall"]'],
 "police":          ['["amenity"="police"]'],
 "fire_station":    ['["amenity"="fire_station"]'],
 "fuel":            ['["amenity"="fuel"]'],
 "marketplace":     ['["amenity"="marketplace"]'],
 "sports_centre":   ['["leisure"="sports_centre"]'],
 "stadium":         ['["leisure"="stadium"]'],
 "water_park":      ['["leisure"="water_park"]'],
 "golf_course":     ['["leisure"="golf_course"]'],
 "gallery":         ['["tourism"="gallery"]'],
 "attraction":      ['["tourism"="attraction"]'],
 "camp_site":       ['["tourism"="camp_site"]'],
 "monument":        ['["historic"="monument"]', '["historic"="memorial"]'],
 "ruins":           ['["historic"="ruins"]', '["historic"="archaeological_site"]'],
 "lookout_tower":   ['["man_made"="tower"]["tower:type"="observation"]'],
 "water_tower":     ['["man_made"="water_tower"]'],
 "windmill":        ['["man_made"="windmill"]'],
 "winery":          ['["craft"="winery"]', '["craft"="wine"]'],
 "cave":            ['["natural"="cave_entrance"]'],
 "power_plant":     ['["power"="plant"]'],
 "reservoir":       ['["landuse"="reservoir"]'],
}

AREAS = {"south-moravia": ("4", "Jihomoravský kraj"), "brno": ("8", "Brno")}
RADII = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30]


def fetch(map_id, cat):
    """One query per candidate category, named features only.

    Requiring a name cuts the volume enormously -- South Moravia has 9,350
    vineyard polygons and almost none are named -- and named is the only set
    usable anyway, since Tentacles has to say its answer out loud. Asking for
    every category in one request reads better but times Overpass out; one
    small cached request each is slower to run once and reliable after."""
    area = area_filter(*AREAS[map_id])
    sel = "".join(f'node(area.a){f}["name"];way(area.a){f}["name"];relation(area.a){f}["name"];'
                  for f in CANDS[cat])
    r = query(f'[out:json][timeout:300];{area}({sel});out center tags;', f"survey_{map_id}_{cat}")
    return r["elements"]


def main(map_id):
    data = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                       "..", "data", f"{map_id}.json"), encoding="utf-8"))
    stations, n = data["stations"], len(data["stations"])
    buckets = collections.defaultdict(list)
    for cat in CANDS:
        for el in fetch(map_id, cat):
            lat = el.get("lat") or (el.get("center") or {}).get("lat")
            lon = el.get("lon") or (el.get("center") or {}).get("lon")
            name = el.get("tags", {}).get("name")
            if lat is not None and name:
                buckets[cat].append({"name": name, "lat": lat, "lon": lon})

    print(f"{map_id}: {n} stops\n")
    print(f"{'category':<18s}{'named':>6s}{'cells':>7s}{'match':>8s}   best tentacles")
    rows = []
    for cat in CANDS:
        pois = {p["name"]: p for p in buckets.get(cat, [])}.values()
        pois = list(pois)
        if len(pois) < 2:
            rows.append((cat, len(pois), 0, 1.0, None, None))
            continue
        near = [min((haversine(s["lat"], s["lon"], p["lat"], p["lon"]), p["name"]) for p in pois)
                for s in stations]
        cells = collections.Counter(nm for _, nm in near)
        # "Is your nearest X the same as mine?" -- averaged over where the
        # seeker happens to be standing.
        match = sum((c / n) * ((c * c + (n - c) * (n - c)) / (n * n)) for c in cells.values())
        best = None
        for r in RADII:
            cnt = collections.Counter(nm if km <= r else None for km, nm in near)
            share = sum(c * c for c in cnt.values()) / n / n
            if 0.40 <= share <= 0.65 and (best is None or abs(share - 0.5) < abs(best[1] - 0.5)):
                best = (r, share)
        rows.append((cat, len(pois), len(cells), match, best[0] if best else None,
                     best[1] if best else None))
    for cat, cnt, cells, match, r, share in sorted(rows, key=lambda x: -x[1]):
        tent = f"{r:g} km -> {share:.0%}" if r else "-"
        print(f"  {cat:<16s}{cnt:>6d}{cells:>7d}{match:>7.0%}   {tent}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "south-moravia")
