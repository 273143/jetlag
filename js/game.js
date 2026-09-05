// Game state machine. UI-agnostic: it mutates state, appends to the log and
// returns a small result object; rendering is entirely ui.js's problem.

import { RULES } from "./rules.js";
import { buildQuestions, filterByAnswer } from "./questions.js";
import { Hider } from "./hider.js";
import { CURSES, curseCost } from "./curses.js";
import { mulberry32 } from "./deck.js";
import { travelTimes } from "./data.js";
import { hasTimetable, boardAt, timetableTimes, journeyLegs } from "./timetable.js";
import { haversine, formatKm, formatDuration, formatClock } from "./geo.js";
import { t } from "./i18n.js";

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
 * @param {boolean} [opts.cards]         whether the hider deck is in play
 */
export function newGame(world, {
  difficulty = "fair", seed = Date.now(), startId = null,
  hidingMinutes = null, hiderStationId = null, cards = true,
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
    // The pure-deduction game. Nothing about the questions, the candidate set
    // or the travel model changes with it -- what goes away is the hider's
    // deck, and with it the draws, the veto, the time bonuses and the curses.
    // Every card path below is guarded by this one flag rather than by an
    // empty hand, so a run with cards off is obviously card-free from here.
    cards,
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
    // The radar distances this map offers, so the map can draw them as rings
    // around the seeker: the question is a circle, and it should look like one.
    rangeRings: (RULES.maps[world.id] ?? {}).radarKm ?? [],
  };
  defineTravel(state);
  state.hider = new Hider(world, difficulty, seed, {
    pool: hiding.stops, reach: hiding.reach, window: hiding.minutes,
    stationId: hiderStationId, cards,
  });
  state.hider.eliminate(start);
  state.candidates = state.candidates.filter((s) => s.id !== start.id);

  say(state, "system", t("log.open", {
    name: start.name,
    clock: formatClock(RULES.startClock),
    window: formatDuration(hiding.minutes),
    widened: hiding.widened
      ? t("log.openWidened", {
          asked: formatDuration(hiding.asked), min: RULES.hiding.minStops,
        })
      : "",
    n: state.candidates.length,
  }));
  return state;
}

export const seeker = (state) => state.world.byId.get(state.seekerId);

/**
 * `state.travel` -- what you can reach, from where you stand, at the time it
 * is now.
 *
 * It has to be a view rather than a field. Every departure in it is relative
 * to the clock, and the clock moves for asking a question and for losing a
 * hangman guess as well as for travelling; it used to be refreshed after a
 * journey and nowhere else. That was invisible while it was only the estimate
 * on the map -- a couple of minutes optimistic after an ask, and the real
 * price came from re-reading the board. It stopped being invisible the moment
 * a click on a distant stop started charging what this says, because then the
 * seeker was quoted, and charged, for trams that had already gone.
 *
 * Recomputed on demand rather than inside `charge`: a search over Brno costs
 * about 16 ms, and a labyrinth moves the clock a dozen times over while
 * nobody is looking at the map at all.
 */
function defineTravel(state) {
  let cached = null;
  let at = null;
  Object.defineProperty(state, "travel", {
    enumerable: true,
    get() {
      const key = `${state.clock}:${state.seekerId}`;
      if (at !== key) { at = key; cached = reachFrom(state); }
      return cached;
    },
  });
}

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
 * The whole journey from where the seeker stands to `toId`, or null if there
 * is no route at all.
 *
 * This is what a click on a distant stop now buys. Travel used to be one ride
 * on one line, and anywhere off that line was refused with an estimate and an
 * instruction to ride to an interchange first -- which is honest about what a
 * change costs and exhausting to play, because the seeker ends up hand-routing
 * a network they cannot see the timetable for. The engine does the connecting
 * instead, over exactly the same timetable and at exactly the same price: the
 * search was always time-dependent, so the number charged here is the number
 * a player doing it by hand would have paid.
 *
 * What must not be lost is the arithmetic behind the number, so the return
 * value keeps the legs, the changes and the wait/ride split apart -- every
 * screen that offers a journey shows them before it is paid for.
 *
 *   { minutes, onboard, wait, changes, stops, lines, legs, timetabled }
 */
export function journey(state, toId) {
  const minutes = state.travel.minutes[toId];
  if (!isFinite(minutes)) return null;
  const lines = state.travel.lineTo(toId);
  if (!hasTimetable(state.world)) {
    // No timetable on this map, so nothing waits and there is nothing to
    // split: the region's trains do not run on a headway, and inventing a
    // platform wait for them would be a lie dressed as precision.
    const path = state.travel.pathTo(toId);
    return { minutes, onboard: minutes, wait: 0, timetabled: false,
             changes: Math.max(0, lines.length - 1),
             stops: Math.max(0, path.length - 1), lines, legs: [] };
  }
  const legs = journeyLegs(state.world, state.travel, toId, state.clock);
  const sum = (f) => legs.reduce((a, l) => a + f(l), 0);
  return {
    minutes, timetabled: true,
    onboard: sum((l) => l.onboard),
    wait: sum((l) => l.wait),
    changes: Math.max(0, legs.length - 1),
    stops: legs.length,
    lines, legs,
  };
}
export const questionById = (state, id) => state.questions.find((q) => q.id === id);

