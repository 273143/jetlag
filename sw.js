// Service worker: makes the game installable and playable with no network.
//
// Two caches, deliberately separate.
//
//   shell  the app and both map files, ~700 KB, precached on install. Once
//          this is in place the whole deduction game runs offline; only the
//          map picture needs the network.
//   tiles  map and aerial tiles. Filled two ways: whatever you have looked at
//          is kept, and js/offline.js can bulk-download a whole map pack.
//          Never purged on activate -- a user on a train has paid for those
//          megabytes once and should not lose them to a code update.

// Bump on any change to the files below. v9: the start screen scrolls on a
// phone. v8: js/wakelock.js. v7: the panel's
// Ask / Answers panes. v6: added js/match.js and
// js/hidephase.js for the two-player pass-and-play. v5 added js/timetable.js,
// and app files are served network-first (see the fetch handler).
const SHELL = "hs-shell-v9";
const TILES = "hs-tiles-v1";

const SHELL_FILES = [
  "./", "./index.html", "./manifest.webmanifest",
  "./css/style.css",
  "./js/main.js", "./js/data.js", "./js/game.js", "./js/questions.js",
  "./js/rules.js", "./js/hider.js", "./js/deck.js", "./js/curses.js",
  "./js/map.js", "./js/ui.js", "./js/geo.js", "./js/offline.js",
  "./js/timetable.js", "./js/match.js", "./js/hidephase.js",
  "./js/wakelock.js",
  "./vendor/leaflet.js", "./vendor/leaflet.css",
  "./vendor/images/layers.png", "./vendor/images/layers-2x.png",
  "./vendor/images/marker-icon.png",
  "./data/south-moravia.json", "./data/brno.json",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

const isTile = (url) =>
  url.hostname.endsWith("tile.openstreetmap.org") || url.hostname.endsWith("arcgisonline.com");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL)
      // Individually, so one bad entry cannot fail the whole install.
      .then((c) => Promise.all(SHELL_FILES.map((f) => c.add(f).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("hs-shell-") && k !== SHELL).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (isTile(url)) {
    // Cache first: a tile never changes meaningfully, and on a train the
    // cached copy is the only copy.
    event.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          return new Response("", { status: 504, statusText: "offline, tile not cached" });
        }
      }),
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // App files: network first, cache as the fallback.
  //
  // This was the other way round -- serve the cached copy, refresh in the
  // background -- which is the right shape for an app that ships and then
  // sits still, and quite wrong for one being worked on. Every edit took two
  // reloads to appear: the first served the old file and only then fetched
  // the new one, so the game you were looking at was always one change
  // behind. That is a nasty way to lose an evening, and worse than the
  // latency it saves.
  //
  // Offline is unaffected. The shell is precached on install, so when the
  // network is not there the cache answers exactly as before; all that
  // changes is which copy wins when both are available.
  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        throw err;
      }
    }),
  );
});
