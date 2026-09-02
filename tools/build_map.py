#!/usr/bin/env python3
"""Build a playable map from OpenStreetMap + SRTM elevation.

    python3 tools/build_map.py south-moravia
    python3 tools/build_map.py brno
    python3 tools/build_map.py all

Two kinds of map, because the two networks are mapped very differently in OSM:

  rail  Regional trains. Route relations here list barely any stops (a median
        of two per line), so the transit graph is derived geometrically from
        the raw track network instead. Line membership is recovered afterwards
        by matching stations against each route's track geometry.

  pt    Urban trams, trolleybuses and buses. Here the route relations are
        excellent -- full ordered stop lists -- so the graph and the line
        membership both come straight out of them.

Both produce the same output schema, so the game does not care which it loaded.
"""
import sys, os, json, math, heapq, collections, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from overpass import query
from osmlib import (area_filter, haversine, Grid, fetch_boundaries, fetch_places,
                    fetch_pois, attach_context, fetch_rivers, nearest_river)

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

MAPS = {
    "south-moravia": {
        "name": "South Moravia",
        "blurb": "the whole region, by train",
        "kind": "rail",
        "area": ("4", "Jihomoravský kraj"),
        # Buffered past the region so lines are not clipped mid-run.
        "bbox": (48.30, 15.50, 49.75, 17.70),
        "district_level": "6",
        "center": [49.1951, 16.6068],
        "default_speed": 70.0,
        "dwell": 1.5,
    },
    "brno": {
        "name": "Brno",
        "blurb": "the city, by tram, trolleybus and bus",
        "kind": "pt",
        "area": ("8", "Brno"),
        "district_level": "9",          # mestske casti
        "center": [49.1951, 16.6068],
        "modes": {"tram": 24.0, "trolleybus": 22.0, "bus": 21.0},
        # No place_types: the only settlement inside Brno is Brno. Suburb and
        # quarter nodes exist, but they are katastralni uzemi -- a finer split
        # than the 29 mestske casti that adds nothing as a question, so the
        # district level is left to do that job alone.
        "dwell": 0.4,
        "merge_km": 0.35,               # stops this close sharing a name are one station
        # Night services are dropped. The round opens at 08:00 and every
        # headway in the timetable is a daytime one, so carrying N89-N99 put
        # lines on the departure board that do not run at the hour the game is
        # played -- and left three stops, Achtelky, Jundrovska and Zvonarka,
        # reachable only by a bus that comes after midnight.
        "skip_lines": r"^N\d+$",
        # Watercourses OSM does not tag waterway=river, kept by name. See
        # fetch_rivers: widening the query to streams would bury the question
        # under 40 potoky, but the Ponavka is one of the three watercourses a
        # Brno player can actually name.
        "extra_waterways": ["Ponávka"],
        # Drop any river that ends up nearest to fewer stops than this and
        # reassign them, so the answer set is three real rivers rather than
        # three plus a Litava that names two stops. See nearest_river.
        "min_river_stops": 8,
    },
}


# ============================================================ rail networks

def fetch_rail_stations(area):
    r = query(f'[out:json][timeout:180];{area}'
              f'(node(area.a)["railway"~"^(station|halt)$"];);out body;', "stations")
    out = []
    for e in r["elements"]:
        t = e["tags"]
        if not t.get("name") or t.get("usage") == "industrial" or t.get("station") == "subway":
            continue
        out.append({"osm": e["id"], "name": t["name"], "lat": e["lat"], "lon": e["lon"],
                    "kind": t.get("railway")})
    return out


def fetch_rail_ways(bbox):
    """Rail ways with geometry over the buffered bbox.

    Deliberately does NOT filter on `service`: in large junction stations
    (Breclav, Boskovice) the through-running tracks carry service tags, and
    excluding them severs the corridor -- Brno-Breclav came out at 159 minutes
    instead of 35. Yard tracks slipping in is harmless, since they are short
    and confined to station areas."""
    bb = "%f,%f,%f,%f" % bbox
    r = query(f'[out:json][timeout:900];'
              f'way["railway"~"^(rail|light_rail|narrow_gauge)$"]'
              f'["usage"!~"^(industrial|military|test)$"]({bb});out geom;', "rail_open")
    return [e for e in r["elements"] if e.get("geometry")]