function say(state, who, text, extra = {}) {
  state.log.push({ who, text, clock: state.clock, ...extra });
}

// ---------------------------------------------------------------- asking

/** Why a question cannot be asked right now, or null if it can. */
export function askBlocker(state, q) {
  if (state.status !== "playing") return t("block.over");
  if (state.challenge) return t("block.challenge");
  if (state.pendingThermo) return t("block.thermo");
  if (state.bannedQuestions.has(q.id)) return t("block.banned");
  const blocked = state.effects.blockedCategory;
  if (blocked && blocked.cat === q.cat && blocked.questions > 0)
    return t("block.blockedCat", { cat: t(`cat.${q.cat}.name`), n: blocked.questions });
  if (state.effects.mustVisit != null)
    return t("block.mustVisit", { name: state.world.byId.get(state.effects.mustVisit).name });
  if (state.effects.forcedReturn != null)
    return t("block.forcedReturn", { name: state.world.byId.get(state.effects.forcedReturn).name });
  if (state.effects.noRepeatAsk && state.effects.lastAskedAt === state.seekerId)
    return t("block.noRepeatAsk");
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
    say(state, "hider", t("log.thermoAck", { km: q.travelKm, name: me.name }));
    tickEffects(state, q);
    return { ok: true, pending: true };
  }

  const ctx = { seeker: me };
  charge(state, RULES.askMinutes[q.cat]);
  bumpAsked(state, q);
  say(state, "seeker", q.text, { context: q.context?.(ctx) });

  if (state.cards && state.hider.wantsRandomize(q, ctx)) {
    state.hider.play(state.hider.find("randomize"));
    const pool = state.questions.filter((x) =>
      x.cat === q.cat && x.id !== q.id && !state.asked.has(x.id) && !state.bannedQuestions.has(x.id));
    if (pool.length) {
      const swap = pool[Math.floor(state.rng() * pool.length)];
      say(state, "hider", t("log.randomize", { text: swap.text }), { card: "randomize" });
      bumpAsked(state, swap);
      q = swap;
    }
  }

  if (state.cards && state.hider.wantsVeto(q, ctx)) {
    state.hider.play(state.hider.hand.find((c) => c.kind === "powerup" && c.id === "veto"));
    say(state, "hider", t("log.veto"), { veto: true, card: "veto" });
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
  if (!state.cards) return;
  const { draw, keep } = RULES.draw[q.cat];
  const mult = repeatMultiplier(state, q);
  const bonus = state.effects.chalice > 0 ? 1 : 0;
  if (bonus) state.effects.chalice--;
  const ctx = { desperate: state.candidates.length < 12 };
  const kept = state.hider.drawAndKeep(draw * mult + bonus, keep * mult, ctx);
  if (kept.length) {
    say(state, "system",
        t("log.draws", { draw: draw * mult + bonus, keep: kept.length }), { quiet: true });
  }
}

function tickEffects(state, q) {
  const b = state.effects.blockedCategory;
  if (b && b.questions > 0 && --b.questions <= 0) delete state.effects.blockedCategory;
  state.effects.lastAskedAt = state.seekerId;
}

// -------------------------------------------------------------- travelling

export function travelBlocker(state, toId) {
  if (state.status !== "playing") return t("block.over");
  if (state.challenge) return t("block.challenge");
  // Normally you cannot travel to where you already stand -- but the hider's
  // Move powerup reopens the neighbours of every surviving candidate, and the
  // platform you are standing on can be one of them. Refusing then would
  // deadlock the run: an amber dot under your feet that nothing can search.
  // Staying put to search is allowed, and costs the search time alone.
  if (toId === state.seekerId && !state.candidates.some((s) => s.id === toId))
    return t("block.alreadyHere");
  // The U-Turn sends you back somewhere, and now that any stop is one click
  // away that is simply where you have to go next -- the station you came
  // from is by construction reachable from the one you are standing on.
  //
  // It used to have to accept the next leg towards it as well, because travel
  // was one ride on one line and the stop you had just left was usually not on
  // any line out of where you now stood: demanding it in one move demanded
  // something impossible and deadlocked the run with the curse permanently
  // unsatisfiable. That whole clause goes away with the restriction.
  if (state.effects.forcedReturn != null && toId !== state.effects.forcedReturn)
    return t("block.forcedReturn", { name: state.world.byId.get(state.effects.forcedReturn).name });
  if (!isFinite(state.travel.minutes[toId])) return t("block.noRoute");
  return null;
}

