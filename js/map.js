// Leaflet map: the rail network, the candidate set, and the seeker.
//
// The candidate dots are the game's real display. Everything the hider has
// told you is visible as the shape of what is left standing, so the map is
// deliberately quiet about everything else.


// Standard OSM tiles, darkened in CSS rather than fetched pre-styled: the
// free CARTO basemaps now stamp "API KEY REQUIRED" across every tile.
export const BASE_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Photo questions get real aerial imagery, which is far closer to what the
// question actually asks for than a crop of the same map the seeker is reading.
export const PHOTO_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const PHOTO_ATTR = "Imagery &copy; Esri";

/** Leaflet only honours `className` when a path is first created, so styling
 *  has to go through setStyle with real colour values. We resolve them from
 *  the stylesheet once, which keeps the palette in CSS where it belongs. */
function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, fallback) => (cs.getPropertyValue(n).trim() || fallback);
  return {
    rail:      v("--rail", "#8a8f98"),
    candidate: v("--candidate", "#f0b429"),
    out:       v("--out", "#5b616e"),
    checked:   v("--checked", "#7b8290"),
    seeker:    v("--seeker", "#3ba3ff"),
    hider:     v("--hider", "#ff4d5e"),
    ink:       v("--ink", "#0e1116"),
  };
}

export class GameMap {
  constructor(el, world, { onStationClick } = {}) {
    this.world = world;
    this.onStationClick = onStationClick;
    this.pal = palette();
    // A city map has three times the stops in a tenth of the area, so markers
    // sized for the region merge into one amber blob. Scale them to how many
    // stops there are and to how much screen there is to draw them on -- a
    // phone shows the same network in a third of the width.
    const byCount = Math.min(1, 220 / world.stations.length);
    const byScreen = Math.min(1, Math.max(el.clientWidth, 320) / 900);
    this.dot = Math.max(0.4, byCount * 0.6 + byScreen * 0.4);
    this.map = L.map(el, { zoomControl: false, attributionControl: true })
      .setView(world.center, 9);
    L.control.zoom({ position: "bottomright" }).addTo(this.map);
    // A scale bar, metric only. Every distance the game quotes is in
    // kilometres -- radar radii, tentacles radii, "3.2 km away" -- and
    // without a ruler none of them mean anything on screen, because the one
    // thing a slippy map does not tell you is how big it currently is.
    L.control.scale({ position: "bottomleft", imperial: false, maxWidth: 160 }).addTo(this.map);

    L.tileLayer(BASE_TILES, { maxZoom: 18, attribution: TILE_ATTR, className: "basemap" })
      .addTo(this.map);

    this.railLayer = L.layerGroup().addTo(this.map);
    this.rangeLayer = L.layerGroup().addTo(this.map);
    this.overlayLayer = L.layerGroup().addTo(this.map);
    this.stationLayer = L.layerGroup().addTo(this.map);

    for (const [a, b] of world.edges) {
      const sa = world.byId.get(a), sb = world.byId.get(b);
      if (!sa || !sb) continue;
      L.polyline([[sa.lat, sa.lon], [sb.lat, sb.lon]],
        { color: this.pal.rail, weight: 2 * this.dot, opacity: 0.45, interactive: false })
        .addTo(this.railLayer);
    }

    this.markers = new Map();
    for (const s of world.stations) {
      const m = L.circleMarker([s.lat, s.lon], { radius: 5 * this.dot }).addTo(this.stationLayer);
      m.bindTooltip(s.name, { direction: "top", offset: [0, -6] });
      m.on("click", () => this.onStationClick?.(s));
      this.markers.set(s.id, m);
    }

    this.map.fitBounds([[world.bbox[0], world.bbox[1]], [world.bbox[2], world.bbox[3]]], { padding: [20, 20] });
  }