def build_rail_graph(ways):
    """Node-level graph keyed by OSM node id, edges weighted in km."""
    adj = collections.defaultdict(list)
    coords = {}
    for w in ways:
        nds, geom = w.get("nodes"), w["geometry"]
        if not nds or len(nds) != len(geom):
            continue
        try:
            speed = float(str(w.get("tags", {}).get("maxspeed", "")).split()[0])
        except (ValueError, IndexError):
            speed = 0
        for i in range(len(nds) - 1):
            a, b = nds[i], nds[i + 1]
            coords[a] = (geom[i]["lat"], geom[i]["lon"])
            coords[b] = (geom[i + 1]["lat"], geom[i + 1]["lon"])
            d = haversine(*coords[a], *coords[b])
            if d > 0:
                adj[a].append((b, d, speed))
                adj[b].append((a, d, speed))
    return adj, coords


def heal_gaps(adj, coords, max_km=0.6):
    """OSM rail data has occasional short breaks (a missing way through a
    station throat, a segment clipped at a data boundary). Left alone these
    turn a 2 km hop into a 230 km detour. We repair them conservatively: only
    *dangling ends* -- nodes with a single rail neighbour -- may be bridged,
    and only to a node in a different connected component within max_km. That
    heals real breaks without fusing parallel lines."""
    def components():
        seen, comp, cid = set(), {}, 0
        for start in list(adj):
            if start in seen:
                continue
            stack = [start]; seen.add(start)
            while stack:
                n = stack.pop(); comp[n] = cid
                for nb, _, _ in adj[n]:
                    if nb not in seen:
                        seen.add(nb); stack.append(nb)
            cid += 1
        return comp, cid

    added = 0
    for _ in range(4):
        comp, ncomp = components()
        if ncomp <= 1:
            break
        grid = Grid(max_km)
        for nid, (la, lo) in coords.items():
            grid.add(la, lo, nid)
        joins = []
        for n in [n for n in adj if len(adj[n]) == 1]:
            la, lo = coords[n]
            best, bestd = None, max_km
            for d, m in grid.near(la, lo, max_km):
                if comp.get(m) != comp[n] and d < bestd:
                    best, bestd = m, d
            if best is not None:
                joins.append((bestd, n, best))
        if not joins:
            break
        joins.sort()
        merged = set()
        for d, n, m in joins:
            if comp[n] in merged or comp[m] in merged:
                continue
            adj[n].append((m, d, 0)); adj[m].append((n, d, 0))
            merged.add(comp[n]); merged.add(comp[m]); added += 1
        if not merged:
            break
    print(f"  healed {added} network gaps")
    return adj


def snap_stations(stations, coords):
    grid = Grid(0.5)
    for nid, (la, lo) in coords.items():
        grid.add(la, lo, nid)
    snapped = {}
    for idx, st in enumerate(stations):
        best = min(grid.near(st["lat"], st["lon"], 1.0), default=None)
        if best:
            snapped[idx] = (best[1], best[0])
    return snapped