export function travel(state, toId) {
  const blocker = travelBlocker(state, toId);
  if (blocker) return { ok: false, reason: blocker };

  const dest = state.world.byId.get(toId);
  const staying = toId === state.seekerId;
  const plan = staying ? null : journey(state, toId);
  let minutes = staying ? 0 : plan.minutes;

  const notes = [];
  if (state.effects.slowLegs > 0) { minutes *= 1.5; state.effects.slowLegs--; notes.push(t("log.slowed")); }
  if (state.effects.longWay > 0)  { minutes *= 1.4; state.effects.longWay--;  notes.push(t("log.longWay")); }

  charge(state, minutes);
  state.previousStation = state.seekerId;
  state.seekerId = toId;
  state.checked.add(toId);
  if (state.effects.forcedReturn === toId) delete state.effects.forcedReturn;
  if (state.effects.mustVisit === toId) {
    delete state.effects.mustVisit;
    notes.push(t("log.holidayOver"));
  }

  // What the journey was, before what it cost. On a timetabled map that is
  // the changes and the lines; on one without, where nothing waits, it is the
  // number of stops -- see `journey`.
  say(state, "system",
      staying
        ? t("log.stay", { name: dest.name })
        : describeJourney(dest, plan, minutes) +
          (notes.length ? " " + notes.join(" ") : ""));

  // A jammed door greets you on arrival.
  if (state.effects.jammedDoors > 0) {
    state.effects.jammedDoors--;
    const roll = 1 + Math.floor(state.rng() * 6) + 1 + Math.floor(state.rng() * 6);
    if (roll < 7) {
      charge(state, 10);
      say(state, "system", t("log.jammedFail", { roll }));
    } else {
      say(state, "system", t("log.jammedOk", { roll }));
    }
  }

  // Entering the zone ends the run.
  const found = state.hider.eliminate(dest);
  state.candidates = state.candidates.filter((s) => s.id !== toId);
  if (found) {
    charge(state, RULES.searchMinutes);
    state.status = "found";
    say(state, "system",
        t("log.found", { m: Math.round(RULES.zoneKm * 1000), name: dest.name }), { found: true });
    return { ok: true, found: true };
  }
  say(state, "system", t("log.noSign", { name: dest.name, n: state.candidates.length }));

  resolveThermometer(state);
  checkCornered(state);
  return { ok: true, found: false };
}

/** One sentence for the journey just taken: how it was made, then what it
 *  cost, split into moving and waiting. */
function describeJourney(dest, plan, minutes) {
  const lines = plan.timetabled
    ? plan.legs.map((l) => (l.walk ? t("log.onFoot") : l.ref)).join(" → ")
    : plan.lines.join(" → ");
  const via = plan.timetabled
    ? (plan.changes > 0
        ? t("log.viaChanges", { n: plan.changes, lines })
        : t("log.viaDirect", { lines }))
    : t("log.viaPath", { n: plan.stops });
  const total = formatDuration(minutes);
  // The wait is scaled with the rest when a curse lengthens the leg, because
  // the curse lengthens the journey rather than the vehicle.
  const scale = plan.minutes > 0 ? minutes / plan.minutes : 1;
  return plan.wait > 0
    ? t("log.travel", { name: dest.name, via, total,
                        ride: formatDuration(plan.onboard * scale),
                        wait: formatDuration(plan.wait * scale) })
    : t("log.travelNoWait", { name: dest.name, via, total });
}

function resolveThermometer(state) {
  const thermo = state.pendingThermo;
  if (!thermo) return;
  const from = state.world.byId.get(thermo.fromId);
  const to = seeker(state);
  const gone = haversine(from, to);
  if (gone < thermo.km) {
    say(state, "system",
        t("log.thermoShort", { gone: formatKm(gone), name: from.name, km: thermo.km }),
        { quiet: true });
    return;
  }
  const q = questionById(state, thermo.qid);
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
  if (state.status !== "playing" || !state.cards) return;
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
        t("log.move", { before, after: state.candidates.length }), { move: true, card: "move" });
    }
  }

  for (const id of state.hider.playHousekeeping(ctx)) {
    say(state, "system", t("log.plays", { name: t(`card.${id}.name`) }), { quiet: true, card: id });
  }
}

// ------------------------------------------------------------------ curses

function maybeCurse(state) {
  if (state.status !== "playing" || state.challenge || !state.cards) return;
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
  // Three fields rather than one sentence: the panel styles the curse's name,
  // its flavour and its mechanical effect differently, and it used to get
  // them by splitting the text back apart on an em dash.
  say(state, "curse", t(`curse.${card.id}.name`), {
    curse: card.id, flavour: t(`curse.${card.id}.flavour`), effect,
  });
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
      say(state, "system", t("log.hangmanSolved", {
        word: c.word, n: c.wrong, min: c.wrong * c.minutesPerMiss }));
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
      say(state, "system", t("log.tumbleSolved", {
        roll, n: c.rolls.length, min: c.rolls.length * c.minutesPerRoll }));
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
      say(state, "system", t("log.mazeSolved", {
        n: c.steps, min: c.steps * c.minutesPerStep }));
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
    say(state, "system", t("log.cornered", { name: state.candidates[0].name }));
  } else if (state.candidates.length === 0) {
    say(state, "system", t("log.bug"), { bug: true });
  }
}

export function finalScore(state) {
  const bonus = state.hider.timeBonus;
  return { elapsed: state.clock, bonus, total: state.clock + bonus };
}
