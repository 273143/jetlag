// The hider: chooses where to hide, answers questions, and works the deck.
//
// Two personalities, sharing one representation. Both track the candidate set,
// meaning every station still consistent with all answers given so far.
//
//   fair    commits to a station up front and answers from it.
//   devious never commits. For each question it partitions the candidates by
//           what the answer would be, and gives the answer that leaves the
//           largest set standing. Every answer is still true of some station
//           consistent with everything said before, so the hider never lies;
//           it is simply the luckiest possible hider. It is forced to commit
//           when one candidate remains, or when asked for a photo.

import { applyQuestion } from "./questions.js";
import { buildDeck, cardValue, mulberry32 } from "./deck.js";
import { RULES } from "./rules.js";
import { haversine } from "./geo.js";

export class Hider {
  /**
   * @param {object} hiding  the opening position from game.js:
   *   pool      stops inside the hiding window -- the only places to hide
   *   reach     journey times out of the starting stop
   *   window    the head start, in minutes
   *   stationId a human hider's chosen stop, if there is one
   */
  constructor(world, difficulty, seed, hiding = {}) {
    this.world = world;
    this.difficulty = difficulty;
    this.rng = mulberry32(seed);
    this.deck = buildDeck(this.rng);
    this.discard = [];
    this.hand = [];
    this.handLimit = RULES.handLimit;
    this.hiding = hiding;
    // The candidate set mirrors the seekers': everywhere still consistent
    // with what has been said, which at the start is everywhere reachable.
    this.candidates = (hiding.pool?.length ? hiding.pool : world.stations).slice();
    this.committed = null;

    // A person hiding on the other side of the pass-and-play has already
    // chosen, and the choice is theirs whatever the difficulty says.
    if (hiding.stationId != null) this.committed = world.byId.get(hiding.stationId);
    else if (difficulty === "fair") this.committed = this.chooseStation();
  }

  /** A hider picks somewhere awkward: a journey away, and surrounded by
   *  stations that answer questions the same way, so early answers say little.
   *
   *  Both halves of that used to be wrong in the same direction, and the
   *  result was a hider on the rim of the map essentially every game.
   *
   *  Distance was rewarded without limit, so the outer terminus always won.
   *  The hiding window saturates it now, and does it honestly: a hider cannot
   *  be further away than the head start allowed, and inside that window
   *  spending more of it is simply better. What used to be an invented
   *  40-minute ceiling is now the actual rule of the round.
   *
   *  Worse, "surrounded by lookalikes" counted stations in the same *district*
   *  within 12 km -- which is not a measure of camouflage, it is a measure of
   *  how big your district is, and Brno's big districts are all on the edge.
   *  It is plain density now: how many stations sit within 2 km, wherever
   *  they are. That is the thing that actually makes a hider hard to find,
   *  and it points at the middle of the city rather than away from it.
   *
   *  Note what this is *not*: a floor. The seekers are told the window and
   *  nothing else, so any stop inside it has to be a real possibility, or the
   *  candidate set would be quietly lying. Using the window is a preference,
   *  and a hider who wants to sit two stops from the start may. */
  chooseStation() {
    const { reach, window } = this.hiding;
    const list = this.candidates.length ? this.candidates : this.world.stations;
    const CROWD = 25;        // neighbours within 2 km past which denser is not better
    const scored = list.map((s) => {
      const used = reach && window ? Math.min(reach.minutes[s.id] / window, 1) : 0.5;
      let near = 0;
      for (const o of this.world.stations) {
        if (o.id !== s.id && haversine(s, o) < 2.0) near++;
      }
      return { s, score: used * 0.5 + (Math.min(near, CROWD) / CROWD) * 0.5 + this.rng() * 0.8 };
    });
    scored.sort((a, b) => b.score - a.score);
    // Pick from the strong tail rather than the single best, so it varies.
    // A share rather than a fixed 50, because the pool is now a window's
    // worth of stops and can be a couple of dozen.
    const tail = Math.max(1, Math.ceil(scored.length * 0.35));
    return scored[Math.floor(this.rng() * tail)].s;
  }

  /** How much of the head start the hider spent getting here. */
  travelMinutes(station = this.committed) {
    const { reach } = this.hiding;
    return station && reach ? reach.minutes[station.id] : null;
  }

  get station() { return this.committed; }

