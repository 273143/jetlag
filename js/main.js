// Bootstrap: pick a map, run the start screen, wire the game together.

import { loadWorld, MAPS } from "./data.js";
import {
  newGame, ask, travel, challengeStep, questionById, journey,
  randomStart, hidingRange, hidingDefault, hidingChoices, finalScore,
} from "./game.js";
import { GameMap } from "./map.js";
import { UI, esc } from "./ui.js";
import { DIFFICULTY } from "./rules.js";
import { Match } from "./match.js";
import { handoff, hidePhase } from "./hidephase.js";
import { formatDuration } from "./geo.js";
import { packUrls, estimateMb, packStatus, downloadPack, clearPack } from "./offline.js";
import { keepAwake, releaseWake } from "./wakelock.js";
import { LANGS, initLang, setLang, t, applyStatic, currentLang } from "./i18n.js";
import {
  snapshot, restore, restoreMatch,
  write as writeSave, read as readSave, clear as clearSave,
} from "./save.js";

const $ = (id) => document.getElementById(id);

const worlds = new Map();
async function getWorld(id) {
  if (!worlds.has(id)) worlds.set(id, await loadWorld(MAPS.find((m) => m.id === id).file));
  return worlds.get(id);
}

let difficulty = "fair";
let world = null;
let players = "solo";            // "solo" or "pass" -- two people, one device
let cards = true;                // false is the pure-deduction game
let hidingMinutes = null;        // null means whatever the map's default is

// The run itself, declared up here because ?go=1 starts it from the parameter
// handling below, which sits above the code that uses them.
let gmap = null;
let ui = null;
let match = null;
let baseSeed = 0;

// ---- keeping the round -------------------------------------------------

// Everything about how this round was set up, which is half of what a
// snapshot is; the other half is whatever has happened since. See js/save.js.
const setup = () => ({
  lang: currentLang(), mapId: world?.id, players, difficulty, cards,
  hidingMinutes, baseSeed, match,
});

/** Write the round down. Called after every action that moves the state, so
 *  there is never more than one click of progress to lose. */
function keep(state) {
  if (world) writeSave(snapshot(state, setup()));
}

// A phone can kill a backgrounded tab without warning and without running
// anything. Nothing here should be new -- every action saves already -- but
// this is the one line that covers a handler somebody forgets to add later.
addEventListener("pagehide", () => {
  if (window.__debug?.phase === "seeking") keep(window.__debug.state);
});

// ---- language ----------------------------------------------------------

// The whole card is repainted rather than reloaded, because the fields below
// are built from JavaScript and half of them describe the map that is already
// loaded. Choosing a language is a setting, not a restart.
const params = new URLSearchParams(location.search);
let lang = initLang(params.get("lang"));

const langChoices = $("langchoices");
for (const l of LANGS) {
  const b = document.createElement("button");
  b.dataset.lang = l.id;
  b.innerHTML = `<b>${l.name}</b>`;
  b.addEventListener("click", () => selectLang(l.id));
  langChoices.append(b);
}

function selectLang(id) {
  lang = setLang(id);
  for (const o of langChoices.children) o.setAttribute("aria-pressed", String(o.dataset.lang === id));
  applyStatic();
  repaintStart();
}

/** Everything on the start screen that JavaScript wrote rather than the
 *  shell: the map blurbs, the three pickers, and the offline block.
 *
 *  Called once on the way in as well as on every language change, which is
 *  before any map file has landed -- hence the guard. Half of this card
 *  describes a map, and at that moment there is not one yet. */
function repaintStart() {
  for (const b of modeChoices.children) fillChoice(b, `mode.${b.dataset.mode}`);
  for (const b of cardChoices.children) fillChoice(b, `cards.${b.dataset.cards}`);
  for (const b of diffChoices.children) fillChoice(b, `diff.${b.dataset.diff}`);
  selectPlayers(players);
  showResumeCard();
  if (!world) return;
  for (const m of MAPS) if (worlds.has(m.id)) describe(mapButton(m.id), worlds.get(m.id));
  buildHidingChoices();
  refreshOffline();
}

/** A picker button: a name and the line underneath explaining it. */
function fillChoice(btn, key) {
  btn.innerHTML = `<b>${esc(t(`${key}.name`))}</b><small>${esc(t(`${key}.hint`))}</small>`;
}

// ---- the round you left ------------------------------------------------

