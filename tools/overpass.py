"""Tiny cached Overpass client used by the data build."""
import json, os, glob, time, urllib.request, urllib.parse, hashlib, urllib.error

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
]
CACHE = os.environ.get(
    "JETLAG_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".cache", "overpass"))


def query(q, tag=""):
    """Run an Overpass query, caching the response on disk.

    Keyed on the query text alone. An earlier version folded the caller's
    label into the filename too, so renaming a label silently invalidated a
    cache full of perfectly good responses and sent the whole build back to
    Overpass, straight into its rate limiter. Legacy `label_hash.json` files
    are still honoured so an existing cache keeps working."""
    os.makedirs(CACHE, exist_ok=True)
    key = hashlib.sha1(q.encode()).hexdigest()[:16]
    path = os.path.join(CACHE, f"{key}.json")
    if not os.path.exists(path):
        legacy = glob.glob(os.path.join(CACHE, f"*_{key}.json"))
        if legacy:
            path = legacy[0]
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    path = os.path.join(CACHE, f"{key}.json")
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(6):
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "jetlag-game-dev/0.1"})
            with urllib.request.urlopen(req, timeout=600) as r:
                out = json.load(r)
            with open(path, "w") as f:
                json.dump(out, f)
            return out
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            last = e
            print(f"  overpass {url.split('/')[2]} failed ({e}); backing off", flush=True)
            time.sleep(20 * (attempt + 1))
    raise RuntimeError(f"all Overpass endpoints failed: {last}")
