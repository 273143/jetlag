// Game state machine. UI-agnostic: it mutates state, appends to the log and
// returns a small result object; rendering is entirely ui.js's problem.

import { RULES } from "./rules.js";
import { buildQuestions, filterByAnswer } from "./questions.js";
import { Hider } from "./hider.js";
import { CURSES, curseCost } from "./curses.js";
import { mulberry32 } from "./deck.js";
import { travelTimes } from "./data.js";
import { hasTimetable, boardAt, rideCost, timetableTimes } from "./timetable.js";
import { haversine, formatKm, formatDuration, formatClock } from "./geo.js";

/**
 * Where a round begins.
 *
 * The rulebook draws the starting stop at random and both sides set off from
 * it; the old code used the network hub, which meant every Brno round opened
 * at the main station and every regional round at Brno hl.n. -- the same
 * opening board, the same first three questions, every single time.
 *
 * Stops with one edge are skipped. A terminus is a fine place to hide and a
 * poor place to start: the first move is forced, and on the region map it is
 * forced onto a branch line.
 */
export function randomStart(world, seed) {
  const rng = mulberry32((seed ^ 0x85ebca6b) >>> 0);
  const pool = world.stations.filter((s) => (world.adj[s.id]?.length ?? 0) >= 2);
  const list = pool.length ? pool : world.stations;
  return list[Math.floor(rng() * list.length)];
}

/** The window a map hides in by default, and what the start screen offers. */
export const hidingDefault = (world) => (RULES.maps[world.id] ?? {}).hidingMinutes ?? 45;
export const hidingChoices = (world) =>
  (RULES.maps[world.id] ?? {}).hidingChoices ?? [30, 45, 60];

/** Journey times out of a stop with the clock at zero -- the hiding period,
 *  which runs before the seekers' clock starts. */
function reachAt(world, fromId, clock = 0) {
  return hasTimetable(world)
    ? timetableTimes(world, fromId, clock)
    : travelTimes(world, fromId, (RULES.maps[world.id] ?? {}).transferMinutes ?? 0);
}

/**
 * Everywhere the hider could have got to, and how long they had to do it.
 *
 * This is the whole opening position: the stops inside the window are the
 * seekers' candidate set before a single question, and the same list is what
 * the hider -- human or otherwise -- is allowed to choose from.
 *
 * `minutes` is the window actually granted, which is the one asked for unless
 * too few stops sat inside it; see RULES.hiding.
 */
export function hidingRange(world, startId, wanted = null) {
  const reach = reachAt(world, startId, 0);
  const cfg = RULES.hiding;
  const asked = wanted ?? hidingDefault(world);
  const inside = (limit) =>
    world.stations.filter((s) => s.id !== startId && reach.minutes[s.id] <= limit);
  let minutes = asked;
  let stops = inside(minutes);
  while (stops.length < cfg.minStops && minutes < asked * cfg.widenCap) {
    minutes += cfg.widenStep;
    stops = inside(minutes);
  }
  return { reach, minutes, asked, widened: minutes > asked, stops };
}

/**
 * @param {object} opts
 * @param {number} [opts.startId]        where the round begins; random if absent
 * @param {number} [opts.hidingMinutes]  the head start, in minutes
 * @param {number} [opts.hiderStationId] a human hider's chosen stop
 */
export function newGame(world, {
  difficulty = "fair", seed = Date.now(), startId = null,
  hidingMinutes = null, hiderStationId = null,
} = {}) {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const start = startId != null ? world.byId.get(startId) : randomStart(world, seed);
  const hiding = hidingRange(world, start.id, hidingMinutes);
  const transfer = (RULES.maps[world.id] ?? {}).transferMinutes ?? 0;
  const state = {
    world,
    questions: buildQuestions(world),
    difficulty,
    seed,
    rng,
    seekerId: start.id,
    startId: start.id,
    hiding,
    previousStation: null,
    clock: 0,
    asked: new Map(),
    bannedQuestions: new Set(),
    effects: {},
    challenge: null,
    pendingThermo: null,
    // Not every stop on the map: only the ones the hider had time to reach.
    candidates: hiding.stops.slice(),
    checked: new Set([start.id]),
    log: [],
    status: "playing",
    transfer,
    travel: null,
    // The radar distances this map offers, so the map can draw them as rings
    // around the seeker: the question is a circle, and it should look like one.
    rangeRings: (RULES.maps[world.id] ?? {}).radarKm ?? [],
  };
  state.travel = reachFrom(state);
  state.hider = new Hider(world, difficulty, seed, {
    pool: hiding.stops, reach: hiding.reach, window: hiding.minutes,
    stationId: hiderStationId,
  });
  state.hider.eliminate(start);
  state.candidates = state.candidates.filter((s) => s.id !== start.id);

  say(state, "system",
    `You and the hider both set out from ${start.name} at ${formatClock(RULES.startClock)}. ` +
    `They had ${formatDuration(hiding.minutes)} to travel and hide` +
    (hiding.widened
      ? ` — ${formatDuration(hiding.asked)} was asked for, but so little is reachable from here ` +
        `that the window was opened up until ${RULES.hiding.minStops} stops were in play`
      : "") +
    `. That puts them at one of ${state.candidates.length} stops. The clock is yours now.`);
  return state;
}

