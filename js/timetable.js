// Departures, and what you can reach from where you stand.
//
// The travel model this replaces let the seeker click any station on the map
// and pay a shortest path across the whole network, with a flat 3 minutes for
// each change of line. That is not a journey, it is a teleport with a fee: it
// never waited for anything, and a city map with ninety-one lines let you
// cross ten of them in twelve minutes.
//
// Here the cost of getting somewhere is a real journey: you wait for a real
// departure, you stay on to a stop that line actually serves, and a change of
// line costs another wait rather than a flat fee -- which is what makes an
// interchange worth anything.
//
// The seeker still picks a destination and goes there in one click; what
// changed is only who does the connecting. The engine searches this timetable
// for the fastest itinerary and charges all of it, waiting included, and every
// screen that offers a journey shows the legs and the wait/ride split -- see
// `journeyLegs` at the foot of this file. Making the player ride to an
// interchange and board again by hand taught the same lesson, but it taught it
// once and then charged tuition for the rest of the run.
//
// The timetable itself is the simplest thing that can be read off a board:
// every line runs on a fixed headway from its terminus, so a stop N minutes
// down the line departs at N, N + headway, N + 2*headway, and so on from the
// start of service. Trams every 5 minutes, buses and trolleybuses every 10.
// No timetable file, nothing to look up -- the whole schedule is one number
// per mode, and the board is derived.
//
// A map without `headway` in RULES has no timetable and keeps the old free
// travel; the region's trains do not run on a five-minute headway and would
// be a lie dressed as precision.

import { RULES } from "./rules.js";

/** Minutes between vehicles on a line, or null if this map has no timetable. */
export function headwayFor(world, lineIdx) {
  const h = (RULES.maps[world.id] ?? {}).headway;
  if (!h) return null;
  return h[world.lineModes?.[lineIdx] ?? "bus"] ?? null;
}

export const hasTimetable = (world) =>
  Boolean((RULES.maps[world.id] ?? {}).headway) && Boolean(world.lineStops?.length);

const mod = (a, n) => ((a % n) + n) % n;

/** Walking the gap between two adjacent stops, relative to riding it. */
const WALK_FACTOR = 2.5;

/**
 * Every (line, variant, position) that passes through a stop.
 *
 * Built once per world and cached on it: the board is redrawn after every
 * action, and rescanning ninety-one lines each time is wasted work.
 */
export function servicesAt(world, stopId) {
  if (!world._svc) {
    const svc = world.stations.map(() => []);
    world.lineStops.forEach((variants, line) => {
      variants.forEach((v, variant) => {
        v.stops.forEach((id, at) => svc[id].push({ line, variant, at }));
      });
    });
    world._svc = svc;
  }
  return world._svc[stopId];
}

/**
 * When the next vehicles leave this stop on this service, from `clock`.
 *
 * The terminus leaves at 0, h, 2h ... minutes into service, so a stop t
 * minutes down the line leaves at t mod h past each of those.
 */
export function departures(world, svc, clock, count = 3) {
  const h = headwayFor(world, svc.line);
  if (!h) return [];
  const t = world.lineStops[svc.line][svc.variant].times[svc.at];
  const first = clock + mod(t - clock, h);
  return Array.from({ length: count }, (_, i) => first + i * h);
}

/**
 * One ride: board `svc` at `clock` and stay on to the stop at index `to`.
 * Returns the wait, the time on board, and the arrival, all in game minutes.
 */
export function ride(world, svc, to, clock) {
  const v = world.lineStops[svc.line][svc.variant];
  const depart = departures(world, svc, clock, 1)[0];
  const onboard = v.times[to] - v.times[svc.at];
  return { depart, wait: depart - clock, onboard, arrive: depart + onboard, toId: v.stops[to] };
}

/**
 * The departure board at a stop: one entry per line and direction, each with
 * its next departures and every stop it serves from here on.
 *
 * `reversed` entries are a fallback. A handful of stops sit at the very end of
 * every route relation that lists them -- terminal loops, mostly -- so going
 * by the mapped direction alone they are places you can arrive at and never
 * leave. A service that brought you there also runs back, so where a stop
 * would otherwise be stranded the board offers the reverse of its own
 * variants rather than trapping the seeker.
 */
export function boardAt(world, stopId, clock) {
  const build = (reversed) => {
    const out = [];
    for (const svc of servicesAt(world, stopId)) {
      const v = world.lineStops[svc.line][svc.variant];
      const n = v.stops.length;
      const idx = reversed
        ? Array.from({ length: svc.at }, (_, i) => svc.at - 1 - i)
        : Array.from({ length: n - svc.at - 1 }, (_, i) => svc.at + 1 + i);
      if (!idx.length) continue;
      const base = v.times[svc.at];
      const stops = idx.map((i) => ({
        id: v.stops[i],
        at: i,
        onboard: Math.abs(v.times[i] - base),
      }));
      out.push({
        line: svc.line,
        ref: world.lines[svc.line],
        mode: world.lineModes?.[svc.line] ?? "bus",
        variant: svc.variant,
        at: svc.at,
        reversed,
        towards: world.byId.get(stops[stops.length - 1].id).name,
        departures: departures(world, svc, clock),
        stops,
      });
    }
    return out;
  };
  const forward = build(false);
  const services = forward.length ? forward : build(true);

  // You can always walk one stop. This is not a convenience: a handful of
  // terminal loops are named in no route relation at all, or are served only
  // in the direction that arrives, so on services alone they are places the
  // seeker can never reach or never leave -- and a hider sitting in one could
  // not be found. Walking guarantees the board is at least as connected as
  // the map, at a price nobody would pay twice: no vehicle to wait for, and
  // two and a half times as long as riding the same gap.
  const onBoard = new Set(services.flatMap((e) => e.stops.map((st) => st.id)));
  const walks = world.adj[stopId]
    .filter((e) => !onBoard.has(e.to))
    .map((e) => ({ id: e.to, at: -1, onboard: e.minutes * WALK_FACTOR }));
  if (walks.length) {
    services.push({
      line: -1, ref: "walk", mode: "walk", variant: -1, at: -1, reversed: false,
      towards: null, departures: [], walk: true,
      stops: walks.sort((a, b) => a.onboard - b.onboard),
    });
  }
  return services;
}

