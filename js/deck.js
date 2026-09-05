// The hider deck: time bonuses, powerups and curses.
//
// A card is its kind, its id and its cost -- no words. Nothing here is ever
// shown to a player as itself; what reaches the log is a sentence built in
// game.js from `card.<id>.name` in the dictionary.

import { RULES } from "./rules.js";

export function buildDeck(rng) {
  const cards = [];
  let uid = 0;
  for (const t of RULES.deck.timeBonus)
    for (let i = 0; i < t.count; i++)
      cards.push({ uid: uid++, kind: "time", minutes: t.minutes });
  for (const p of RULES.deck.powerups)
    for (let i = 0; i < p.count; i++)
      cards.push({ uid: uid++, kind: "powerup", id: p.id });
  for (const c of RULES.deck.curses)
    for (let i = 0; i < c.count; i++)
      cards.push({ uid: uid++, kind: "curse", id: c.id, cost: c.cost });
  return shuffle(cards, rng);
}

export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Deterministic PRNG so a seed reproduces a whole round.
 *
 * `position()` is the generator's entire state -- one 32-bit word -- and
 * seeding a new one with it continues the identical stream. That is what
 * makes a half-played round resumable: js/save.js stores the position, and a
 * restored round draws the same cards and casts the same curses it was about
 * to. Without it a reload would keep the clock and quietly reroll the deck.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  const rng = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.position = () => a;
  return rng;
}

/** How much the hider AI wants a card, in notional minutes saved.
 *
 *  Curses are worth roughly half an hour of the seekers' time -- but only the
 *  ones that actually get cast. A hand stuffed with curses cannot play them
 *  all before the run ends, so each additional one is worth steeply less.
 *  Without that taper the hider hoards curses, discards every time bonus as
 *  curse fuel, and finishes every round with a bonus of exactly zero, which
 *  quietly deletes a third of the deck from the game. */
export function cardValue(card, ctx = {}) {
  if (card.kind === "time") return card.minutes;
  if (card.kind === "curse") {
    const base = ctx.desperate ? 40 : 26;
    return base * Math.pow(0.55, ctx.cursesInHand || 0);
  }
  switch (card.id) {
    case "veto": return 34;
    case "move": return ctx.desperate ? 45 : 28;
    case "randomize": return 18;
    case "expand": return 14;
    case "duplicate": return 16;
    default: return 12;   // discard/draw filters
  }
}