export const seeker = (state) => state.world.byId.get(state.seekerId);

/** Journey times to everywhere, from where the seeker stands, at the time it
 *  is now. On a timetabled map this is the board searched to exhaustion, so
 *  the estimate the map shows and the price the board charges are the same
 *  arithmetic. Maps without a timetable keep the old line-aware shortest path. */
export function reachFrom(state, fromId = state.seekerId) {
  return hasTimetable(state.world)
    ? timetableTimes(state.world, fromId, state.clock)
    : travelTimes(state.world, fromId, state.transfer);
}

/** The services leaving the seeker's stop right now, or null on a map with no
 *  timetable, where travel is not restricted to one line at a time. */
export function board(state) {
  if (!hasTimetable(state.world)) return null;
  return boardAt(state.world, state.seekerId, state.clock);
}

/**
 * The first leg of the journey to `toId`: where one ride from here gets you.
 *
 * With travel restricted to one line at a time, "go to that station" is a
 * plan rather than a move. This turns the plan into the move in front of you,
 * so the map can still be used to point at somewhere far away.
 */
export function nextHop(state, toId) {
  if (!hasTimetable(state.world)) return toId;
  if (toId === state.seekerId) return toId;
  if (directRide(state, toId)) return toId;
  const legs = state.travel.legs?.(toId) ?? [];
  return legs.length ? legs[0].to : null;
}

/** The cheapest way to reach `toId` in a single ride from where you stand,
 *  or null if no service from this stop goes there. */
export function directRide(state, toId) {
  const b = board(state);
  if (!b) return null;
  let best = null;
  for (const entry of b) {
    for (const stop of entry.stops) {
      if (stop.id !== toId) continue;
      const cost = rideCost(state.world, entry, stop, state.clock);
      if (!best || cost.minutes < best.cost.minutes) best = { entry, stop, cost };
    }
  }
  return best;
}
export const questionById = (state, id) => state.questions.find((q) => q.id === id);

function say(state, who, text, extra = {}) {
  state.log.push({ who, text, clock: state.clock, ...extra });
}

// ---------------------------------------------------------------- asking

/** Why a question cannot be asked right now, or null if it can. */
export function askBlocker(state, q) {
  if (state.status !== "playing") return "The run is over.";
  if (state.challenge) return "Clear the curse in front of you first.";
  if (state.pendingThermo) return "Finish your thermometer first: travel far enough to read it.";
  if (state.bannedQuestions.has(q.id)) return "The Drained Brain wiped this question from your mind.";
  const blocked = state.effects.blockedCategory;
  if (blocked && blocked.cat === q.cat && blocked.questions > 0)
    return `Spotty Memory: no ${q.cat} questions for another ${blocked.questions} question(s).`;
  if (state.effects.mustVisit != null)
    return `The travel agent booked you into ${state.world.byId.get(state.effects.mustVisit).name}. Go there first.`;
  if (state.effects.forcedReturn != null)
    return `The U-Turn sends you back to ${state.world.byId.get(state.effects.forcedReturn).name} first.`;
  if (state.effects.noRepeatAsk && state.effects.lastAskedAt === state.seekerId)
    return "The Urban Explorer will not let you ask twice from the same station. Move on.";
  return null;
}