def rail_adjacency(adj, snapped):
    """Multi-source Dijkstra from every station at once. Where two stations'
    territories touch, they are consecutive stops."""
    dist, owner = {}, {}
    pq = []
    for idx, (nid, off) in snapped.items():
        if nid not in dist or off < dist[nid]:
            dist[nid], owner[nid] = off, idx
            heapq.heappush(pq, (off, nid, idx))
    while pq:
        d, nid, own = heapq.heappop(pq)
        if d > dist.get(nid, 1e18) + 1e-9 or owner.get(nid) != own:
            continue
        for nb, w, _ in adj[nid]:
            if d + w < dist.get(nb, 1e18):
                dist[nb], owner[nb] = d + w, own
                heapq.heappush(pq, (d + w, nb, own))

    # Carry the track's own speed limit across with each link. Falling back to
    # a flat line speed instead makes fast main lines crawl: Brno-Breclav came
    # out at 67 minutes against a real 35, because 160 km/h track was being
    # costed at 70.
    edges = {}
    for nid, own in owner.items():
        for nb, w, sp in adj[nid]:
            other = owner.get(nb)
            if other is None or other == own:
                continue
            key = (min(own, other), max(own, other))
            total = dist[nid] + w + dist[nb]
            if key not in edges or total < edges[key][0]:
                edges[key] = (total, sp)
    return [(a, b, km, sp) for (a, b), (km, sp) in edges.items()]


def rail_lines(area, ways, stations, tol_km=0.25):
    """Recover line membership by geometry.

    The route relations carry complete *track* geometry even though their stop
    lists are unusable, so a station is on a line when it sits within a couple
    of hundred metres of that line's tracks. Way geometry is reused from the
    network fetch rather than pulled again."""
    r = query(f'[out:json][timeout:300];{area}'
              f'rel(area.a)["type"="route"]["route"~"^(train|railway)$"];out body;', "rel_bodies")
    geom = {w["id"]: w["geometry"] for w in ways}
    # route=railway is infrastructure, not service: it carries corridor names
    # like "I. TZK" and bare track numbers, which are not lines anyone rides.
    # Among real services, long-distance and night trains are dropped too --
    # a EuroCity does pass through, but "we share a line" should mean a line
    # you would actually use across a day of this.
    USEFUL = {"commuter", "regional", "national", None}
    grid = Grid(tol_km)
    seen_cells = set()
    for rel in r["elements"]:
        tags = rel.get("tags", {})
        ref = tags.get("ref")
        if not ref or tags.get("route") != "train" or tags.get("service") not in USEFUL:
            continue
        for m in rel.get("members", []):
            if m["type"] != "way" or m["ref"] not in geom:
                continue
            for p in geom[m["ref"]]:
                # One sample per cell per line keeps the index small.
                cell = (ref, round(p["lat"], 3), round(p["lon"], 3))
                if cell in seen_cells:
                    continue
                seen_cells.add(cell)
                grid.add(p["lat"], p["lon"], ref)
    out = []
    for st in stations:
        out.append(sorted({ref for _, ref in grid.near(st["lat"], st["lon"], tol_km)}))
    return out


def build_rail(cfg, area):
    print("fetching stations...")
    stations = fetch_rail_stations(area)
    print(f"  {len(stations)} stations/halts")

    print("fetching rail network...")
    ways = fetch_rail_ways(cfg["bbox"])
    print(f"  {len(ways)} rail ways")
    adj, coords = build_rail_graph(ways)
    print(f"  {len(coords)} rail nodes")
    adj = heal_gaps(adj, coords)

    snapped = snap_stations(stations, coords)
    print(f"  snapped {len(snapped)}/{len(stations)} stations onto the network")

    raw = rail_adjacency(adj, snapped)
    print(f"  {len(raw)} station-to-station links")

    print("recovering line membership from route geometry...")
    per_station = rail_lines(area, ways, stations)
    for st, refs in zip(stations, per_station):
        st["line_refs"] = refs
    have = sum(1 for s in stations if s["line_refs"])
    print(f"  {have}/{len(stations)} stations matched to at least one line")

    # An edge runs on whatever lines both of its ends share.
    edges = []
    for a, b, km, track_speed in raw:
        speed = track_speed if track_speed and track_speed > 20 else cfg["default_speed"]
        minutes = km / speed * 60.0 + cfg["dwell"]
        shared = sorted(set(stations[a]["line_refs"]) & set(stations[b]["line_refs"]))
        edges.append({"a": a, "b": b, "km": km, "minutes": minutes, "refs": shared})
    return stations, edges


# ============================================== urban public transport