  /**
   * Paint for the hiding period: everywhere the hider can get to, and how
   * much of the head start each one spends.
   *
   * The seeker's map answers "where could they be"; this one answers "where
   * could I get to", which is the same set seen from the other side. Warmer
   * dots are further into the window, because the choice a hider is actually
   * making is how much of their head start to spend -- and the one thing that
   * has to be visible is the edge of what they can reach at all.
   */
  renderReach({ startId, reach, window, chosenId }) {
    const p = this.pal;
    this.overlayLayer.clearLayers();
    this.rangeLayer.clearLayers();
    this.ranges = null;                        // the ring cache is per-seeker
    for (const s of this.world.stations) {
      const m = this.markers.get(s.id);
      const t = reach.minutes[s.id];
      const k = this.dot;
      if (s.id === chosenId) {
        m.setStyle({ color: p.hider, fillColor: p.hider, fillOpacity: 1, weight: 3, opacity: 1 });
        m.setRadius(11);
      } else if (s.id === startId) {
        m.setStyle({ color: p.seeker, fillColor: p.seeker, fillOpacity: 1, weight: 3, opacity: 1 });
        m.setRadius(9);
      } else if (t <= window) {
        const share = Math.min(t / window, 1);
        m.setStyle({ color: p.candidate, fillColor: p.candidate,
                     fillOpacity: 0.25 + share * 0.6, weight: 1.5 * k, opacity: 1 });
        m.setRadius((4 + share * 3.5) * k);
      } else {
        m.setStyle({ color: p.out, fillColor: p.out, fillOpacity: 0.2, weight: 0.5, opacity: 0.28 });
        m.setRadius(2 * k);
      }
    }
    this.markers.get(startId)?.bringToFront();
    if (chosenId != null) this.markers.get(chosenId)?.bringToFront();
  }

  /** Forget everything drawn for the round that has just ended. A match keeps
   *  one map across several rounds, and a stale ring or a leftover radar disc
   *  from the last round is a lie about this one. */
  reset() {
    this.overlayLayer.clearLayers();
    this.rangeLayer.clearLayers();
    this.ranges = null;
    // Tooltips as well as popups, and this one is not housekeeping: Leaflet
    // opens a tooltip on click as well as on hover, and on a touch screen
    // nothing ever closes it again. So the stop the hider tapped stays
    // labelled on the map, and handing the phone over hands over the answer.
    for (const m of this.markers.values()) { m.closePopup(); m.closeTooltip(); }
    this.fitWorld();
  }

