// Curses.
//
// The rulebook's curses are mostly physical: photograph a more expensive car,
// stack a cairn, affix a lemon to your coat. None of that survives a screen,
// but their *function* does -- they burn the seekers' time and derail their
// plan. So each curse here keeps the book's name and spirit and takes one of
// two screen-native forms:
//
//   penalty    a mechanical effect on travelling or asking
//   challenge  a minigame that must be cleared before the run continues,
//              where playing badly costs game minutes
//
// Curse effects live on state.effects and are consumed by game.js.
//
// Only the mechanics are here. A curse's name and its line of flavour are
// looked up from the dictionary at the point it is cast (`curse.<id>.name`,
// `.flavour`), and `apply` returns its effect already worded -- so this file
// stays the rules and js/i18n.js stays the words.

import { RULES } from "./rules.js";
import { t } from "./i18n.js";

/** Stations within `maxHops` stops, as a Map of id -> hops (including 0 for
 *  the start). Plain graph hops rather than travel time: "three stops away"
 *  is a thing a player can count on the map, which is the point. */
function withinHops(world, startId, maxHops) {
  const seen = new Map([[startId, 0]]);
  let frontier = [startId];
  for (let h = 1; h <= maxHops; h++) {
    const next = [];
    for (const n of frontier) {
      for (const e of world.adj[n]) {
        if (seen.has(e.to)) continue;
        seen.set(e.to, h);
        next.push(e.to);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return seen;
}

export const CURSES = {
  jammed_door: {
    kind: "penalty",
    apply(state) {
      state.effects.jammedDoors = (state.effects.jammedDoors || 0) + 3;
      return t("curse.jammed_door.effect");
    },
  },

  gamblers_feet: {
    kind: "penalty",
    apply(state) {
      state.effects.slowLegs = (state.effects.slowLegs || 0) + 2;
      return t("curse.gamblers_feet.effect");
    },
  },

  right_turn: {
    kind: "penalty",
    apply(state) {
      state.effects.longWay = (state.effects.longWay || 0) + 1;
      return t("curse.right_turn.effect");
    },
  },

  u_turn: {
    kind: "penalty",
    apply(state) {
      if (state.previousStation === null || state.previousStation === state.seekerId) {
        state.effects.slowLegs = (state.effects.slowLegs || 0) + 1;
        return t("curse.u_turn.effectNone");
      }
      state.effects.forcedReturn = state.previousStation;
      return t("curse.u_turn.effect");
    },
  },

  urban_explorer: {
    kind: "penalty",
    apply(state) {
      state.effects.noRepeatAsk = true;
      return t("curse.urban_explorer.effect");
    },
  },

  spotty_memory: {
    kind: "penalty",
    apply(state, rng) {
      const cats = ["matching", "measuring", "radar", "thermometer", "tentacles", "photo"];
      const cat = cats[Math.floor(rng() * cats.length)];
      state.effects.blockedCategory = { cat, questions: 3 };
      return t("curse.spotty_memory.effect", { cat: t(`cat.${cat}.name`) });
    },
  },

  drained_brain: {
    kind: "penalty",
    apply(state, rng, ctx) {
      const byCat = new Map();
      for (const q of ctx.questions) {
        if (state.bannedQuestions.has(q.id)) continue;
        if (!byCat.has(q.cat)) byCat.set(q.cat, []);
        byCat.get(q.cat).push(q);
      }
      const cats = [...byCat.keys()].sort(() => rng() - 0.5).slice(0, 3);
      const picked = [];
      for (const c of cats) {
        const list = byCat.get(c);
        const q = list[Math.floor(rng() * list.length)];
        state.bannedQuestions.add(q.id);
        picked.push(q.short ? `${t(`cat.${c}.name`)}: ${q.short}` : q.text);
      }
      return t("curse.drained_brain.effect", { list: picked.join("; ") });
    },
  },

  overflowing: {
    kind: "penalty",
    apply(state) {
      state.effects.chalice = (state.effects.chalice || 0) + 3;
      return t("curse.overflowing.effect");
    },
  },

  travel_agent: {
    kind: "penalty",
    // The book's version sends the seekers somewhere unhelpful, and the first
    // implementation here did exactly that: a random station 20-60 minutes
    // away, drawn from the whole network. It could therefore book you into a
    // station you had already ruled out -- pure dead time, no deduction
    // attached, and it read as the game punishing you for playing well.
    //
    // It is now a gamble instead of a tax. The destination must be within
    // `travelAgentHops` stops of the hider, so the card still burns your
    // clock, but the booking itself is evidence: every station further than
    // that from the destination is out. The hider is buying time with ground.
    //
    // The hider takes the furthest ring they can (3 stops rather than 1, so
    // they give away as little as possible), and among those the station that
    // costs the seeker the longest journey. If no station in the ring works,
    // the only booking left is their own stop -- which hands the run over, so
    // the AI will not reach that far, but a player-controlled hider could.
    apply(state, rng, ctx) {
      const { world, seeker, hider } = ctx;
      const maxHops = (RULES.maps[world.id] ?? {}).travelAgentHops ?? 3;

      // Candidates that could still be the hider, indexed by the destinations
      // that would be legal for them. Works for both hiders: the fair one has
      // committed, so its ring is a fact; the devious one has not, so it takes
      // the destination that keeps the largest set of candidates alive -- the
      // same rule it answers every question by, and equally truthful.
      const reach = new Map();          // destination id -> Set(candidate ids)
      for (const c of state.candidates) {
        for (const [id, hops] of withinHops(world, c.id, maxHops)) {
          if (hops === 0 || id === seeker.id) continue;
          if (!reach.has(id)) reach.set(id, new Set());
          reach.get(id).add(c.id);
        }
      }

      let dest = null;
      if (hider.station) {
        const ring = [...withinHops(world, hider.station.id, maxHops)]
          .filter(([id, hops]) => hops > 0 && id !== seeker.id);
        if (ring.length) {
          ring.sort((a, b) =>
            b[1] - a[1] ||                                          // furthest ring first
            (ctx.travel.minutes[b[0]] - ctx.travel.minutes[a[0]]));  // then longest journey
          dest = world.byId.get(ring[0][0]);
        } else if (hider.station.id !== seeker.id) {
          dest = hider.station;         // nowhere else legal: give yourself up
        }
      } else {
        // A devious hider has to weigh both halves of the card, or it books
        // the busiest interchange one minute away: maximum candidates kept,
        // zero minutes burned, which is not a curse at all. Ground times time.
        let best = null;
        for (const [id, set] of reach) {
          const score = set.size * Math.min(ctx.travel.minutes[id] ?? 0, 60);
          if (!best || score > best.score) best = { id, score };
        }
        if (best) dest = world.byId.get(best.id);
      }
      if (!dest) return t("curse.travel_agent.effectNone");

      // The booking is information, so it filters, exactly like an answer.
      const legal = withinHops(world, dest.id, maxHops);
      const keep = (s) => legal.has(s.id) && (dest.id === s.id || legal.get(s.id) > 0);
      const before = state.candidates.length;
      state.candidates = state.candidates.filter(keep);
      hider.candidates = hider.candidates.filter(keep);

      state.effects.mustVisit = dest.id;
      return t("curse.travel_agent.effect", {
        name: dest.name, hops: maxHops, n: before - state.candidates.length,
      });
    },
  },

  hangman: {
    kind: "challenge",
    apply(state, rng) {
      const words = hangmanWords();
      const word = words[Math.floor(rng() * words.length)];
      // Two minutes a miss, not eight. At eight a single bad word ran to a
      // hundred minutes -- more than the whole rest of the run -- and a curse
      // that decides the game on how well you guess Czech nouns is not a
      // curse, it is a different game bolted on.
      const minutesPerMiss = 2;
      state.challenge = { type: "hangman", word, guessed: new Set(), wrong: 0, minutesPerMiss };
      return t("curse.hangman.effect", { n: minutesPerMiss });
    },
  },

  labyrinth: {
    kind: "challenge",
    apply(state, rng) {
      // A minute a step. The shortest way out of a 7x7 maze is a dozen-odd
      // steps and a wrong turn costs several more, so at two minutes a step
      // this was routinely half an hour for a puzzle nobody enjoys twice.
      const minutesPerStep = 1;
      state.challenge = { type: "labyrinth", maze: generateMaze(7, 7, rng), at: 0, steps: 0, minutesPerStep };
      return t("curse.labyrinth.effect", { n: minutesPerStep });
    },
  },

  endless_tumble: {
    kind: "challenge",
    apply(state) {
      const minutesPerRoll = 5;
      state.challenge = { type: "tumble", rolls: [], minutesPerRoll };
      return t("curse.endless_tumble.effect", { n: minutesPerRoll });
    },
  },
};

/** The hangman word list for the language in play.
 *
 *  The on-screen keyboard is a to z, so the Czech list is words genuinely
 *  written without diacritics -- "kolej", "peron", "sklep" -- rather than
 *  accented words with the accents knocked off, which would be a spelling
 *  test nobody can win and bad Czech besides. */
const hangmanWords = () => t("hangman.words").split(" ");

/** Perfect maze on a w x h grid, carved by randomised depth-first search.
 *  Cells are bitmasks of open sides: 1 N, 2 E, 4 S, 8 W. */
export function generateMaze(w, h, rng) {
  const cells = new Array(w * h).fill(0);
  const seen = new Array(w * h).fill(false);
  const stack = [0];
  seen[0] = true;
  const DIRS = [
    { bit: 1, opp: 4, dx: 0, dy: -1 },
    { bit: 2, opp: 8, dx: 1, dy: 0 },
    { bit: 4, opp: 1, dx: 0, dy: 1 },
    { bit: 8, opp: 2, dx: -1, dy: 0 },
  ];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const cx = cur % w, cy = Math.floor(cur / w);
    const open = [];
    for (const d of DIRS) {
      const nx = cx + d.dx, ny = cy + d.dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && !seen[ny * w + nx]) open.push({ d, n: ny * w + nx });
    }
    if (!open.length) { stack.pop(); continue; }
    const { d, n } = open[Math.floor(rng() * open.length)];
    cells[cur] |= d.bit;
    cells[n] |= d.opp;
    seen[n] = true;
    stack.push(n);
  }
  return { w, h, cells };
}

export function curseCost(id) {
  return RULES.deck.curses.find((c) => c.id === id)?.cost ?? 0;
}