export function ask(state, q) {
  const blocker = askBlocker(state, q);
  if (blocker) return { ok: false, reason: blocker };

  const me = seeker(state);

  // A thermometer is a promise to travel, so it is only half asked here.
  if (q.cat === "thermometer") {
    charge(state, RULES.askMinutes.thermometer);
    state.pendingThermo = { qid: q.id, fromId: state.seekerId, km: q.travelKm };
    bumpAsked(state, q);
    say(state, "seeker", q.text);
    say(state, "hider", `Understood. Tell me when you have gone ${q.travelKm} km from ${me.name}.`);
    tickEffects(state, q);
    return { ok: true, pending: true };
  }

  const ctx = { seeker: me };
  charge(state, RULES.askMinutes[q.cat]);
  bumpAsked(state, q);
  say(state, "seeker", q.text, { context: q.context?.(ctx) });

  if (state.hider.wantsRandomize(q, ctx)) {
    state.hider.play(state.hider.find("randomize"));
    const pool = state.questions.filter((x) =>
      x.cat === q.cat && x.id !== q.id && !state.asked.has(x.id) && !state.bannedQuestions.has(x.id));
    if (pool.length) {
      const swap = pool[Math.floor(state.rng() * pool.length)];
      say(state, "hider", `Randomize. You do not get that one — answer this instead: "${swap.text}"`);
      bumpAsked(state, swap);
      q = swap;
    }
  }

  if (state.hider.wantsVeto(q, ctx)) {
    state.hider.play(state.hider.hand.find((c) => c.kind === "powerup" && c.id === "veto"));
    say(state, "hider", "Veto. You get no answer to that one.", { veto: true });
    tickEffects(state, q);
    return { ok: true, veto: true };
  }

  const answer = state.hider.answer(q, ctx);
  const before = state.candidates.length;
  state.candidates = filterByAnswer(q, ctx, state.world, state.candidates, answer);
  say(state, "hider", q.format(answer), {
    photo: q.visual ? answer : null,
    cut: before - state.candidates.length,
  });

  hiderDraws(state, q);
  tickEffects(state, q);
  maybePowerups(state);
  maybeCurse(state);
  checkCornered(state);
  return { ok: true, answer, eliminated: before - state.candidates.length };
}

function bumpAsked(state, q) {
  state.asked.set(q.id, (state.asked.get(q.id) || 0) + 1);
}

/** Repeat questions cost the hider double, then triple, and so on. */
export function repeatMultiplier(state, q) {
  return RULES.repeatCostMultiplier ? Math.max(1, state.asked.get(q.id) || 1) : 1;
}

function hiderDraws(state, q) {
  const { draw, keep } = RULES.draw[q.cat];
  const mult = repeatMultiplier(state, q);
  const bonus = state.effects.chalice > 0 ? 1 : 0;
  if (bonus) state.effects.chalice--;
  const ctx = { desperate: state.candidates.length < 12 };
  const kept = state.hider.drawAndKeep(draw * mult + bonus, keep * mult, ctx);
  if (kept.length) say(state, "system", `The hider draws ${draw * mult + bonus} and keeps ${kept.length}.`, { quiet: true });
}

function tickEffects(state, q) {
  const b = state.effects.blockedCategory;
  if (b && b.questions > 0 && --b.questions <= 0) delete state.effects.blockedCategory;
  state.effects.lastAskedAt = state.seekerId;
}

// -------------------------------------------------------------- travelling

export function travelBlocker(state, toId) {
  if (state.status !== "playing") return "The run is over.";
  if (state.challenge) return "Clear the curse in front of you first.";
  // Normally you cannot travel to where you already stand -- but the hider's
  // Move powerup reopens the neighbours of every surviving candidate, and the
  // platform you are standing on can be one of them. Refusing then would
  // deadlock the run: an amber dot under your feet that nothing can search.
  // Staying put to search is allowed, and costs the search time alone.
  if (toId === state.seekerId && !state.candidates.some((s) => s.id === toId))
    return "You are already here, and you have searched it.";
  // The U-Turn sends you back somewhere. Before travel was restricted to one
  // line at a time that meant "go there, now", and refusing everything else
  // was fine. It is not fine now: the station you are being sent back to is
  // usually not on a line out of wherever you are standing, so demanding it
  // in one move is demanding something impossible, and the run deadlocks with
  // the curse permanently unsatisfiable. What it means now is "you may only
  // travel towards it" -- the next leg of the way back, or the place itself.
  if (state.effects.forcedReturn != null && toId !== state.effects.forcedReturn) {
    const back = nextHop(state, state.effects.forcedReturn);
    if (toId !== back)
      return `The U-Turn sends you back to ${state.world.byId.get(state.effects.forcedReturn).name} first.`;
  }
  if (!isFinite(state.travel.minutes[toId])) return "There is no route to that station.";
  // On a timetabled map a move is one ride on one line. Anywhere else is
  // still reachable, but by boarding again at an interchange -- which is the
  // point: a change of line should cost a decision and a wait, not a flat fee
  // buried in a shortest path.
  // Staying put to search is not a ride, so it is not the board's business.
  if (toId !== state.seekerId && hasTimetable(state.world) && !directRide(state, toId)) {
    const est = state.travel.minutes[toId];
    return `No service from ${seeker(state).name} goes there. ` +
           `About ${formatDuration(est)} with a change — ride to an interchange first.`;
  }
  return null;
}

