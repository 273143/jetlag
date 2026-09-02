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

import { RULES } from "./rules.js";

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
    name: "The Jammed Door",
    kind: "penalty",
    flavour: "Every door you touch sticks. The next three stations you reach will not let you in easily.",
    apply(state) {
      state.effects.jammedDoors = (state.effects.jammedDoors || 0) + 3;
      return "The next 3 stations you enter cost a 2d6 roll; under 7 loses you 10 minutes.";
    },
  },

  gamblers_feet: {
    name: "The Gambler's Feet",
    kind: "penalty",
    flavour: "Your feet will not commit to a direction without consulting a die first.",
    apply(state) {
      state.effects.slowLegs = (state.effects.slowLegs || 0) + 2;
      return "Your next 2 journeys take 50% longer.";
    },
  },

  right_turn: {
    name: "The Right Turn",
    kind: "penalty",
    flavour: "You may only ever turn right, which is no way to cross a region.",
    apply(state) {
      state.effects.longWay = (state.effects.longWay || 0) + 1;
      return "Your next journey must go the long way round: 40% longer.";
    },
  },

  u_turn: {
    name: "The U-Turn",
    kind: "penalty",
    flavour: "You were going the wrong way. Get off and go back.",
    apply(state) {
      if (state.previousStation === null || state.previousStation === state.seekerId) {
        state.effects.slowLegs = (state.effects.slowLegs || 0) + 1;
        return "You had nowhere to be sent back to, so your next journey is 50% longer instead.";
      }
      state.effects.forcedReturn = state.previousStation;
      return "You must return to the station you just left before doing anything else.";
    },
  },

  urban_explorer: {
    name: "The Urban Explorer",
    kind: "penalty",
    flavour: "You cannot bear to sit still on a platform and think.",
    apply(state) {
      state.effects.noRepeatAsk = true;
      return "For the rest of the run you cannot ask two questions from the same station.";
    },
  },

  spotty_memory: {
    name: "Spotty Memory",
    kind: "penalty",
    flavour: "A whole category of question has slipped your mind.",
    apply(state, rng) {
      const cats = ["matching", "measuring", "radar", "thermometer", "tentacles", "photo"];
      const cat = cats[Math.floor(rng() * cats.length)];
      state.effects.blockedCategory = { cat, questions: 3 };
      return `You cannot ask ${cat} questions for your next 3 questions.`;
    },
  },

  drained_brain: {
    name: "The Drained Brain",
    kind: "penalty",
    flavour: "Three questions have been scrubbed from your mind entirely.",
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
        picked.push(q.short ? `${c}: ${q.short}` : q.text);
      }
      return `Banned for the rest of the run — ${picked.join("; ")}.`;
    },
  },

  overflowing: {
    name: "The Overflowing Chalice",
    kind: "penalty",
    flavour: "The hider's cup runneth over.",
    apply(state) {
      state.effects.chalice = (state.effects.chalice || 0) + 3;
      return "The hider draws an extra card on each of their next 3 answers.";
    },
  },

  travel_agent: {
    name: "The Mediocre Travel Agent",
    kind: "penalty",
    flavour: "A holiday has been booked on your behalf. The agent has been suspiciously specific.",
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
      if (!dest) return "The travel agent could not find anywhere. Nothing happens.";

      // The booking is information, so it filters, exactly like an answer.
      const legal = withinHops(world, dest.id, maxHops);
      const keep = (s) => legal.has(s.id) && (dest.id === s.id || legal.get(s.id) > 0);
      const before = state.candidates.length;
      state.candidates = state.candidates.filter(keep);
      hider.candidates = hider.candidates.filter(keep);

      state.effects.mustVisit = dest.id;
      const cut = before - state.candidates.length;
      return `You must visit ${dest.name} before you may ask another question — ` +
             `and the agent only books within ${maxHops} stops of the hider. ` +
             `${cut} station(s) ruled out.`;
    },
  },

  hangman: {
    name: "The Hidden Hangman",
    kind: "challenge",
    flavour: "You must win a game of hangman before you go anywhere.",
    apply(state, rng) {
      const word = HANGMAN_WORDS[Math.floor(rng() * HANGMAN_WORDS.length)];
      // Two minutes a miss, not eight. At eight a single bad word ran to a
      // hundred minutes -- more than the whole rest of the run -- and a curse
      // that decides the game on how well you guess Czech nouns is not a
      // curse, it is a different game bolted on.
      state.challenge = { type: "hangman", word, guessed: new Set(), wrong: 0, minutesPerMiss: 2 };
      return "Guess the word. Every wrong letter costs you 2 minutes.";
    },
  },

  labyrinth: {
    name: "The Labyrinth",
    kind: "challenge",
    flavour: "The station has rearranged itself into a maze. Find your way out.",
    apply(state, rng) {
      // A minute a step. The shortest way out of a 7x7 maze is a dozen-odd
      // steps and a wrong turn costs several more, so at two minutes a step
      // this was routinely half an hour for a puzzle nobody enjoys twice.
      state.challenge = { type: "labyrinth", maze: generateMaze(7, 7, rng), at: 0, steps: 0, minutesPerStep: 1 };
      return "Walk from the top-left to the bottom-right. Every step costs you 1 minute.";
    },
  },

  endless_tumble: {
    name: "The Endless Tumble",
    kind: "challenge",
    flavour: "A die must be rolled down the hill, and it must land well.",
    apply(state) {
      state.challenge = { type: "tumble", rolls: [], minutesPerRoll: 5 };
      return "Roll a 5 or a 6 to continue. Every roll costs you 5 minutes.";
    },
  },
};

const HANGMAN_WORDS = [
  "train", "board", "north", "river", "cliff", "gorge", "plaza", "abbey", "cargo",
  "vault", "wharf", "bench", "spire", "kiosk", "crown", "hedge", "marsh", "grove",
  "tower", "canal", "depot", "ridge", "brook", "field", "cabin", "chalk", "flint",
];

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