/**
 * Cost of one ride from the board, honouring a reversed fallback entry.
 * Returns { wait, onboard, minutes, toId } in game minutes.
 */
export function rideCost(world, entry, stop, clock) {
  if (entry.walk) return { wait: 0, onboard: stop.onboard, minutes: stop.onboard, toId: stop.id };
  const h = headwayFor(world, entry.line);
  const v = world.lineStops[entry.line][entry.variant];
  const t = v.times[entry.at];
  const depart = h ? clock + mod(t - clock, h) : clock;
  return {
    wait: depart - clock,
    onboard: stop.onboard,
    minutes: depart - clock + stop.onboard,
    toId: stop.id,
  };
}

/**
 * Fastest arrival time at every stop, leaving `from` at `clock`.
 *
 * Time-dependent, because the wait depends on when you get there: this is the
 * same search the seeker does by hand on the board, run to exhaustion. It is
 * what the map's "how far is everything" colouring and the hider's own
 * reasoning are built on, so it has to agree with what boarding actually
 * costs -- an estimate that quietly ignored waiting would make every plan
 * optimistic by a few minutes per change, which over a run is most of a
 * question.
 *
 * States are (stop, line) as before. Staying on a line is free; boarding one
 * costs the wait for its next departure.
 */
export function timetableTimes(world, from, clock) {
  const n = world.stations.length;
  const best = new Float64Array(n).fill(Infinity);
  const prev = new Array(n).fill(null);
  best[from] = clock;

  // Small worlds and short rides, so a simple repeated-relaxation queue beats
  // the ceremony of a heap here; the frontier never gets wide.
  let frontier = [from];
  while (frontier.length) {
    const next = new Set();
    for (const id of frontier) {
      const now = best[id];
      for (const entry of boardAt(world, id, now)) {
        let depart = now;
        if (!entry.walk) {
          const t = world.lineStops[entry.line][entry.variant].times[entry.at];
          const h = headwayFor(world, entry.line);
          if (h) depart = now + mod(t - now, h);
        }
        for (const stop of entry.stops) {
          const arrive = depart + stop.onboard;
          if (arrive < best[stop.id] - 1e-9) {
            best[stop.id] = arrive;
            prev[stop.id] = { from: id, to: stop.id, line: entry.line, variant: entry.variant,
                              at: entry.at, walk: !!entry.walk, depart, arrive };
            next.add(stop.id);
          }
        }
      }
    }
    frontier = [...next];
  }

  const minutes = new Float64Array(n);
  for (let i = 0; i < n; i++) minutes[i] = best[i] - clock;

  const legsTo = (target) => {
    const legs = [];
    for (let id = target; prev[id]; id = prev[id].from) legs.push(prev[id]);
    return legs.reverse();
  };
  return {
    minutes,
    legs: legsTo,
    pathTo: (target) => {
      const legs = legsTo(target);
      return legs.length ? [legs[0].from, ...legs.map((l) => l.to)] : [target];
    },
    lineTo: (target) => legsTo(target).map((l) => (l.walk ? "on foot" : world.lines[l.line])),
  };
}

/**
 * One journey, leg by leg, as a passenger would read it off a board.
 *
 * `timetableTimes` already searches over rides rather than over single hops,
 * so its `legs(id)` is the itinerary: board here, stay on to there, board
 * again. What this adds is the passenger's arithmetic -- how long each wait
 * on a platform actually is, given when the previous vehicle put you down --
 * and the totals that go with it.
 *
 * The split matters because it is the one thing the old one-ride-at-a-time
 * interface made visible for free. Clicking a distant stop used to be refused
 * with "ride to an interchange first", which taught you, three minutes at a
 * time, that a change is not free. Letting the click through is much less
 * tiring; it must not also quietly hide what the change cost, so every screen
 * that offers a journey shows `wait` next to `onboard`.
 */
export function journeyLegs(world, travel, toId, clock) {
  let now = clock;
  return (travel.legs?.(toId) ?? []).map((l) => {
    const leg = {
      fromId: l.from, toId: l.to,
      walk: !!l.walk,
      ref: l.walk ? null : world.lines[l.line],
      mode: l.walk ? "walk" : (world.lineModes?.[l.line] ?? "bus"),
      depart: l.depart, arrive: l.arrive,
      wait: Math.max(0, l.depart - now),
      onboard: l.arrive - l.depart,
    };
    now = l.arrive;
    return leg;
  });
}