  /** Fit a subset of stops -- during the hiding period the whole network is
   *  the wrong frame, because the choice being made is inside the window and
   *  on a phone the reachable stops are otherwise a blob two fingers wide. */
  fitStops(stops, padding = 40) {
    if (!stops?.length) return this.fitWorld();
    const lats = stops.map((s) => s.lat), lons = stops.map((s) => s.lon);
    this.map.fitBounds(
      [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]],
      { padding: [padding, padding] });
  }

  /** Back to the whole network. Also the thing that stops the hiding phase
   *  leaking: the hider leaves the map zoomed in on where they went, and
   *  handing it over like that would give the seeker the answer for nothing. */
  fitWorld() {
    const b = this.world.bbox;
    this.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [20, 20] });
  }

  /** Repaint every station from the current game state. */
  render(state) {
    const p = this.pal;
    const candidates = new Set(state.candidates.map((s) => s.id));
    const found = state.status === "found" ? state.hider.committed?.id : null;
    for (const s of this.world.stations) {
      const m = this.markers.get(s.id);
      let style, radius;
      const k = this.dot;
      if (s.id === found) {
        style = { color: p.hider, fillColor: p.hider, fillOpacity: 1, weight: 3, opacity: 1 };
        radius = 11;                                   // always findable by eye
      } else if (s.id === state.seekerId) {
        style = { color: p.seeker, fillColor: p.seeker, fillOpacity: 1, weight: 3, opacity: 1 };
        radius = 9;
      } else if (candidates.has(s.id)) {
        style = { color: p.candidate, fillColor: p.candidate, fillOpacity: 0.85,
                  weight: 1.5 * k, opacity: 1 };
        radius = (s.degree > 2 ? 7 : 5.5) * k;
      } else if (state.checked.has(s.id)) {
        style = { color: p.checked, fillColor: p.ink, fillOpacity: 0.9, weight: 2 * k, opacity: 0.9 };
        radius = 4.5 * k;
      } else {
        style = { color: p.out, fillColor: p.out, fillOpacity: 0.35, weight: 0.5, opacity: 0.4 };
        radius = 2.5 * k;
      }
      m.setStyle(style);
      m.setRadius(radius);
    }
    this.drawRanges(state);
    this.markers.get(state.seekerId)?.bringToFront();
    if (found) this.markers.get(found)?.bringToFront();
  }

  /**
   * Rings around the seeker at exactly the radar distances this map offers.
   *
   * The scale bar tells you how long a kilometre is; these tell you what the
   * question in front of you actually covers. "Are you within 4 km of me?" is
   * a shape on the map, and until you can see the shape you are guessing at
   * whether the answer would be worth five minutes -- which is the whole
   * decision the question is asking you to make.
   */
  drawRanges(state) {
    if (this.ranges === state.seekerId) return;      // only when the seeker moves
    this.ranges = state.seekerId;
    this.rangeLayer.clearLayers();
    const me = this.world.byId.get(state.seekerId);
    const radii = (state.rangeRings ?? []).slice().sort((a, b) => a - b);
    for (const km of radii) {
      L.circle(me, {
        radius: km * 1000, interactive: false,
        color: this.pal.seeker, weight: 1, opacity: 0.3,
        fill: false, dashArray: "3 5",
      }).addTo(this.rangeLayer);
      // Label the ring where it crosses due north, so the numbers do not pile
      // up on top of each other the way they would at a shared bearing.
      L.marker([me.lat + km / 111.32, me.lon], {
        interactive: false,
        icon: L.divIcon({ className: "ringlabel", html: `${km} km`, iconSize: [40, 14] }),
      }).addTo(this.rangeLayer);
    }
  }

  /** Draw the geometry behind the most recent answer, when it has one. */
  showConstraint(state, q, answer) {
    this.overlayLayer.clearLayers();
    if (!q) return;
    const me = this.world.byId.get(state.seekerId);
    const p = this.pal;
    if (q.cat === "radar") {
      const km = Number(q.id.split("_")[1]);
      L.circle([me.lat, me.lon], {
        radius: km * 1000, interactive: false, weight: 1.5, dashArray: "5 5",
        color: answer ? p.candidate : p.out,
        fillColor: p.candidate, fillOpacity: answer ? 0.08 : 0,
      }).addTo(this.overlayLayer);
    }
    if (q.cat === "thermometer" && state.lastThermoLeg) {
      const { from, to } = state.lastThermoLeg;
      L.polyline([[from.lat, from.lon], [to.lat, to.lon]],
        { color: p.seeker, weight: 2.5, dashArray: "6 6", interactive: false }).addTo(this.overlayLayer);
    }
  }

  clearConstraint() { this.overlayLayer.clearLayers(); }

  panTo(station) { this.map.panTo([station.lat, station.lon]); }
}

/** Render the hider's "photo": an unlabelled map crop, no coordinates shown. */
export function makePhoto(container, { lat, lon, zoom }) {
  container.innerHTML = "";
  const map = L.map(container, {
    zoomControl: false, attributionControl: false, dragging: false,
    scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
    keyboard: false, touchZoom: false,
  }).setView([lat, lon], zoom);
  L.tileLayer(PHOTO_TILES, { maxZoom: 18, attribution: PHOTO_ATTR }).addTo(map);
  setTimeout(() => map.invalidateSize(), 30);
  return map;
}
