// A pass-and-play match: two people, one device, taking turns to hide.
//
// The rulebook's match is a series of rounds in which everyone hides once and
// the hider with the longest survival wins. That works on one phone because
// the two roles never need the screen at the same time: the hider chooses a
// stop and hands the device over, and from then on the app answers on their
// behalf from where they actually are. What the hider gives up by not holding
// the phone is card play, which stays automatic -- the alternative is passing
// the device back for every single question.
//
// Rounds chain: whoever is found is found *somewhere*, and that stop is where
// the next round begins, for both sides. So a match is a walk across the map
// rather than two unrelated rounds, and a hider who runs a long way buys
// their opponent a start in unfamiliar country.
//
// This module holds no DOM and no game state -- just whose turn it is, where
// the next round starts, and what everyone has scored.

export class Match {
  /**
   * @param {string[]} names   the two players, in the order they hide
   * @param {number}   seed    the match seed; each round derives its own
   * @param {number}   startId where round one begins, or null for random
   */
  constructor({ names, seed, hidingMinutes = null, startId = null }) {
    this.names = names;
    this.seed = seed >>> 0;
    this.hidingMinutes = hidingMinutes;
    this.startId = startId;
    this.round = 1;
    this.hiderIndex = 0;
    this.results = [];
  }

  get hiderName() { return this.names[this.hiderIndex]; }
  get seekerName() { return this.names[1 - this.hiderIndex]; }
  get nextHiderName() { return this.names[1 - this.hiderIndex]; }

  /** Each round gets its own seed, so the deck and the curses differ from one
   *  round to the next even when the map and the players do not. */
  roundSeed() {
    return (this.seed + this.round * 2654435761) >>> 0;
  }

  /** Record the round that has just ended. The score is the hider's: the
   *  clock the seeker burned plus the time bonuses still in the hider's hand,
   *  which is the rulebook's number and the one being compared. */
  record(state, score) {
    this.results.push({
      round: this.round,
      hider: this.hiderName,
      seeker: this.seekerName,
      station: state.hider.committed,
      elapsed: score.elapsed,
      bonus: score.bonus,
      total: score.total,
    });
  }

  /** Hand over: the finder becomes the hider, and the next round starts where
   *  the last one ended. */
  advance(foundStationId) {
    this.round++;
    this.hiderIndex = 1 - this.hiderIndex;
    this.startId = foundStationId;
  }

  /** Total minutes survived per player, in the order they were named. */
  get totals() {
    return this.names.map((n) =>
      this.results.filter((r) => r.hider === n).reduce((a, r) => a + r.total, 0));
  }

  /** How many rounds each has hidden. A comparison only means anything when
   *  both numbers are equal, which is every second round. */
  get hidesEach() {
    return this.names.map((n) => this.results.filter((r) => r.hider === n).length);
  }

  get level() {
    const [a, b] = this.hidesEach;
    return a === b;
  }

  /** The player ahead on total time hidden, or null if it is tied or unfair
   *  to say yet. */
  get leader() {
    if (!this.level) return null;
    const [a, b] = this.totals;
    if (a === b) return null;
    return a > b ? this.names[0] : this.names[1];
  }
}
