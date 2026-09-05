// Keeping a half-played round.
//
// The failure this exists for is dull and total: you close the tab, the phone
// kills the background page to save memory, someone rings, Chrome updates --
// and forty minutes of deduction is gone. Nothing in the game was wrong; the
// game had simply never been written down.
//
// What is written down is the *minimum that cannot be recomputed*, because
// the rest of this codebase is already deterministic and recomputing is much
// safer than serialising. A round is `newGame(world, {seed, startId, ...})`
// plus everything that has happened since, so a snapshot is those arguments
// plus the mutable half of the state -- and restoring is `newGame` again with
// the same arguments, then the mutable half put back over the top. The
// question catalogue, the hiding window, the reachability search and the
// travel view all rebuild themselves from that, exactly as they did the first
// time, which is why none of them appear below.
//
// Three things needed care:
//
//   * **The random stream.** `state.rng` and `hider.rng` are closures. Their
//     whole state is one word (see `mulberry32`), so the position is saved
//     and the generator re-seeded with it -- otherwise a resumed round would
//     keep the clock and quietly reroll the deck and every curse.
//   * **Sets and Maps** do not survive JSON, and a station is stored by id
//     rather than by value, so a restored candidate is the *same object* the
//     rest of the game is comparing against.
//   * **The hiding place is in here**, for the same reason it is in
//     `window.__debug`: the app has to answer from it. Local storage is no
//     more private than the running page, and a player who would read it
//     could read the live state instead -- but it is worth knowing before
//     anyone puts this somewhere shared.
//
// One slot. Two saved games would need a picker and a way to tell them apart,
// and the thing being solved here is losing the round you are in.

import { newGame } from "./game.js";
import { mulberry32 } from "./deck.js";
import { Match } from "./match.js";

const KEY = "hs-save";

// Bumped whenever the shape below changes. An old snapshot is discarded
// rather than half-read: a resumed round that is subtly wrong is worse than
// one that is honestly gone, because it looks exactly like a working game.
const VERSION = 3;

// A round is worth resuming for a day, not a fortnight. Past that it is
// almost always somebody opening the app to start a new game and being asked
// about one they have forgotten.
const KEEP_HOURS = 24;

const ids = (list) => list.map((s) => s.id);
const stations = (world, list) => list.map((id) => world.byId.get(id)).filter(Boolean);

// ------------------------------------------------------------- writing

/**
 * Everything needed to rebuild the round in front of you.
 *
 * @param {object} state   the live game state, or null during the hiding phase
 * @param {object} setup   what `playRound` was called with -- see main.js
 */
export function snapshot(state, setup) {
  const base = {
    v: VERSION,
    at: Date.now(),
    phase: state ? "seeking" : "hiding",
    lang: setup.lang,
    mapId: setup.mapId,
    players: setup.players,
    difficulty: setup.difficulty,
    cards: setup.cards,
    hidingMinutes: setup.hidingMinutes,
    baseSeed: setup.baseSeed,
    match: setup.match ? {
      names: setup.match.names,
      seed: setup.match.seed,
      hidingMinutes: setup.match.hidingMinutes,
      startId: setup.match.startId,
      round: setup.match.round,
      hiderIndex: setup.match.hiderIndex,
      results: setup.match.results.map((r) => ({ ...r, station: r.station.id })),
    } : null,
  };
  if (!state) return base;

  const h = state.hider;
  return {
    ...base,
    seed: state.seed,
    startId: state.startId,
    round: {
      clock: state.clock,
      seekerId: state.seekerId,
      previousStation: state.previousStation,
      status: state.status,
      candidates: ids(state.candidates),
      checked: [...state.checked],
      asked: [...state.asked],
      banned: [...state.bannedQuestions],
      effects: state.effects,
      challenge: packChallenge(state.challenge),
      pendingThermo: state.pendingThermo,
      // Only so the map can redraw the leg the last thermometer was read on.
      lastThermoLeg: state.lastThermoLeg
        ? { from: state.lastThermoLeg.from.id, to: state.lastThermoLeg.to.id }
        : null,
      log: state.log,
      rng: state.rng.position(),
    },
    hider: {
      rng: h.rng.position(),
      handLimit: h.handLimit,
      deck: h.deck,
      hand: h.hand,
      discard: h.discard,
      candidates: ids(h.candidates),
      committed: h.committed ? h.committed.id : null,
    },
  };
}

/** A hangman's guesses are a Set, and the maze is plain data. */
function packChallenge(c) {
  if (!c) return null;
  return c.type === "hangman" ? { ...c, guessed: [...c.guessed] } : c;
}
function unpackChallenge(c) {
  if (!c) return null;
  return c.type === "hangman" ? { ...c, guessed: new Set(c.guessed) } : c;
}

// ------------------------------------------------------------- reading

/**
 * Put the round back.
 *
 * `newGame` runs first with the arguments the round was opened with, which
 * rebuilds everything derived -- and then every mutable field is overwritten,
 * including the two random streams. What newGame did in between (shuffling a
 * deck, choosing a hiding place) is thrown away with them.
 */
export function restore(world, snap) {
  const state = newGame(world, {
    difficulty: snap.difficulty,
    seed: snap.seed,
    startId: snap.startId,
    hidingMinutes: snap.hidingMinutes,
    cards: snap.cards,
  });
  const r = snap.round;
  state.clock = r.clock;
  state.seekerId = r.seekerId;
  state.previousStation = r.previousStation;
  state.status = r.status;
  state.candidates = stations(world, r.candidates);
  state.checked = new Set(r.checked);
  state.asked = new Map(r.asked);
  state.bannedQuestions = new Set(r.banned);
  state.effects = r.effects;
  state.challenge = unpackChallenge(r.challenge);
  state.pendingThermo = r.pendingThermo;
  state.log = r.log;
  state.rng = mulberry32(r.rng);
  if (r.lastThermoLeg) {
    state.lastThermoLeg = {
      from: world.byId.get(r.lastThermoLeg.from),
      to: world.byId.get(r.lastThermoLeg.to),
    };
  }

  const h = state.hider;
  h.rng = mulberry32(snap.hider.rng);
  h.handLimit = snap.hider.handLimit;
  h.deck = snap.hider.deck;
  h.hand = snap.hider.hand;
  h.discard = snap.hider.discard;
  h.candidates = stations(world, snap.hider.candidates);
  h.committed = snap.hider.committed == null ? null : world.byId.get(snap.hider.committed);
  return state;
}

/** The match this round belongs to, rebuilt from the snapshot, or null. */
export function restoreMatch(world, snap) {
  if (!snap.match) return null;
  const m = new Match({
    names: snap.match.names,
    seed: snap.match.seed,
    hidingMinutes: snap.match.hidingMinutes,
    startId: snap.match.startId,
  });
  m.round = snap.match.round;
  m.hiderIndex = snap.match.hiderIndex;
  m.results = snap.match.results.map((r) => ({ ...r, station: world.byId.get(r.station) }));
  return m;
}

// ------------------------------------------------------------- storage

/** Local storage can be absent, full, or refuse outright in a private window.
 *  None of that is worth losing a round over, so every path here is quiet:
 *  the game plays exactly as it did before this file existed. */
export function write(snap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(snap));
    return true;
  } catch (err) {
    return false;
  }
}

export function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (snap?.v !== VERSION) { clear(); return null; }
    if (Date.now() - snap.at > KEEP_HOURS * 3600e3) { clear(); return null; }
    return snap;
  } catch (err) {
    return null;   // corrupt, or storage that throws on read
  }
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch (err) { /* nothing to do */ }
}