  /** Answer a question, shrinking the candidate set to match. */
  answer(q, ctx) {
    if (this.committed) {
      const { answer, survivors } = applyQuestion(q, this.committed, ctx, this.world, this.candidates);
      this.candidates = survivors;
      return answer;
    }
    if (q.visual) {                                 // a photo forces a decision
      this.commit();
      return this.answer(q, ctx);
    }
    const buckets = new Map();
    for (const s of this.candidates) {
      const v = q.ask(s, ctx, this.world);
      if (!buckets.has(v)) buckets.set(v, []);
      buckets.get(v).push(s);
    }
    let best = null;
    for (const [value, list] of buckets) {
      const score = list.length + this.spread(list) * 0.25;
      if (!best || score > best.score) best = { value, list, score };
    }
    this.candidates = best.list;
    if (this.candidates.length === 1) this.commit();
    return best.value;
  }

  /** Mean distance of a candidate set from its own centre. A scattered set is
   *  harder to search than a tight cluster of the same size. */
  spread(list) {
    if (list.length < 2) return 0;
    const lat = list.reduce((a, s) => a + s.lat, 0) / list.length;
    const lon = list.reduce((a, s) => a + s.lon, 0) / list.length;
    return list.reduce((a, s) => a + haversine(s, { lat, lon }), 0) / list.length;
  }

  commit() {
    if (this.committed) return this.committed;
    const pick = this.candidates[Math.floor(this.rng() * this.candidates.length)];
    this.committed = pick;
    this.candidates = [pick];
    return pick;
  }

  /** The seekers have physically checked a station, so it is out either way.
   *  Returns true if they have just found the hider. */
  eliminate(station) {
    if (this.committed) return this.committed.id === station.id;
    this.candidates = this.candidates.filter((s) => s.id !== station.id);
    if (this.candidates.length === 1) this.commit();
    return false;
  }

  // ---- deck ------------------------------------------------------------