// A snapshot found at boot, if there is one. Read once: the start screen may
// be repainted several times before anyone presses anything, and re-reading
// storage each time buys nothing.
const held = readSave();

/** Say what is being offered, in enough detail to recognise it. A resumed
 *  round is only worth offering if you can tell which one it is. */
function showResumeCard() {
  const box = $("resume");
  if (!held) { box.hidden = true; return; }
  const map = t(`map.${held.mapId}.name`) || held.mapId;
  const clock = formatDuration(held.round?.clock ?? 0);
  const names = held.match?.names ?? [];
  const hider = names[held.match?.hiderIndex ?? 0];
  const seeker = names[1 - (held.match?.hiderIndex ?? 0)];
  const what =
    held.phase === "hiding" ? t("resume.hiding", { map, round: held.match?.round ?? 1, hider })
    : held.round?.status === "found" ? t("resume.found", { map, clock })
    : held.match ? t("resume.match", { map, round: held.match.round, seeker, hider, clock })
    : t("resume.solo", { map, clock, n: held.round?.candidates.length ?? 0 });
  const at = new Date(held.at).toLocaleTimeString(currentLang(), { hour: "2-digit", minute: "2-digit" });
  $("resumewhat").textContent = `${what} · ${t("resume.saved", { time: at })}`;
  box.hidden = false;
}

$("resumego").addEventListener("click", () => resume(held));
$("resumedrop").addEventListener("click", () => {
  clearSave();
  $("resume").hidden = true;
});

// ---- map picker --------------------------------------------------------

const mapChoices = $("mapchoices");
const mapButton = (id) => [...mapChoices.children].find((o) => o.dataset.map === id);

// The name and the one-line description are translated rather than read off
// the data file: the map is Czech geography either way, but "the whole
// region, by train" is prose, and prose is the dictionary's business. A map
// nobody has translated falls back to what was baked into its file.
function describe(btn, w) {
  btn.querySelector("b").textContent = t(`map.${w.id}.name`) || w.name;
  btn.querySelector("small").textContent = t("start.mapMeta", {
    blurb: t(`map.${w.id}.blurb`) || w.blurb || "",
    n: w.stations.length, l: w.lines?.length ?? 0,
  });
}

for (const m of MAPS) {
  const b = document.createElement("button");
  b.dataset.map = m.id;
  b.innerHTML = `<b>…</b><small>${esc(t("start.loading"))}</small>`;
  b.addEventListener("click", () => selectMap(m.id));
  mapChoices.append(b);
  // Label each map as soon as its file lands, so the picker is informative
  // before anything is chosen.
  getWorld(m.id).then((w) => describe(b, w)).catch(() => {
    b.querySelector("b").textContent = m.id;
    b.querySelector("small").textContent = t("start.mapFailed");
    b.disabled = true;
  });
}

async function selectMap(id) {
  for (const o of mapChoices.children) o.setAttribute("aria-pressed", String(o.dataset.map === id));
  world = await getWorld(id);
  describe(mapButton(id), world);
  $("credit").textContent = world.attribution;
  $("play").disabled = false;
  buildHidingChoices();
  refreshOffline();
}

// ---- the hiding period --------------------------------------------------

// Per map, because reachability is: half an hour is most of Brno's tram
// network and about a dozen village halts on the region map.
function buildHidingChoices() {
  if (!world) return;
  const box = $("hidechoices");
  box.innerHTML = "";
  const options = hidingChoices(world);
  if (!options.includes(hidingMinutes)) hidingMinutes = hidingDefault(world);
  for (const m of options) {
    const b = document.createElement("button");
    b.dataset.minutes = String(m);
    b.innerHTML = `<b>${formatDuration(m)}</b>`;
    b.setAttribute("aria-pressed", String(m === hidingMinutes));
    b.addEventListener("click", () => {
      hidingMinutes = m;
      for (const o of box.children) o.setAttribute("aria-pressed", String(o === b));
    });
    box.append(b);
  }
}

// ---- offline ------------------------------------------------------------

