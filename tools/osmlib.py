"""Shared OpenStreetMap fetching and geometry helpers for the map builds."""
import json, math, time, urllib.request, urllib.parse, collections
from overpass import query

R_EARTH = 6371.0088

# POI categories used as Matching, Measuring and Tentacles targets. Kept to
# things that are distinctive and present across the region.
POI_CATS = {
    "museum":     ['["tourism"="museum"]'],
    "hospital":   ['["amenity"="hospital"]'],
    "library":    ['["amenity"="library"]'],
    "cinema":     ['["amenity"="cinema"]'],
    "castle":     ['["historic"~"^(castle|chateau|manor)$"]'],
    "brewery":    ['["craft"="brewery"]', '["microbrewery"="yes"]', '["building"="brewery"]'],
    "zoo":        ['["tourism"="zoo"]'],
    "aerodrome":  ['["aeroway"="aerodrome"]'],
    "university": ['["amenity"="university"]'],
    "theme_park": ['["tourism"="theme_park"]'],
}


def area_filter(level, name):
    """An Overpass statement binding .a to one administrative area."""
    return (f'area["boundary"="administrative"]["admin_level"="{level}"]'
            f'["name"="{name}"]->.a;')


def haversine(a_lat, a_lon, b_lat, b_lon):
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = p2 - p1
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(h))


class Grid:
    """Coarse lat/lon bucket index, for 'what is near this point' lookups
    without going quadratic over tens of thousands of points."""

    def __init__(self, cell_km=0.5):
        self.cell = cell_km / 111.0
        self.buckets = collections.defaultdict(list)

    def add(self, lat, lon, payload):
        self.buckets[(int(lat / self.cell), int(lon / self.cell))].append((lat, lon, payload))

    def near(self, lat, lon, km):
        span = max(1, int(math.ceil((km / 111.0) / self.cell)))
        cy, cx = int(lat / self.cell), int(lon / self.cell)
        for dy in range(-span, span + 1):
            for dx in range(-span, span + 1):
                for plat, plon, payload in self.buckets.get((cy + dy, cx + dx), []):
                    d = haversine(lat, lon, plat, plon)
                    if d <= km:
                        yield d, payload


# ------------------------------------------------------------ boundaries

def assemble_rings(segments):
    """Join way segments end-to-end into closed rings; boundary relations
    arrive as an unordered soup of ways."""
    segs = [list(s) for s in segments if len(s) > 1]
    rings = []
    while segs:
        cur = segs.pop()
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]; segs.pop(i); changed = True; break
                if s[-1] == cur[-1]:
                    cur += s[::-1][1:]; segs.pop(i); changed = True; break
                if s[-1] == cur[0]:
                    cur = s[:-1] + cur; segs.pop(i); changed = True; break
                if s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur; segs.pop(i); changed = True; break
        if len(cur) > 3:
            rings.append(cur)
    return rings


def point_in_rings(lat, lon, rings):
    inside = False
    for ring in rings:
        for i in range(len(ring) - 1):
            y1, x1 = ring[i]
            y2, x2 = ring[i + 1]
            if (y1 > lat) != (y2 > lat):
                if lon < x1 + (lat - y1) / (y2 - y1) * (x2 - x1):
                    inside = not inside
    return inside


def fetch_boundaries(area, level, tag):
    """Administrative areas at one level, as outer rings."""
    r = query(f'[out:json][timeout:300];{area}'
              f'rel(area.a)["boundary"="administrative"]["admin_level"="{level}"];out geom;', tag)
    out = []
    for e in r["elements"]:
        name = e.get("tags", {}).get("name")
        if not name:
            continue
        segs = [[(p["lat"], p["lon"]) for p in m["geometry"]]
                for m in e.get("members", [])
                if m["type"] == "way" and m.get("role") in ("outer", "") and m.get("geometry")]
        rings = assemble_rings(segs)
        if rings:
            out.append({"name": name, "rings": rings})
    return out


# ----------------------------------------------------------------- places

def fetch_places(area, tag, types="city|town|village"):
    """Named settlements, used to give each station a locality and population.

    A city map has to ask for suburbs and quarters instead: Brno contains no
    place=city|town|village node of its own, so the regional query returns
    nothing and every station ends up with a null municipality."""
    r = query(f'[out:json][timeout:200];{area}'
              f'(node(area.a)["place"~"^({types})$"];);out body;', tag)
    out = []
    for e in r["elements"]:
        t = e["tags"]
        if not t.get("name"):
            continue
        try:
            pop = int(str(t.get("population", "0")).replace(" ", "").replace(" ", ""))
        except ValueError:
            pop = 0
        out.append({"name": t["name"], "lat": e["lat"], "lon": e["lon"], "population": pop})
    return out


def fetch_pois(area, tag_prefix):
    pois = {}
    for cat, filters in POI_CATS.items():
        parts = "".join(f"node(area.a){f};way(area.a){f};" for f in filters)
        r = query(f'[out:json][timeout:300];{area}({parts});out center;', f"{tag_prefix}_poi_{cat}")
        seen, lst = set(), []
        for e in r["elements"]:
            t = e.get("tags", {})
            name = t.get("name")
            if not name or name in seen:
                continue
            lat = e.get("lat") or (e.get("center") or {}).get("lat")
            lon = e.get("lon") or (e.get("center") or {}).get("lon")
            if lat is None:
                continue
            seen.add(name)
            lst.append({"name": name, "lat": round(lat, 5), "lon": round(lon, 5)})
        pois[cat] = lst
        print(f"  {cat}: {len(lst)}")
    return pois