  drawCards(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!this.deck.length) {
        if (!this.discard.length) break;
        this.deck = this.discard;
        this.discard = [];
      }
      out.push(this.deck.pop());
    }
    return out;
  }

  /** What a card is worth to us right now, given what we are already holding. */
  value(card, ctx = {}) {
    const held = this.hand.filter((c) => c.kind === "curse" && c !== card).length;
    return cardValue(card, { ...ctx, cursesInHand: held });
  }

  /** Draw `draw`, keep the best `keep`, then trim back to the hand limit. */
  drawAndKeep(draw, keep, ctx) {
    const drawn = this.drawCards(draw);
    const kept = [];
    // Pick one at a time: taking a curse makes the next curse worth less.
    while (kept.length < keep && drawn.length) {
      let best = 0;
      for (let i = 1; i < drawn.length; i++)
        if (this.value(drawn[i], ctx) > this.value(drawn[best], ctx)) best = i;
      const card = drawn.splice(best, 1)[0];
      kept.push(card);
      this.hand.push(card);
    }
    this.discard.push(...drawn);
    this.trimHand(ctx);
    return kept;
  }

  trimHand(ctx) {
    while (this.hand.length > this.handLimit) {
      let worst = 0;
      for (let i = 1; i < this.hand.length; i++)
        if (this.value(this.hand[i], ctx) < this.value(this.hand[worst], ctx)) worst = i;
      this.discard.push(...this.hand.splice(worst, 1));
    }
  }

  play(card) {
    const i = this.hand.findIndex((c) => c.uid === card.uid);
    if (i >= 0) this.discard.push(...this.hand.splice(i, 1));
  }

  /** Discard `n` cards the hider values least, to pay a curse's cost. */
  payCost(n, ctx) {
    for (let i = 0; i < n && this.hand.length; i++) {
      let worst = 0;
      for (let j = 1; j < this.hand.length; j++)
        if (this.value(this.hand[j], ctx) < this.value(this.hand[worst], ctx)) worst = j;
      this.discard.push(...this.hand.splice(worst, 1));
    }
  }

  /** Time bonuses still in hand at the end, plus any Duplicate acting as a
   *  copy of the best of them -- the rulebook's stated use for that card. */
  get timeBonus() {
    const times = this.hand.filter((c) => c.kind === "time").map((c) => c.minutes);
    const base = times.reduce((a, b) => a + b, 0);
    const dupes = this.hand.filter((c) => c.kind === "powerup" && c.id === "duplicate").length;
    return base + (times.length ? Math.max(...times) * dupes : 0);
  }

  find(id) { return this.hand.find((c) => c.kind === "powerup" && c.id === id); }

  /** Housekeeping powerups, played whenever they are plainly worth it. */
  playHousekeeping(ctx) {
    const played = [];
    const expand = this.find("expand");
    if (expand) {
      this.play(expand);
      this.handLimit++;
      this.hand.push(...this.drawCards(1));
      this.trimHand(ctx);
      played.push("Expand Hand");
    }
    // Cycle a filter card only when the hand holds something genuinely poor.
    for (const [id, cost, gain] of [["draw3", 2, 3], ["draw2", 1, 2]]) {
      const card = this.find(id);
      if (!card) continue;
      const junk = this.hand
        .filter((c) => c !== card)
        .sort((a, b) => this.value(a, ctx) - this.value(b, ctx));
      if (junk.length < cost || this.value(junk[cost - 1], ctx) > 11) continue;
      this.play(card);
      for (let i = 0; i < cost; i++) this.discard.push(...this.hand.splice(this.hand.indexOf(junk[i]), 1));
      this.hand.push(...this.drawCards(gain));
      this.trimHand(ctx);
      played.push(id === "draw3" ? "Discard 2, Draw 3" : "Discard 1, Draw 2");
    }
    return played;
  }

  /** Randomize: swap the seekers' question for another in the same category.
   *  Worth doing when the one they picked is unusually revealing. */
  wantsRandomize(q, ctx) {
    const card = this.find("randomize");
    if (!card || q.visual || this.candidates.length > 30) return false;
    const buckets = new Map();
    for (const s of this.candidates) {
      const v = q.ask(s, ctx, this.world);
      const key = v === null ? " null" : String(v);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    const worst = Math.min(...buckets.values());
    return worst / this.candidates.length < 0.3 && this.rng() < 0.6;
  }

  /** Move: relocate to an adjacent station. Costs the seekers no clock, but
   *  every answer so far described where we *were*, so the ground they have
   *  ruled out partly reopens. Returns the set of stations now possible. */
  wantsMove() {
    return this.find("move") && this.candidates.length <= 4;
  }

  doMove() {
    const card = this.find("move");
    if (!card) return null;
    this.play(card);
    const neighbours = (s) => this.world.adj[s.id].map((e) => this.world.byId.get(e.to));

    if (this.committed) {
      const options = neighbours(this.committed);
      if (!options.length) return null;
      const from = this.committed;
      this.committed = options[Math.floor(this.rng() * options.length)];
      // From the seekers' side, the hider could have stepped off any station
      // that was still possible, so the new possible set is all their
      // neighbours -- including the one they actually took.
      const opened = new Map();
      for (const c of this.candidates) for (const n of neighbours(c)) opened.set(n.id, n);
      opened.set(this.committed.id, this.committed);
      this.candidates = [...opened.values()];
      return { from, to: this.committed, opened: this.candidates };
    }
    const opened = new Map();
    for (const c of this.candidates) for (const n of neighbours(c)) opened.set(n.id, n);
    this.candidates = [...opened.values()];
    return { from: null, to: null, opened: this.candidates };
  }

  hasVeto() { return this.hand.some((c) => c.kind === "powerup" && c.id === "veto"); }

  /** Decide whether to burn a veto: worth it once the seekers are closing in
   *  and the question in front of them would be genuinely revealing. */
  wantsVeto(q, ctx) {
    if (!this.hasVeto() || q.visual) return false;
    const n = this.candidates.length;
    if (n > 24) return false;
    const buckets = new Map();
    for (const s of this.candidates) {
      const v = q.ask(s, ctx, this.world);
      buckets.set(v, (buckets.get(v) || 0) + 1);
    }
    // The seekers' worst case is our best case; veto when even that cuts deep.
    const worst = Math.min(...buckets.values());
    return worst / n < 0.34 && this.rng() < 0.75;
  }

  /** Pick a curse to cast, if any looks worth it right now. */
  chooseCurse() {
    const curses = this.hand.filter((c) => c.kind === "curse");
    if (!curses.length) return null;
    const pressure = 1 - Math.min(this.candidates.length, 40) / 40;   // 0 calm, 1 cornered
    let payable = curses.filter((c) => this.hand.length - 1 >= c.cost);
    // The travel agent now books within three stops of the hider, so casting
    // it hands over most of the hiding ground in exchange for a long journey
    // off the seekers' clock. That is a good trade with the map still wide
    // open and a terrible one when cornered, which is exactly when the
    // pressure term below would otherwise reach for it.
    if (this.candidates.length < 60) payable = payable.filter((c) => c.id !== "travel_agent");
    if (!payable.length) return null;
    if (this.rng() > 0.2 + pressure * 0.65) return null;
    return payable[Math.floor(this.rng() * payable.length)];
  }
}
