// Offline map packs.
//
// The game logic and both map files are precached by the service worker, so
// the deduction half works with no signal as soon as you have opened the page
// once. Tiles are the bulk, and they are fetched here on request.
//
// The saving idea: a photo is always centred on a *stop*, and there are only
// 180 or 542 of those. Packing the region at zoom 17 wholesale would be
// hundreds of thousands of tiles; packing three-by-three around each stop is
// a couple of thousand. Three-by-three rather than a single tile because the
// photo view is about one and a half tiles across and would otherwise show
// torn edges.
//
// Two levels, because the honest sizes are far apart and the choice belongs
// to whoever is paying for the data:
//
//   map      everything needed to play: the network at overview zooms, plus
//            enough detail around each stop to see where you are.
//   photos   adds the aerial imagery the Photo questions answer with. This is
//            most of the bytes -- close-up imagery for every possible hiding
//            place is simply a lot of pictures.

import { PHOTO_TILES, BASE_TILES } from "./map.js";

export const TILE_CACHE = "hs-tiles-v1";

/** Cache Storage is not always there even when `caches` is: private windows
 *  and locked-down browsers can leave a call pending forever rather than
 *  rejecting. Everything that touches it is bounded so the UI can always say
 *  something instead of sitting on a spinner. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} did not respond`)), ms)),
  ]);
}

async function openTileCache() {
  if (!("caches" in window)) throw new Error("this browser has no offline storage");
  return withTimeout(caches.open(TILE_CACHE), 4000, "offline storage");
}

const PACKS = {
  "south-moravia": { bbox: [8, 9, 10, 11, 12], stopBase: [14], photo: [11, 13, 15, 17] },
  brno:            { bbox: [10, 11, 12, 13, 14], stopBase: [15], photo: [11, 13, 15, 17] },
};

// Measured averages from the two servers.
const KB_MAP = 14;
const KB_AERIAL = 22;

const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** Fill in {s},{z},{x},{y} the way Leaflet does, so the URLs match its requests. */
function tileUrl(template, z, x, y) {
  const subs = "abc";
  return template
    .replace("{s}", subs[(x + y) % subs.length])
    .replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

function around(stations, zooms, template, into) {
  for (const stop of stations) {
    for (const z of zooms) {
      const cx = lonToX(stop.lon, z), cy = latToY(stop.lat, z);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          into.add(tileUrl(template, z, cx + dx, cy + dy));
    }
  }
}

/**
 * Tile URLs for a map.
 * @param level "map" for the playable minimum, "photos" for that plus imagery.
 */
export function packUrls(world, level = "map") {
  const pack = PACKS[world.id];
  if (!pack) return [];
  const urls = new Set();
  const [s, w, n, e] = world.bbox;

  for (const z of pack.bbox) {
    for (let x = lonToX(w, z); x <= lonToX(e, z); x++)
      for (let y = latToY(n, z); y <= latToY(s, z); y++)
        urls.add(tileUrl(BASE_TILES, z, x, y));
  }
  around(world.stations, pack.stopBase, BASE_TILES, urls);
  if (level === "photos") around(world.stations, pack.photo, PHOTO_TILES, urls);
  return [...urls];
}

export function estimateMb(urls) {
  const aerial = urls.filter((u) => u.includes("arcgisonline")).length;
  return ((urls.length - aerial) * KB_MAP + aerial * KB_AERIAL) / 1024;
}

/**
 * How much of a pack is already stored.
 *
 * Reads the cache's key list once and compares in memory. Calling
 * cache.match() per URL instead is not just slow, it stalled outright when
 * asked for a few hundred lookups in a row.
 */
export async function packStatus(world, level = "map") {
  if (!("caches" in window)) return null;
  const urls = packUrls(world, level);
  if (!urls.length) return null;
  const cache = await openTileCache();
  const have = new Set((await withTimeout(cache.keys(), 8000, "offline storage")).map((r) => r.url));
  const stored = urls.reduce((a, u) => a + (have.has(new URL(u, location.href).href) ? 1 : 0), 0);
  return { total: urls.length, stored, fraction: stored / urls.length };
}

/**
 * Download a pack into the tile cache.
 *
 * Both tile servers send Access-Control-Allow-Origin: *, so these are real
 * CORS responses that can go straight into the Cache API. An opaque no-cors
 * response would be rejected by cache.put().
 */
export async function downloadPack(world, { level = "map", onProgress, signal } = {}) {
  const urls = packUrls(world, level);
  const cache = await openTileCache();
  const have = new Set((await withTimeout(cache.keys(), 8000, "offline storage")).map((r) => r.url));

  let done = 0, failed = 0, cursor = 0;
  const CONCURRENCY = 6;

  async function worker() {
    while (cursor < urls.length) {
      if (signal?.aborted) return;
      const url = urls[cursor++];
      if (!have.has(new URL(url, location.href).href)) {
        try {
          const res = await fetch(url, { signal });
          if (res.ok) await cache.put(url, res.clone());
          else failed++;
        } catch (err) {
          if (signal?.aborted) return;
          failed++;
        }
      }
      done++;
      if (done % 20 === 0 || done === urls.length) onProgress?.(done, urls.length, failed);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  onProgress?.(done, urls.length, failed);
  return { total: urls.length, failed };
}

export async function clearPack() {
  if (!("caches" in window)) return;
  await withTimeout(caches.delete(TILE_CACHE), 6000, "offline storage");
}

/** Bytes the browser says this origin is using, when it will tell us. */
export async function storageUsed() {
  try {
    const est = await navigator.storage?.estimate?.();
    return est?.usage ?? null;
  } catch (err) {
    return null;
  }
}