def fetch_pt_stops(area):
    r = query(f'[out:json][timeout:300];{area}'
              f'(node(area.a)["railway"="tram_stop"];'
              f' node(area.a)["highway"="bus_stop"];'
              f' node(area.a)["public_transport"="stop_position"];'
              f' node(area.a)["public_transport"="platform"];);out body;', "pt_stops")
    return [e for e in r["elements"] if e.get("tags", {}).get("name")]


def cluster_stops(stops, merge_km):
    """One 'station' per named stop, not per pole.

    A city stop is several OSM nodes: a pair either side of the street, a
    stop_position on the rails and a platform beside them. Treating each as a
    separate hiding place would be nonsense, so nodes sharing a name and lying
    within merge_km of each other are merged by single linkage."""
    by_name = collections.defaultdict(list)
    for s in stops:
        by_name[s["tags"]["name"].strip()].append(s)

    stations = []
    for name, group in by_name.items():
        clusters = []
        for node in group:
            hit = None
            for c in clusters:
                if any(haversine(node["lat"], node["lon"], m["lat"], m["lon"]) <= merge_km for m in c):
                    hit = c
                    break
            if hit is None:
                clusters.append([node])
            else:
                hit.append(node)
        for c in clusters:
            stations.append({
                "name": name,
                "lat": sum(m["lat"] for m in c) / len(c),
                "lon": sum(m["lon"] for m in c) / len(c),
                "kind": "tram" if any(m["tags"].get("railway") == "tram_stop" for m in c) else "stop",
                "nodes": [m["id"] for m in c],
            })
    return stations


def build_pt(cfg, area):
    print("fetching stops...")
    stops = fetch_pt_stops(area)
    print(f"  {len(stops)} stop objects")
    stations = cluster_stops(stops, cfg["merge_km"])
    print(f"  {len(stations)} stations after merging poles and platforms")

    node_to_station = {}
    for i, st in enumerate(stations):
        for nid in st["nodes"]:
            node_to_station[nid] = i
        st.pop("nodes")
        st["line_refs"] = set()

    skip = re.compile(cfg["skip_lines"]) if cfg.get("skip_lines") else None
    modes = "|".join(cfg["modes"])
    r = query(f'[out:json][timeout:400];{area}'
              f'rel(area.a)["type"="route"]["route"~"^({modes})$"];out body;', "pt_routes")

    edges = {}
    skipped = 0
    # The ordered stop list per direction, which the departure board runs on.
    # It has to be kept here: collapsing the two directions into undirected
    # edges is lossy, and reconstructing an order from the edge graph turns
    # half the network into branching soup. The mode is kept for the same
    # reason -- the timetable headway is per mode, and Brno's line 21 is a
    # trolleybus, so guessing it from the number would be wrong.
    line_mode, variants = {}, collections.defaultdict(list)
    for rel in r["elements"]:
        tags = rel.get("tags", {})
        ref, mode = tags.get("ref"), tags.get("route")
        if not ref or mode not in cfg["modes"]:
            continue
        if skip and skip.match(ref):
            continue
        line_mode.setdefault(ref, mode)
        seq = []
        for m in rel.get("members", []):
            if m["type"] != "node" or not m.get("role", "").startswith(("stop", "platform")):
                continue
            idx = node_to_station.get(m["ref"])
            if idx is not None and (not seq or seq[-1] != idx):
                seq.append(idx)
        if len(seq) > 1:
            variants[ref].append(seq)
        for i in seq:
            stations[i]["line_refs"].add(ref)
        speed = cfg["modes"][mode]
        for a, b in zip(seq, seq[1:]):
            km = haversine(stations[a]["lat"], stations[a]["lon"],
                           stations[b]["lat"], stations[b]["lon"])
            # A long jump means the route left the mapped area and came back.
            if km > 3.0:
                skipped += 1
                continue
            key = (min(a, b), max(a, b))
            minutes = km / speed * 60.0 + cfg["dwell"]
            e = edges.get(key)
            if e is None or minutes < e["minutes"]:
                edges[key] = {"a": key[0], "b": key[1], "km": km, "minutes": minutes, "refs": set()}
            edges[key]["refs"].add(ref)
    print(f"  {len(edges)} links from route relations ({skipped} over-long hops skipped)")

    for st in stations:
        st["line_refs"] = sorted(st["line_refs"])
    out = []
    for e in edges.values():
        e["refs"] = sorted(e["refs"])
        out.append(e)

    # Two directions per line, deduplicated on exact equality only: a sequence
    # and its reverse are the two directions of one service, not a duplicate,
    # and treating them as one left every terminal loop with nowhere to go. A
    # line mapped in one direction only still runs back the other way.
    services = {}
    for ref, vs in variants.items():
        seen, keep = set(), []
        for v in sorted(vs, key=len, reverse=True):
            if tuple(v) in seen:
                continue
            seen.add(tuple(v)); keep.append(v)
            if len(keep) == 2:
                break
        if len(keep) == 1 and tuple(keep[0][::-1]) not in seen:
            keep.append(keep[0][::-1])
        services[ref] = keep
    print(f"  {len(services)} lines with an ordered stop list "
          f"({collections.Counter(line_mode.values())})")
    return stations, out, line_mode, services