if ("serviceWorker" in navigator) {
  // ?fresh=1 tears the service worker down and empties the app cache, then
  // reloads clean. The tile caches are left alone, because those are megabytes
  // somebody may have downloaded over a phone connection.
  //
  // Worth having as a real escape hatch rather than a debugging note: a
  // service worker that has cached the app is invisible until it is wrong,
  // and then it looks exactly like the code not having changed. Reaching for
  // devtools is the usual answer; this is quicker and works on a phone, where
  // there are no devtools to reach for.
  if (new URLSearchParams(location.search).has("fresh")) {
    (async () => {
      const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = await caches.keys().catch(() => []);
      await Promise.all(keys.filter((k) => k.startsWith("hs-shell-")).map((k) => caches.delete(k)));
      const url = new URL(location.href);
      url.searchParams.delete("fresh");
      location.replace(url);
    })();
  } else {
    // After load, so it never competes with the first paint.
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
}

let downloading = false;

async function refreshOffline() {
  if (downloading || !world) return;
  const state = $("offstate"), box = $("offbtns");
  if (!("caches" in window) || !("serviceWorker" in navigator)) {
    state.textContent = t("off.cannot");
    box.hidden = true;
    return;
  }
  // Sizes come from the map data alone, so they are shown before storage is
  // consulted -- if storage is slow or blocked the buttons are still usable
  // and still honest about what they will cost.
  const mb = (lvl) => Math.round(estimateMb(packUrls(world, lvl)));
  const name = t(`map.${world.id}.name`) || world.name;
  $("offmap").textContent = t("off.btnMap", { mb: mb("map") });
  $("offphotos").textContent = t("off.btnPhotos", { mb: mb("photos") });
  box.hidden = false;
  for (const b of box.children) b.disabled = false;
  state.textContent = t("off.save", { name });

  try {
    const [map, photos] = await Promise.all([
      packStatus(world, "map"), packStatus(world, "photos"),
    ]);
    if (photos.fraction > 0.98) {
      state.innerHTML = `<b style="color:var(--candidate)">${esc(t("off.full", { name }))}</b>`;
    } else if (map.fraction > 0.98) {
      state.innerHTML = `<b style="color:var(--candidate)">${esc(t("off.mapOnly", { name }))}</b>`
        + esc(t("off.addPhotos"));
    } else if (map.fraction > 0.02) {
      state.textContent = t("off.partial", { name, pct: Math.round(map.fraction * 100) });
    }
  } catch (err) {
    state.textContent = t("off.unreadable", { name, err: err.message });
  }
}

async function runDownload(level) {
  if (downloading || !world) return;
  downloading = true;
  const state = $("offstate"), bar = $("offbar"), fill = bar.querySelector("i");
  for (const b of $("offbtns").children) b.disabled = true;
  bar.hidden = false;
  const started = Date.now();
  const name = t(`map.${world.id}.name`) || world.name;
  try {
    const { total, failed } = await downloadPack(world, {
      level,
      onProgress: (done, all, bad) => {
        fill.style.width = `${(done / all) * 100}%`;
        const secs = (Date.now() - started) / 1000;
        const left = done > 40 ? Math.round((all - done) * (secs / done)) : 0;
        state.textContent = t("off.saving", { name, done, all })
          + (left > 5 ? t("off.savingLeft", { secs: left }) : "")
          + (bad ? t("off.savingBad", { bad }) : "");
      },
    });
    if (failed) {
      state.innerHTML = t("off.savedSome", { ok: total - failed, total, failed });
    }
  } catch (err) {
    state.textContent = t("off.saveError", { err: err.message });
  } finally {
    downloading = false;
    setTimeout(() => { bar.hidden = true; fill.style.width = "0"; }, 1200);
    await refreshOffline();
  }
}

// ---- the tile nag ------------------------------------------------------

// The failure this exists to catch is a specific one, and it has happened:
// you set a game up at home on wifi, play a round to see that it works, and
// board a train the next morning having never pressed Save. The deduction
// half is fine -- the shell and both map files are precached on install, so
// questions, deck, clock and candidate set all run with no signal. What is
// missing is the map *picture*, and a game about closing a net on a map is
// not much of a game against a flat grey rectangle.
//
// Pressing Start is the right moment to say so, because it is the last moment
// you are reliably still standing somewhere with bandwidth. The offline block
// is eight lines further down the same card and is evidently easy to read
// past; a sheet in front of the button is not.
//
// Two restraints, because a warning shown every time is a warning nobody
// reads. Only when the pack is essentially absent -- a part-saved map is
// usually a download that dropped a few hundred tiles, not an unprepared
// player -- and only once per session, whichever button they pick.
let nagged = false;

async function tilesAreMissing() {
  // Nothing actionable when the network is already gone, and the offline
  // block has said its piece by then anyway.
  if (nagged || downloading || !world) return false;
  if (!("caches" in window) || navigator.onLine === false) return false;
  try {
    const map = await packStatus(world, "map");
    return map != null && map.fraction < 0.5;
  } catch (err) {
    return false;   // storage unreadable: saying nothing beats guessing wrong
  }
}

function nagAboutTiles() {
  const mb = Math.round(estimateMb(packUrls(world, "map")));
  const name = t(`map.${world.id}.name`) || world.name;
  $("sheet").innerHTML =
    `<h2>${esc(t("nag.title", { name }))}</h2>`
    + `<p class="sheetnote">${t("nag.body", { mb })}</p>`;

  const row = document.createElement("div");
  row.className = "row";

  const save = document.createElement("button");
  save.className = "btn";
  save.textContent = t("nag.save", { mb });
  // Back to the start screen rather than straight into the round: the
  // download has a progress bar there, and starting a run on top of six
  // parallel tile fetches is a bad first minute.
  save.addEventListener("click", () => { closeSheet(); runDownload("map"); });

  const anyway = document.createElement("button");
  anyway.className = "btn ghost";
  anyway.textContent = t("nag.anyway");
  anyway.addEventListener("click", () => { closeSheet(); start(); });

  row.append(save, anyway);
  $("sheet").append(row);
  $("modal").hidden = false;
}

// The UI owns the modal once a round is running, but this one is shown before
// there is a UI to own anything, so it opens and closes the elements itself.
function closeSheet() { $("modal").hidden = true; $("sheet").innerHTML = ""; }

$("offmap").addEventListener("click", () => runDownload("map"));
$("offphotos").addEventListener("click", () => runDownload("photos"));
$("offclear").addEventListener("click", async () => {
  await clearPack();
  await refreshOffline();
});

// ---- who is playing ----------------------------------------------------

// Two people on one device is the rulebook's actual game, as close as a phone
// can get to it: one hides, the other seeks, and the roles swap. What the app
// takes over is the answering -- it knows where the hider went, so it replies
// truthfully on their behalf -- and the card play, because handing the phone
// back for every question is not a game anyone would finish.
const modeChoices = $("modechoices");
for (const id of ["solo", "pass"]) {
  const b = document.createElement("button");
  b.dataset.mode = id;
  fillChoice(b, `mode.${id}`);
  b.setAttribute("aria-pressed", String(id === players));
  b.addEventListener("click", () => selectPlayers(id));
  modeChoices.append(b);
}

// ---- cards, or no cards ------------------------------------------------

// The hider deck is the half of the rulebook that is not deduction: draws,
// time bonuses, vetoes, curses and minigames. It is also the half that turns
// a twenty-minute round into a forty-minute one and can decide it on a die,
// which is a fine game and not always the game you want on a tram.
//
// Turning it off removes exactly that and nothing else. The questions, the
// candidate set, the hiding window and the travel model are untouched, so the
// score becomes the clock and the clock becomes entirely your own doing.
const cardChoices = $("cardchoices");
for (const [id, on] of [["on", true], ["off", false]]) {
  const b = document.createElement("button");
  b.dataset.cards = id;
  fillChoice(b, `cards.${id}`);
  b.setAttribute("aria-pressed", String(on === cards));
  b.addEventListener("click", () => selectCards(on));
  cardChoices.append(b);
}

function selectCards(on) {
  cards = on;
  for (const o of cardChoices.children) {
    o.setAttribute("aria-pressed", String((o.dataset.cards === "on") === cards));
  }
}

function selectPlayers(id) {
  players = id;
  for (const o of modeChoices.children) o.setAttribute("aria-pressed", String(o.dataset.mode === id));
  // The hider personality is the app's; with a person hiding there is nothing
  // for it to decide, so the choice goes away rather than sitting there lying.
  $("difffield").hidden = id === "pass";
  $("namefield").hidden = id !== "pass";
  $("play").textContent = id === "pass" ? t("start.playMatch") : t("start.play");
}

const playerNames = () => [
  ($("p1").value || "").trim() || t("start.p1"),
  ($("p2").value || "").trim() || t("start.p2"),
];

// ---- hider picker ------------------------------------------------------

const diffChoices = $("diffchoices");
for (const d of Object.values(DIFFICULTY)) {
  const b = document.createElement("button");
  b.dataset.diff = d.id;
  fillChoice(b, `diff.${d.id}`);
  b.setAttribute("aria-pressed", String(d.id === difficulty));
  b.addEventListener("click", () => {
    difficulty = d.id;
    for (const o of diffChoices.children) o.setAttribute("aria-pressed", String(o === b));
  });
  diffChoices.append(b);
}

$("seed").value = String(Math.floor(Math.random() * 1e6));
$("play").addEventListener("click", async () => {
  if (await tilesAreMissing()) { nagged = true; nagAboutTiles(); return; }
  start();
});

// ?map=brno&seed=123&hider=devious&lang=en&cards=0&go=1 opens straight into a
// specific round, which makes a run shareable and gives the screenshot tests
// something to bite on.
if (params.has("seed")) $("seed").value = params.get("seed");
if (params.has("hider") && DIFFICULTY[params.get("hider")]) {
  difficulty = params.get("hider");
  for (const o of diffChoices.children) o.setAttribute("aria-pressed", String(o.dataset.diff === difficulty));
}
if (params.has("hiding")) hidingMinutes = Number(params.get("hiding")) || null;
if (params.has("cards")) selectCards(params.get("cards") !== "0");
// initLang already ran, up where the picker is built; this only paints it.
selectLang(lang);
const wanted = params.get("map");
await selectMap(MAPS.some((m) => m.id === wanted) ? wanted : MAPS[0].id);
selectPlayers(params.get("players") === "2" ? "pass" : "solo");
if (params.has("go")) start();

// ---- the run -----------------------------------------------------------

/** Tear the start screen down and put the board up. Shared by a new game and
 *  a resumed one, which differ only in where the state comes from. */
function openBoard() {
  $("start")?.remove();
  $("app").hidden = false;

  // One map for the whole match. Rebuilding five hundred markers between
  // rounds is slow and pointless; what has to be thrown away is what was
  // drawn on it, which is gmap.reset().
  gmap = new GameMap($("map"), world, {
    onStationClick: (station) => {
      if (!ui) return;
      gmap.markers.get(station.id)
        .bindPopup(ui.stationPopup(station), { closeButton: false, minWidth: 210 })
        .openPopup();
    },
  });
}

function start() {
  // Everything the start screen holds has to be read before it is torn down.
  baseSeed = Number($("seed").value) || Math.floor(Math.random() * 1e6);
  const names = playerNames();
  // Starting is choosing to abandon whatever was held. Done here rather than
  // on the Continue card's discard button so that every way of starting a new
  // game clears it, including ?go=1.
  clearSave();
  openBoard();

  if (players === "pass") {
    match = new Match({ names, seed: baseSeed, hidingMinutes });
  }
  playRound();
}

/**
 * Pick a saved round up where it was left.
 *
 * Deliberately in the language it was played in rather than the one the start
 * screen happens to be showing: the log is a transcript, already written, and
 * a Czech transcript under an English panel reads worse than a language that
 * quietly went back to what you were using.
 */
async function resume(snap) {
  try {
    selectLang(snap.lang);
    world = await getWorld(snap.mapId);
    players = snap.players;
    difficulty = snap.difficulty;
    cards = snap.cards;
    hidingMinutes = snap.hidingMinutes;
    baseSeed = snap.baseSeed;
    match = restoreMatch(world, snap);
    openBoard();
    // Saved before the handover, so the hider had not chosen yet: the round
    // has nothing in it to restore and simply starts again.
    if (snap.phase === "hiding") { playRound(); return; }
    beginRound(restore(world, snap), null);
  } catch (err) {
    // A snapshot that will not load is worse than no snapshot: it would sit
    // on the start screen offering a round that never opens.
    clearSave();
    location.reload();
  }
}

/**
 * One round, from the handover to the find.
 *
 * In a match this is: pass the phone to the hider, let them travel and go to
 * ground, pass it back, then play exactly the round the solo game plays --
 * because from the seeker's side there is no difference. The hider is at one
 * stop, the answers are true of that stop, and the clock is running.
 */
async function playRound() {
  // The hiding phase is a screen someone is reading and tapping, and the
  // round that follows is twenty minutes of looking at a map without touching
  // it. beginRound asks again; the lock is per round rather than per session
  // because rounds are where it matters and roundOver() gives it straight back.
  keepAwake();

  const seed = match ? match.roundSeed() : baseSeed;
  const start = match?.startId != null
    ? world.byId.get(match.startId)
    : randomStart(world, seed);
  const range = hidingRange(world, start.id, hidingMinutes);

  // A handle on the round before it starts, so the console -- and
  // tools/2ptest.html -- can reach the hiding phase, which is a whole screen
  // of the game that happens before there is any game state to expose.
  window.__debug = { phase: "hiding", gmap, match, start, range };
  // Written down before the handover: closing the app while the hider is
  // still choosing resumes into the same round rather than losing it. There
  // is no state to keep yet, only how the round was set up.
  keep(null);

  let hiderStationId = null;
  if (match) {
    await handoff({
      eyebrow: t("ho.round", { n: match.round }),
      title: t("ho.hides", { name: match.hiderName }),
      text: t("ho.hidesText", {
        start: esc(start.name), window: formatDuration(range.minutes),
        other: esc(match.seekerName),
      }),
      action: t("ho.hidesBtn", { name: match.hiderName }),
    });
    hiderStationId = await hidePhase({
      gmap, world, start, range, name: match.hiderName,
    });
    // Reset before the seeker sees anything: the hider leaves the map zoomed
    // in on where they went, which would hand over the answer for nothing.
    gmap.reset();
    await handoff({
      eyebrow: t("ho.round", { n: match.round }),
      title: t("ho.seeks", { name: match.seekerName }),
      text: t("ho.seeksText", {
        other: esc(match.hiderName), window: formatDuration(range.minutes),
        start: esc(start.name),
      }),
      action: t("ho.seeksBtn", { name: match.seekerName }),
    });
  }

  const state = newGame(world, {
    // A person has already chosen a stop, so there is nothing for a devious
    // hider to be devious with: this round is answered from one place.
    difficulty: match ? "fair" : difficulty,
    seed, startId: start.id, hidingMinutes, hiderStationId, cards,
  });
  // Frame the round rather than the map. The candidate set used to be the
  // whole network, so the whole network was the right view; now it opens as a
  // cluster an hour wide, and fitting the bbox of a region leaves the game
  // being played in one corner of the screen.
  beginRound(state, (s) => [start, ...s.candidates]);
}

/**
 * Wire a round up and put it on screen.
 *
 * Split out of playRound because a resumed round needs every line of it and
 * none of the hiding phase above: from here down there is no difference
 * between a state `newGame` just built and one `js/save.js` put back.
 *
 * @param {function|null} frame  which stops to fit the map to, or null to
 *   frame what is left -- a resumed round opens on the search still to do,
 *   not on where it started an hour ago.
 */
function beginRound(state, frame) {
  // From here to the find the phone is a game board: minutes of looking at a
  // map without touching it, and -- in a match -- a handover that a lock
  // screen would turn into a spoiler.
  if (state.status === "playing") keepAwake(); else releaseWake();

  let recorded = false;
  const roundOver = () => {
    if (state.status !== "found") return;
    // Found. Reading a result sheet is not worth holding the screen open.
    releaseWake();
    if (!match || recorded) return;
    recorded = true;
    match.record(state, finalScore(state));
  };

  ui?.dispose();
  ui = new UI(state, gmap, {
    ask: (q) => {
      const res = ask(state, q);
      if (!res.ok) return;
      gmap.showConstraint(state, q, res.answer);
      ui.refresh();
      keep(state);
    },
    travel: (station) => {
      const before = state.pendingThermo;
      const res = travel(state, station.id);
      if (!res.ok) return;
      gmap.markers.get(station.id).closePopup();
      // If the thermometer just resolved, record the leg so the map can draw it.
      if (before && !state.pendingThermo) {
        state.lastThermoLeg = { from: world.byId.get(before.fromId), to: station };
        gmap.showConstraint(state, questionById(state, before.qid), null);
      }
      roundOver();
      ui.refresh();
      keep(state);
    },
    challenge: (input) => { challengeStep(state, input); keep(state); },
    nextRound: () => {
      match.advance(state.hider.committed.id);
      gmap.reset();
      playRound();
    },
    // "New run" reloads, and a reload would otherwise land on a start screen
    // offering to continue the round that has just been finished with.
    newRun: () => { clearSave(); location.reload(); },
  }, { match });

  gmap.render(state);
  // Once, when the round opens: the set shrinks all through a run, and a map
  // that kept re-zooming under the player's hands would be unusable.
  gmap.fitStops(frame ? frame(state) : [seekerStop(state), ...state.candidates]);
  // Exposed for the console while playing, and for tools/uitest.html.
  window.__debug = { phase: "seeking", state, ui, gmap, match,
                     start: world.byId.get(state.startId),
                     range: state.hiding,
                     ask, travel, challengeStep, journey };
  keep(state);
}

const seekerStop = (state) => state.world.byId.get(state.seekerId);