export function travel(state, toId) {
  const blocker = travelBlocker(state, toId);
  if (blocker) return { ok: false, reason: blocker };

  const dest = state.world.byId.get(toId);
  const staying = toId === state.seekerId;
  const direct = staying ? null : directRide(state, toId);
  const path = state.travel.pathTo(toId);
  const lines = direct ? [direct.entry.ref] : state.travel.lineTo(toId);
  let minutes = direct ? direct.cost.minutes : state.travel.minutes[toId];
  const stops = direct ? direct.stop.at - direct.entry.at : path.length - 1;

  const notes = [];
  if (state.effects.slowLegs > 0) { minutes *= 1.5; state.effects.slowLegs--; notes.push("The Gambler's Feet slow you down."); }
  if (state.effects.longWay > 0)  { minutes *= 1.4; state.effects.longWay--;  notes.push("The Right Turn sends you round the houses."); }

  charge(state, minutes);
  state.previousStation = state.seekerId;
  state.seekerId = toId;
  state.checked.add(toId);
  if (state.effects.forcedReturn === toId) delete state.effects.forcedReturn;
  if (state.effects.mustVisit === toId) {
    delete state.effects.mustVisit;
    notes.push("Holiday over. You may ask questions again.");
  }

  // The clock has moved, so where everything is has moved with it.
  state.travel = reachFrom(state);

  const via = direct
    ? ` — ${direct.entry.walk ? "on foot" : `${direct.entry.mode} ${direct.entry.ref}`}, ` +
      `${Math.abs(stops)} stop(s), ${formatDuration(direct.cost.onboard)} on board` +
      (direct.cost.wait > 0 ? ` after ${formatDuration(direct.cost.wait)} waiting` : ", straight on")
    : ` — ${path.length - 1} stop(s), ${formatDuration(minutes)}` +
      (lines.length ? ` via ${lines.join(" → ")}` : "");
  say(state, "system",
      staying
        ? `You stay at ${dest.name} and search it — the hider's Move put this platform back in play.`
        : `You travel to ${dest.name}${via}.` + (notes.length ? " " + notes.join(" ") : ""));

  // A jammed door greets you on arrival.
  if (state.effects.jammedDoors > 0) {
    state.effects.jammedDoors--;
    const roll = 1 + Math.floor(state.rng() * 6) + 1 + Math.floor(state.rng() * 6);
    if (roll < 7) {
      charge(state, 10);
      say(state, "system", `The Jammed Door: you roll ${roll}. Ten minutes lost shouldering it open.`);
    } else {
      say(state, "system", `The Jammed Door: you roll ${roll} and the door gives.`);
    }
  }

  // Entering the zone ends the run.
  const found = state.hider.eliminate(dest);
  state.candidates = state.candidates.filter((s) => s.id !== toId);
  if (found) {
    charge(state, RULES.searchMinutes);
    state.status = "found";
    say(state, "system", `You sweep the ${Math.round(RULES.zoneKm * 1000)} m zone around ${dest.name} and there they are. Found.`, { found: true });
    return { ok: true, found: true };
  }
  say(state, "system", `No sign of them at ${dest.name}. ${state.candidates.length} station(s) still possible.`);

  resolveThermometer(state);
  checkCornered(state);
  return { ok: true, found: false };
}

function resolveThermometer(state) {
  const t = state.pendingThermo;
  if (!t) return;
  const from = state.world.byId.get(t.fromId);
  const to = seeker(state);
  const gone = haversine(from, to);
  if (gone < t.km) {
    say(state, "system", `Thermometer: ${formatKm(gone)} from ${from.name}. You need ${t.km} km before it can be read.`, { quiet: true });
    return;
  }
  const q = questionById(state, t.qid);
  const ctx = { seeker: to, from, to };
  const answer = state.hider.answer(q, ctx);
  const before = state.candidates.length;
  state.candidates = filterByAnswer(q, ctx, state.world, state.candidates, answer);
  state.pendingThermo = null;
  say(state, "hider", q.format(answer), { cut: before - state.candidates.length });
  hiderDraws(state, q);
  maybeCurse(state);
}