# -------------------------------------------------------------- elevation

def fetch_elevation(points):
    """SRTM 30m via OpenTopoData: 100 points per request, one request a second."""
    out = []
    for i in range(0, len(points), 100):
        chunk = points[i:i + 100]
        locs = "|".join(f"{la:.5f},{lo:.5f}" for la, lo in chunk)
        url = "https://api.opentopodata.org/v1/srtm30m?locations=" + urllib.parse.quote(locs, safe="|,")
        for attempt in range(4):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    out += [x["elevation"] for x in json.load(r)["results"]]
                break
            except Exception as e:
                print(f"  elevation chunk {i} retry ({e})")
                time.sleep(5 * (attempt + 1))
        else:
            out += [None] * len(chunk)
        time.sleep(1.2)
    return out


def fetch_rivers(bbox, tag, also=()):
    """Named rivers, as a name -> list of vertices map.

    Queried by bounding box rather than by administrative area: pulling full
    geometry for every named river inside an `area` filter times Overpass out
    (504) on a region this size, while the same request over a bbox returns
    fine.

    Rivers are the one target that is genuinely geographic: unlike a village
    museum, everyone can place the Svratka or the Dyje, and 'which river are
    you nearest to' carves the map into basins rather than into arbitrary
    little cells. Names arrive bilingually along the Austrian and Slovak
    border ("Thaya / Dyje", "March / Morava"), so name:cs wins where present
    and otherwise the first half before the slash is taken.

    `also` names watercourses to keep that OSM does not tag as rivers. This
    cannot be done by widening the query to waterway=stream: inside Brno's
    bounding box that is 40-odd named potoky, and "which stream are you
    nearest to" is the village-museum problem all over again. The Ponavka is
    the case that matters -- a stream by OSM's classification, culverted for
    much of its run through the centre, but one of the three watercourses a
    Brno player actually names -- so it is listed explicitly instead."""
    bb = "%f,%f,%f,%f" % bbox
    kinds = "river" if not also else "river|stream|canal"
    r = query(f'[out:json][timeout:900];'
              f'way["waterway"~"^({kinds})$"]["name"]({bb});out geom;', tag)
    rivers = collections.defaultdict(list)
    for e in r["elements"]:
        t = e.get("tags", {})
        name = t.get("name:cs") or t["name"].split(" / ")[0].strip()
        if t.get("waterway") != "river" and name not in also:
            continue
        for p in e.get("geometry", []):
            rivers[name].append((p["lat"], p["lon"]))
    return dict(rivers)


def nearest_river(stations, rivers, max_km=60.0, min_stops=0):
    """Per-station nearest river name and distance.

    Distance is measured to the nearest digitised vertex rather than to the
    nearest point on the segment. River geometry in OSM has vertices every few
    tens of metres, so the two agree far more closely than the question needs.

    Rivers that end up as the answer for fewer than `min_stops` stations are
    dropped and those stations reassigned to their next nearest, repeatedly
    until every surviving river is a real answer. The query runs over a padded
    bounding box, so a map catches the edge of whatever flows past outside it:
    Brno's rivers came out as Svratka 245, Svitava 197, Ponavka 97 -- and
    Litava 2, which is not a question, it is a coin landing on its edge.
    Either the map has three rivers or it has two; what it must not have is a
    long tail of answers that name two stops each.

    It is off by default (0). The region map has not had its question pass yet
    and its river set is deliberately left as it was -- it would lose twelve
    names to this, which is a decision for that pass and not a side effect of
    Brno's."""
    kept = dict(rivers)
    while True:
        grid = Grid(1.0)
        for name, pts in kept.items():
            for la, lo in pts:
                grid.add(la, lo, name)
        names, kms = [], []
        for st in stations:
            best, bestd = None, None
            radius = 2.0
            while best is None and radius <= max_km:
                hit = min(grid.near(st["lat"], st["lon"], radius), default=None)
                if hit:
                    bestd, best = hit
                radius *= 3
            names.append(best)
            kms.append(round(bestd, 3) if bestd is not None else None)

        counts = collections.Counter(n for n in names if n)
        rare = [n for n, c in counts.items() if c < min_stops]
        # Never strip the map down to a single answer: a question with one
        # possible answer tells the seeker nothing at all.
        if not rare or len(counts) - len(rare) < 2:
            return {"name": names, "km": kms}
        for n in rare:
            print(f"  dropping {n}: nearest for only {counts[n]} station(s)")
            kept.pop(n, None)


def attach_context(stations, places, districts, elevation=True):
    """Give every station its municipality, district and elevation."""
    for st in stations:
        best, bestd = None, 1e9
        for p in places:
            d = haversine(st["lat"], st["lon"], p["lat"], p["lon"])
            if d < bestd:
                best, bestd = p, d
        st["municipality"] = best["name"] if best else None
        st["population"] = best["population"] if best else 0
        st["district"] = next((d["name"] for d in districts
                               if point_in_rings(st["lat"], st["lon"], d["rings"])), None)
    if elevation:
        print("fetching elevation...")
        for st, e in zip(stations, fetch_elevation([(s["lat"], s["lon"]) for s in stations])):
            st["ele"] = e