# ================================================================== output

def largest_component(stations, edges):
    adj = collections.defaultdict(set)
    for e in edges:
        adj[e["a"]].add(e["b"]); adj[e["b"]].add(e["a"])
    best, unvisited = set(), set(adj)
    while unvisited:
        seed = unvisited.pop(); comp = {seed}; stack = [seed]
        while stack:
            n = stack.pop()
            for m in adj[n]:
                if m in unvisited:
                    unvisited.discard(m); comp.add(m); stack.append(m)
        if len(comp) > len(best):
            best = comp
    dropped = [s["name"] for i, s in enumerate(stations) if i not in best]
    if dropped:
        print(f"  dropped {len(dropped)} unreachable: {', '.join(sorted(set(dropped))[:6])}")
    return best


def build(map_id):
    cfg = MAPS[map_id]
    area = area_filter(*cfg["area"])
    print(f"=== {cfg['name']} ({cfg['kind']}) ===")

    line_mode, services = {}, {}
    if cfg["kind"] == "rail":
        stations, edges = build_rail(cfg, area)
    else:
        stations, edges, line_mode, services = build_pt(cfg, area)

    keep = largest_component(stations, edges)
    remap = {old: new for new, old in enumerate(sorted(keep))}
    edges = [e for e in edges if e["a"] in remap and e["b"] in remap]

    print("fetching places, districts, POIs...")
    places = fetch_places(area, f"{map_id}_places",
                          cfg.get("place_types", "city|town|village"))
    districts = fetch_boundaries(area, cfg["district_level"], f"{map_id}_districts")
    print(f"  {len(places)} places, {len(districts)} districts")
    pois = fetch_pois(area, map_id)

    kept = [stations[old] for old in sorted(keep)]
    attach_context(kept, places, districts)

    print("fetching rivers...")
    lats = [s["lat"] for s in kept]; lons = [s["lon"] for s in kept]
    pad = 0.2
    river_bbox = (min(lats) - pad, min(lons) - pad, max(lats) + pad, max(lons) + pad)
    extra = cfg.get("extra_waterways", ())
    rivers = fetch_rivers(river_bbox, f"{map_id}_rivers", also=extra)
    linears = {"river": nearest_river(kept, rivers,
                                      min_stops=cfg.get("min_river_stops", 0))}
    found = sorted({n for n in linears["river"]["name"] if n})
    print(f"  {len(rivers)} named rivers, {len(found)} of them nearest to some stop")
    print(f"  {', '.join(found)}")
    # Fail loudly rather than quietly shipping a map with a dead question: an
    # Overpass timeout here once wrote south-moravia.json with zero rivers.
    if len(found) < 2:
        raise RuntimeError(f"{map_id}: only {len(found)} rivers resolved - "
                           f"the Overpass fetch probably failed, refusing to write a broken map")

    # Lines are stored once and referenced by index, to keep the file small.
    refs = sorted({r for s in kept for r in s["line_refs"]}, key=lambda x: (len(x), x))
    line_idx = {r: i for i, r in enumerate(refs)}

    out_stations = []
    degree = collections.Counter()
    for e in edges:
        degree[remap[e["a"]]] += 1
        degree[remap[e["b"]]] += 1
    for old in sorted(keep):
        s = stations[old]
        out_stations.append({
            "id": remap[old], "name": s["name"],
            "lat": round(s["lat"], 5), "lon": round(s["lon"], 5),
            "kind": s["kind"], "district": s["district"], "municipality": s["municipality"],
            "population": s["population"], "ele": s["ele"],
            "lines": [line_idx[r] for r in s["line_refs"]],
            "degree": degree[remap[old]],
        })

    out_edges = [[remap[e["a"]], remap[e["b"]], round(e["km"], 3), round(e["minutes"], 2),
                  [line_idx[r] for r in e["refs"] if r in line_idx]] for e in edges]

    # Ordered stops per direction, with cumulative running time from the first
    # stop -- everything the departure board needs. A pair of consecutive stops
    # occasionally has no surviving edge (the route left the mapped area and
    # came back, or one end fell outside the largest component), so the gap is
    # priced from distance and the mode's speed, the same way build_pt does it.
    edge_minutes = {}
    for e in out_edges:
        edge_minutes[(e[0], e[1])] = e[3]
        edge_minutes[(e[1], e[0])] = e[3]
    line_modes, line_stops = [], []
    for ref in refs:
        mode = line_mode.get(ref, "bus")
        line_modes.append(mode)
        speed = cfg.get("modes", {}).get(mode, 20.0)
        out = []
        for seq in services.get(ref, []):
            seq = [remap[i] for i in seq if i in remap]
            seq = [b for a, b in zip([None] + seq, seq) if a != b]
            if len(seq) < 2:
                continue
            times = [0.0]
            for a, b in zip(seq, seq[1:]):
                m = edge_minutes.get((a, b))
                if m is None:
                    km = haversine(out_stations[a]["lat"], out_stations[a]["lon"],
                                   out_stations[b]["lat"], out_stations[b]["lon"])
                    m = km / speed * 60.0 + cfg["dwell"]
                times.append(round(times[-1] + m, 2))
            out.append({"stops": seq, "times": times})
        line_stops.append(out)

    lats = [s["lat"] for s in out_stations]
    lons = [s["lon"] for s in out_stations]
    data = {
        "id": map_id,
        "name": cfg["name"],
        "blurb": cfg["blurb"],
        "kind": cfg["kind"],
        "attribution": "Map data \u00a9 OpenStreetMap contributors; elevation SRTM via OpenTopoData",
        "bbox": [min(lats), min(lons), max(lats), max(lons)],
        "center": cfg["center"],
        "districts": sorted({s["district"] for s in out_stations if s["district"]}),
        "lines": refs,
        # Per-line mode and ordered stops, for the timetable and the departure
        # board. Empty on a map whose kind is rail; see js/timetable.js, which
        # falls back to free travel when a map carries no headway.
        "lineModes": line_modes,
        "lineStops": line_stops,
        # The rivers a player can actually be told, not every river fetched:
        # this is the list the question's answer set is drawn from.
        "rivers": found,
        "linears": linears,
        "stations": out_stations,
        "edges": out_edges,
        "pois": pois,
    }
    os.makedirs(DATA, exist_ok=True)
    path = os.path.join(DATA, f"{map_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    linked = sum(1 for s in out_stations if s["lines"])
    print(f"wrote {path}: {len(out_stations)} stations, {len(out_edges)} edges, "
          f"{len(refs)} lines ({linked} stations on a known line), "
          f"{sum(len(v) for v in pois.values())} POIs, {os.path.getsize(path)/1024:.0f} KB\n")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    for map_id in (MAPS if which == "all" else [which]):
        build(map_id)