// ---------------------------------------------------------------- powerups

function maybePowerups(state) {
  if (state.status !== "playing") return;
  const ctx = { desperate: state.candidates.length < 12 };

  if (state.hider.wantsMove()) {
    const before = state.candidates.length;
    const move = state.hider.doMove();
    if (move) {
      // The rulebook pauses the hider's timer and freezes the seekers while
      // this happens, so it costs no clock -- the price is paid in ground.
      state.candidates = move.opened.slice();
      for (const s of state.candidates) state.checked.delete(s.id);
      say(state, "system",
        `The hider plays Move and relocates to an adjacent station. Everything they ` +
        `told you described where they were: ${before} possible station(s) becomes ` +
        `${state.candidates.length}.`, { move: true });
    }
  }

  const played = state.hider.playHousekeeping(ctx);
  for (const name of played) say(state, "system", `The hider plays ${name}.`, { quiet: true });
}

// ------------------------------------------------------------------ curses

function maybeCurse(state) {
  if (state.status !== "playing" || state.challenge) return;
  const card = state.hider.chooseCurse();
  if (!card) return;
  const def = CURSES[card.id];
  if (!def) return;
  state.hider.play(card);
  state.hider.payCost(curseCost(card.id), { desperate: state.candidates.length < 12 });
  const effect = def.apply(state, state.rng, {
    world: state.world, seeker: seeker(state), travel: state.travel,
    questions: state.questions, hider: state.hider,
  });
  say(state, "curse", `${def.name} — ${def.flavour}`, { effect });
}

/** Resolve the minigame in front of the seeker. Returns a short message. */
export function challengeStep(state, input) {
  const c = state.challenge;
  if (!c) return null;
  if (c.type === "hangman") {
    const letter = String(input).toLowerCase();
    if (!/^[a-z]$/.test(letter) || c.guessed.has(letter)) return null;
    c.guessed.add(letter);
    if (!c.word.includes(letter)) {
      c.wrong++;
      charge(state, c.minutesPerMiss);
    }
    if ([...c.word].every((ch) => c.guessed.has(ch))) {
      state.challenge = null;
      say(state, "system", `Hangman solved: "${c.word}". ${c.wrong} wrong guess(es), ${c.wrong * c.minutesPerMiss} minutes gone.`);
      return "solved";
    }
    return "continue";
  }
  if (c.type === "tumble") {
    const roll = 1 + Math.floor(state.rng() * 6);
    c.rolls.push(roll);
    charge(state, c.minutesPerRoll);
    if (roll >= 5) {
      state.challenge = null;
      say(state, "system", `The die finally lands on ${roll} after ${c.rolls.length} throw(s), costing ${c.rolls.length * c.minutesPerRoll} minutes.`);
      return "solved";
    }
    return "continue";
  }
  if (c.type === "labyrinth") {
    const { w, h, cells } = c.maze;
    const DIRS = { N: { bit: 1, d: -w }, E: { bit: 2, d: 1 }, S: { bit: 4, d: w }, W: { bit: 8, d: -1 } };
    const dir = DIRS[input];
    if (!dir || !(cells[c.at] & dir.bit)) return null;
    c.at += dir.d;
    c.steps++;
    charge(state, c.minutesPerStep);
    if (c.at === w * h - 1) {
      state.challenge = null;
      say(state, "system", `Out of the labyrinth in ${c.steps} steps, costing ${c.steps * c.minutesPerStep} minutes.`);
      return "solved";
    }
    return "continue";
  }
  return null;
}

// ------------------------------------------------------------------ shared

function charge(state, minutes) {
  state.clock += minutes;
}

/** Once a single candidate remains the run is effectively decided; say so. */
function checkCornered(state) {
  if (state.status !== "playing") return;
  if (state.candidates.length === 1) {
    state.hider.commit();
    say(state, "system", `Only ${state.candidates[0].name} is still consistent with everything you have been told.`);
  } else if (state.candidates.length === 0) {
    say(state, "system", "No station fits. Something has gone wrong with the run.", { bug: true });
  }
}

export function finalScore(state) {
  const bonus = state.hider.timeBonus;
  return { elapsed: state.clock, bonus, total: state.clock + bonus };
}
