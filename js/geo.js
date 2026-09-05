// Spherical geometry helpers. Distances in kilometres, angles in degrees.
//
// The three formatters are here rather than in i18n.js because they are what
// the rest of the game reaches for; the language only decides the punctuation
// around the number ("3.2 km" against "3,2 km", "1h 05m" against "1 h 05 min").

import { t } from "./i18n.js";

export const R_EARTH = 6371.0088;

const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat);
  const dp = p2 - p1, dl = rad(b.lon - a.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

/** Nearest item in `list` to `pt`, as {item, km}. Empty list gives item:null. */
export function nearest(pt, list) {
  let best = null, bestKm = Infinity;
  for (const it of list) {
    const km = haversine(pt, it);
    if (km < bestKm) { best = it; bestKm = km; }
  }
  return { item: best, km: bestKm };
}

/** Everything in `list` within `km` of `pt`. */
export function within(pt, list, km) {
  return list.filter((it) => haversine(pt, it) <= km);
}

/** Metres per degree of longitude at a given latitude — for local projections. */
export function lonScale(lat) {
  return Math.cos(rad(lat));
}

export function formatKm(km) {
  if (km < 1) return t("fmt.metres", { m: Math.round(km * 1000) });
  const n = km < 10 ? km.toFixed(1).replace(".", t("fmt.decimal")) : Math.round(km);
  return t("fmt.km", { km: n });
}

export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? t("fmt.hours", { h, m: String(m % 60).padStart(2, "0") })
           : t("fmt.minutes", { m });
}

/** Clock time as HH:MM from minutes since midnight. */
export function formatClock(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
