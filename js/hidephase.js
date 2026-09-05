// The two screens a pass-and-play round needs before anyone can seek: the
// handover, and the hider actually going and hiding.
//
// Both are promises, because that is what the flow is -- the round cannot
// start until a person has done something, and main.js reads as a sequence of
// awaits rather than as a pile of callbacks.
//
// The handover screen exists for one reason: whatever is on the screen when
// the phone changes hands has been given away. So it covers everything, and
// nothing behind it is painted for the incoming player until they say they
// are the incoming player.

import { formatDuration } from "./geo.js";
import { esc } from "./ui.js";
import { t } from "./i18n.js";

const $ = (id) => document.getElementById(id);

/**
 * Cover the screen until the named player says they are holding the device.
 *
 * @param {object} o
 * @param {string} o.eyebrow  small line above, usually the round
 * @param {string} o.title    who the device is for
 * @param {string} o.text     what they are about to do
 * @param {string} o.action   the button
 */
export function handoff({ eyebrow, title, text, action }) {
  const el = $("handoff");
  $("hoeyebrow").textContent = eyebrow ?? "";
  $("hotitle").textContent = title;
  $("hotext").innerHTML = text;
  const btn = $("hobtn");
  btn.textContent = action;
  el.hidden = false;
  return new Promise((resolve) => {
    const go = () => {
      btn.removeEventListener("click", go);
      el.hidden = true;
      resolve();
    };
    btn.addEventListener("click", go);
    btn.focus();
  });
}

/**
 * The hiding period, played rather than simulated.
 *
 * The hider gets the map to themselves, with everywhere they can reach in the
 * window lit up, and picks one. The panel is out of the way for this: they
 * are not seeking, and the questions, the log and the clock are all the
 * seeker's furniture.
 *
 * Resolves with the chosen station's id.
 *
 * @param {object} o
 * @param {import("./map.js").GameMap} o.gmap
 * @param {object} o.world
 * @param {object} o.start   the stop the round begins at
 * @param {object} o.range   hidingRange() from game.js
 * @param {string} o.name    who is hiding
 * @param {function} o.rng   for "surprise me"
 */
export function hidePhase({ gmap, world, start, range, name, rng = Math.random }) {
  const bar = $("hidebar");
  const app = $("app");
  const pool = range.stops;
  let chosen = null;

  app.classList.add("hiding");
  bar.hidden = false;
  gmap.map.invalidateSize();
  // Frame the choice, not the map: everything outside the window is scenery.
  // The start goes in too, so "how far did I come" stays readable.
  gmap.fitStops([start, ...pool], 44);
  paint();
  describe();

  function paint() {
    gmap.renderReach({
      startId: start.id, reach: range.reach, window: range.minutes,
      chosenId: chosen?.id ?? null,
    });
  }

  function describe() {
    if (!chosen) {
      $("hbtitle").textContent = t("hb.choose", { name });
      $("hbtext").innerHTML = t("hb.chooseText", {
        start: esc(start.name), window: formatDuration(range.minutes), n: pool.length,
      });
      $("hbgo").disabled = true;
      $("hbgo").textContent = t("hb.go");
      return;
    }
    const used = range.reach.minutes[chosen.id];
    const spare = range.minutes - used;
    const where = [chosen.district, chosen.municipality].filter(Boolean);
    $("hbtitle").textContent = chosen.name;
    // The journey first: how much of the head start this costs is the whole
    // decision, and where it is is a footnote to it.
    $("hbtext").innerHTML = t("hb.chosenText", {
      used: formatDuration(used),
      start: esc(start.name),
      left: spare >= 1 ? t("hb.left", { time: formatDuration(spare) }) : t("hb.allSpent"),
      where: where.length ? ` · ${where.map(esc).join(" · ")}` : "",
    });
    $("hbgo").disabled = false;
    $("hbgo").textContent = t("hb.goAt", { name: chosen.name });
  }

  // Clicking a stop that is out of reach is worth answering rather than
  // ignoring: on a big map the difference between "too far" and "I missed"
  // is not obvious, and a dead tap reads as a broken button.
  const previousClick = gmap.onStationClick;
  gmap.onStationClick = (station) => {
    if (station.id === start.id) {
      $("hbtitle").textContent = t("hb.startTitle");
      $("hbtext").textContent = t("hb.startText");
      return;
    }
    if (range.reach.minutes[station.id] > range.minutes) {
      $("hbtitle").textContent = t("hb.tooFarTitle", { name: station.name });
      $("hbtext").innerHTML = t("hb.tooFarText", {
        time: formatDuration(range.reach.minutes[station.id]),
        window: formatDuration(range.minutes),
      });
      $("hbgo").disabled = true;
      return;
    }
    chosen = station;
    paint();
    describe();
  };

  return new Promise((resolve) => {
    const pick = () => {
      chosen = pool[Math.floor(rng() * pool.length)];
      paint();
      describe();
      gmap.map.panTo([chosen.lat, chosen.lon]);
    };
    const done = () => {
      if (!chosen) return;
      $("hbgo").removeEventListener("click", done);
      $("hbrandom").removeEventListener("click", pick);
      gmap.onStationClick = previousClick;
      bar.hidden = true;
      app.classList.remove("hiding");
      gmap.map.invalidateSize();
      resolve(chosen.id);
    };
    $("hbgo").addEventListener("click", done);
    $("hbrandom").addEventListener("click", pick);
  });
}
