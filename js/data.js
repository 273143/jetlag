// Loads a baked map file and precomputes the lookups the question engine
// needs. Every POI question reduces to two arrays per category -- the nearest
// POI's name and its distance, per station -- so answering and candidate
// filtering are both O(1) at run time.

import { haversine } from "./geo.js";

export const MAPS = [
  { id: "south-moravia", file: "data/south-moravia.json" },
  { id: "brno", file: "data/brno.json" },
];

export async function loadWorld(url = "data/south-moravia.json") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load map data (${res.status})`);
  const raw = await res.json();

  const stations = raw.stations;
  const byId = new Map(stations.map((s) => [s.id, s]));

  // nearest[cat] = { name: [...perStation], km: [...perStation] }
  const nearest = {};
  for (const [cat, list] of Object.entries(raw.pois)) {
    const name = new Array(stations.length).fill(null);
    const km = new Array(stations.length).fill(Infinity);
    for (const s of stations) {
      for (const p of list) {
        const d = haversine(s, p);
        if (d < km[s.id]) { km[s.id] = d; name[s.id] = p.name; }
      }
    }
    nearest[cat] = { name, km };
  }
  // Linear features (rivers) are baked at build time -- nearest-point-on-a-
  // river is not the same as nearest-to-its-centroid, so it cannot be derived
  // from a point list here. They arrive in the same shape, so every question
  // type works on them unchanged.
  Object.assign(nearest, raw.linears ?? {});

  const adj = stations.map(() => []);
  for (const [a, b, km, minutes, lines] of raw.edges) {
    adj[a].push({ to: b, km, minutes, lines });
    adj[b].push({ to: a, km, minutes, lines });
  }

  // The reference landmark for "are you closer to X than I am?". Ranked by
  // lines served first, so it lands on the stop everyone knows -- by raw
  // degree alone Brno's landmark came out as Pisarky rather than the main
  // station.
  const rank = (s) => [s.lines?.length ?? 0, s.degree, s.population];
  const hub = stations.reduce((best, s) => {
    if (!best) return s;
    const [a1, b1, c1] = rank(s), [a2, b2, c2] = rank(best);
    return (a1 > a2 || (a1 === a2 && (b1 > b2 || (b1 === b2 && c1 > c2)))) ? s : best;
  }, null);

  return {
    ...raw, stations, byId, adj, nearest, hub,
    lineNames: (idx) => idx.map((i) => raw.lines[i]),
    letters: stations.map((s) => s.name.replace(/[^\p{L}]/gu, "").length),
  };
}

/** Binary min-heap. The old sort-the-array-every-pop version was fine for 180
 *  rail stations, but Brno's line-aware search visits tens of thousands of
 *  states and needs a real queue. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(pri, val) {
    const a = this.a;
    a.push({ pri, val });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].pri <= a[i].pri) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].pri < a[m].pri) m = l;
        if (r < a.length && a[r].pri < a[m].pri) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest travel times from one station, over states of (station, line).
 *
 * Routing has to know which line you are on, because changing lines costs
 * real time. Without that a city map lets you hop across ten bus routes in
 * twelve minutes with no waiting, which flatters the seeker enormously and
 * makes the whole network feel like teleportation. Boarding at the start
 * counts as a transfer too: you have to wait for the first vehicle.
 *
 * Returns { minutes, pathTo(id), lineTo(id) }.
 */
export function travelTimes(world, from, transferMinutes = 0) {
  const n = world.stations.length;
  const L = world.lines?.length ?? 0;
  const NONE = L;                       // "on foot / line unknown"
  const slots = L + 1;
  const key = (node, slot) => node * slots + slot;

  const dist = new Map();
  const prev = new Map();
  const heap = new Heap();
  dist.set(key(from, NONE), 0);
  heap.push(0, key(from, NONE));

  while (heap.size) {
    const { pri: d, val: k } = heap.pop();
    if (d > (dist.get(k) ?? Infinity)) continue;
    const node = Math.floor(k / slots);
    const slot = k % slots;
    for (const e of world.adj[node]) {
      const options = e.lines && e.lines.length ? e.lines : [NONE];
      for (const next of options) {
        // Only a genuine change of line is charged. Boarding the first vehicle
        // is not: the quoted times these are calibrated against are in-vehicle
        // times, and charging the first wait made every direct trip too slow.
        // An edge with no known line cannot be claimed to be a change either.
        const changing = slot !== NONE && next !== NONE && next !== slot;
        const nd = d + e.minutes + (changing ? transferMinutes : 0);
        const nk = key(e.to, next);
        if (nd < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, nd);
          prev.set(nk, k);
          heap.push(nd, nk);
        }
      }
    }
  }

  // Collapse (station, line) states down to the best time per station.
  const minutes = new Float64Array(n).fill(Infinity);
  const bestKey = new Int32Array(n).fill(-1);
  for (const [k, d] of dist) {
    const node = Math.floor(k / slots);
    if (d < minutes[node]) { minutes[node] = d; bestKey[node] = k; }
  }

  const walk = (target) => {
    const path = [];
    for (let k = bestKey[target]; k !== undefined && k !== -1; k = prev.get(k)) {
      path.push({ station: Math.floor(k / slots), slot: k % slots });
      if (prev.get(k) === undefined) break;
    }
    return path.reverse();
  };

  return {
    minutes,
    pathTo: (target) => walk(target).map((p) => p.station),
    /** Line refs used along the way, in order, for the journey description. */
    lineTo: (target) => {
      const out = [];
      for (const p of walk(target)) {
        if (p.slot === NONE) continue;
        const ref = world.lines[p.slot];
        if (ref && out[out.length - 1] !== ref) out.push(ref);
      }
      return out;
    },
  };
}
