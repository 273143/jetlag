// Every tunable number in the game lives here.
//
// Values follow the official Hide + Seek rulebook (rules.jetlagthegame.com)
// with two deliberate adaptations, both marked ADAPTED below:
//   1. Imperial distances are converted to round metric numbers, because the
//      maps are Czech and half-mile radii would read as noise.
//   2. Radar and Thermometer distances are scaled per map, since the same
//      number cannot serve a whole region and a single city.

export const RULES = {
  // ---- round structure -------------------------------------------------
  startClock: 8 * 60,          // rounds open at 08:00, for flavour on the HUD
  searchMinutes: 10,           // endgame: arriving in the zone, then finding them
  handLimit: 6,                // "The hider can hold up to 6 cards at once"

  // ---- the hiding period -----------------------------------------------
  //
  // The book opens a round with both sides at the same stop and a head start
  // for the hider: they travel out on public transport for a fixed window --
  // 30 minutes in a Small game, an hour in a Medium one -- and must be inside
  // their zone when it ends. The seekers then set off from the same stop.
  //
  // That window is a real constraint on the seekers' side too, and the game
  // was throwing it away. Every stop on the map used to be a candidate, so
  // the first four or five questions were spent re-deriving something the
  // rules already tell you: that a hider with half an hour cannot be at the
  // far end of the network. The candidate set now starts as **everywhere
  // reachable within the window**, which is exactly what the seekers know
  // before they ask anything.
  //
  // Windows are per map because reachability is. Measured over random
  // starting stops, the median count of stops inside the window is:
  //
  //             20m    30m    45m    60m    90m
  //   Brno       48    138    383    508    538
  //   region     13     23     48     84    148
  //
  // Brno at 30 and the region at 60 both land near a hundred-odd candidates,
  // which is a real search without being the whole map. `choices` is what the
  // start screen offers on that map, shortest first.
  //
  // An unlucky start -- a village at the end of a branch, a terminal loop --
  // can leave far fewer than that, and a round that opens with eight possible
  // stops is over before it starts. So the window widens in `widenStep`
  // minutes until at least `minStops` are inside it, up to `widenCap` times
  // the window asked for. The seekers are told the window they actually got,
  // because everything they deduce from it has to be true.
  hiding: { minStops: 25, widenStep: 10, widenCap: 3 },

  // ---- what each question costs the seekers, in minutes ----------------
  // The book gives hiders 5 minutes to answer (10 for photos); that response
  // window is the seekers' real cost, so it is charged straight to the clock.
  // The book gives the hider 5 minutes to answer, 10 for a photo, and that
  // response window is the seekers' real cost, so it is charged to the clock.
  //
  // Tentacles is priced apart. Its answer names a place instead of splitting
  // the map in two, and at five minutes like everything else it was simply
  // the best opening move every time -- the 4-draw/2-keep card cost was not
  // enough to make anyone think twice. Fifteen went too far the other way and
  // made it strictly dominated, a question no careful player would ever buy.
  // Ten leaves it the strongest question in the game and roughly level with
  // the best of the cheap ones per minute spent, which is where a luxury
  // ought to sit: worth it, but never automatic.
  askMinutes: { matching: 5, measuring: 5, radar: 5, thermometer: 5, tentacles: 10, photo: 10 },

  // ---- what the hider draws for answering, per category ----------------
  draw: {
    matching:    { draw: 3, keep: 1 },
    measuring:   { draw: 3, keep: 1 },
    radar:       { draw: 2, keep: 1 },
    thermometer: { draw: 2, keep: 1 },
    photo:       { draw: 1, keep: 1 },
    tentacles:   { draw: 4, keep: 2 },
  },

  // Asking the same question twice costs double: the hider draws and keeps
  // twice over. Third time, triple. (Rulebook: "pay its cost twice".)
  repeatCostMultiplier: true,

  // ---- per-map question parameters (ADAPTED to metric) -----------------
  //
  // Distances have to be scaled to the map or the questions stop meaning
  // anything: a 25 km radar covers all of Brno, and a 500 m radar over the
  // whole region is always "no".
  //
  // Tentacles radii are tuned by measurement, not instinct. The metric that
  // matters is the expected number of candidates left standing after one
  // answer, sum(bucket^2)/N. A balanced yes/no question leaves 50%, so
  // tentacles is set to land a little under that -- slightly stronger than
  // any other question, which is what its 4-draw/2-keep price is buying.
  //
  // Worth recording that an earlier pass tuned these on worst-case bucket
  // size and landed on 15 km, which let one tentacles question cut 179
  // stations to 1: most answers name a POI whose cell holds two or three
  // stations, and only the "none within" bucket is ever large. Measured
  // properly, the rulebook's own 1-mile radius turns out to be about right,
  // and the instinct to scale it up for a region-sized map was simply wrong.
  //
  // `transferMinutes` is what changing line costs. Only a genuine change is
  // charged, never boarding the first vehicle, since the published times
  // these were calibrated against are in-vehicle times.
  //
  // Both values come from checking against real journeys. In Brno 3 minutes
  // fits best: mean error 1.9 minutes against 2.6 with no penalty. On the
  // rail map it is 0, which is not what you would guess -- changing trains
  // obviously costs time. The reason is that the in-vehicle model, built from
  // distance and track speed limits, already runs slightly slow on direct
  // runs (Breclav 40 against a real 35, Hodonin 54 against 50), so a change
  // penalty compounds a bias instead of correcting one. The two genuine
  // underestimates left, Boskovice and Moravsky Krumlov, are branch lines
  // where the real cost is infrequent service, not the change itself, and no
  // per-transfer number fixes that.
  maps: {
    "south-moravia": {
      // An hour on the trains: a median of 84 stops inside the window, out of
      // 180. Half an hour is a dozen, which is not a game.
      hidingMinutes: 60,
      hidingChoices: [30, 60, 90],
      radarKm: [1, 2, 5, 10, 25, 50, 100],
      thermometerKm: [5, 25, 50],
      transferMinutes: 0,
      travelAgentHops: 3,
      // Museums and libraries are deliberately absent. Nearly every village
      // in the region has one, so "your nearest museum" is really just "your
      // own village" -- and the answer names something like "Muzeum Slovacka
      // chalupa", which nobody can place on a map. A target is only worth
      // having if hearing it tells you roughly where to look.
      //
      // Matching and measuring draw from separate lists, because a feature
      // does not have to be worth asking about both ways -- see the Brno
      // block, where that distinction did most of the cutting. The region
      // map has not had that pass yet, so both lists are the old `targets`
      // and its question set is unchanged.
      matching: ["river", "castle", "brewery", "hospital", "aerodrome",
                 "university", "cinema", "zoo", "theme_park"],
      measuring: ["river", "castle", "brewery", "hospital", "aerodrome",
                  "university", "cinema", "zoo", "theme_park"],
      // No `kindQuestion` here yet, so match_mode does not appear on this map
      // and its question set is unchanged by the Brno cut. The field it would
      // use is already baked: 88 stations against 92 halts, which would split
      // the region almost exactly in half. Worth adding when the region map
      // gets its own pass.
      tentacles: [
        { cat: "river",      km: 1 },                            // 47%
        { cat: "castle",     km: 3 },
        { cat: "brewery",    km: 3 },
        { cat: "aerodrome",  km: 5 },
        { cat: "cinema",     km: 5 },
        { cat: "hospital",   km: 6 },
        { cat: "university", km: 10 },
        { cat: "zoo",        km: 12 },
      ],
    },
    brno: {
      // Playtest cut. The catalogue generated 45 questions; a well-played run
      // asks eight, so 33 of them were read and skipped on every turn. Each
      // question below carries its measured strength: the share of the 542
      // stops still standing after one answer, averaged over 60 seeker
      // positions. Lower is stronger, and 50% is the ceiling for a yes/no.
      // Trimming 45 -> 19 moves the median run from 7 questions to 8 and
      // leaves the 90th percentile unchanged at 11.
      // The rulebook's Small-game window. 45 minutes reaches 383 of the 539
      // stops -- most of the city, so most of the constraint is gone -- and
      // 20 reaches 48, which is a short evening rather than a run.
      hidingMinutes: 30,
      hidingChoices: [20, 30, 45],
      radarKm: [0.5, 2, 4, 8],
      // Dropped 15 km (the widest gap between any two Brno stops is 17.1 km,
      // so from anywhere central the answer is always yes), 1 km (agrees with
      // 0.5 on 98% of stops and with 2 on 93% -- a third rung on a two-rung
      // ladder) and 0.25 km (agrees with 0.5 on 99.5%). 0.5 km survives its
      // dreadful map-wide score of 98% because it is an endgame question: a
      // fine radar was reached for 107 times in 455 simulated asks, almost
      // always once the survivors were already clustered around the seeker.
      thermometerKm: [0.5, 2],
      // 5 km was the weakest of the three and the most expensive to honour:
      // the leg crosses most of a 17 km city.
      transferMinutes: 3,
      // The timetable. Every line runs on a fixed headway from its terminus,
      // so a stop N minutes down the line departs at N, N + headway, and so
      // on from the start of service -- the whole schedule is one number per
      // mode and the departure board is derived from it. A map without
      // `headway` keeps the old free travel; see js/timetable.js.
      headway: { tram: 5, trolleybus: 10, bus: 10 },
      // How near the hider The Mediocre Travel Agent must book. Three stops
      // covers a median of 18 Brno stops, 3.6% of the map -- so playing the
      // card buys the hider a long journey off the seeker's clock and costs
      // them most of their hiding ground. That trade is the whole point; see
      // curses.js. Lower it to make the card crueller, raise it to make it
      // safer for the hider.
      travelAgentHops: 3,

      // One feature, one category. River and cinema each used to generate a
      // matching *and* a tentacles question, which plays as the same question
      // asked twice at two different prices. Each now sits wherever it is
      // stronger: the cinema in tentacles, the river here.
      //
      // The river is a matching question. Measured on strength alone it is
      // better as tentacles -- "which river?" leaves 27% of the map standing
      // against 56% for "the same river as mine?", because a yes/no is
      // strongest when the map splits in half and three rivers do not -- but
      // strength is not the only thing a category is for. The river is the
      // one feature every player already carries in their head, and whether
      // we are on the same one is the question people actually reach for. It
      // belongs among the cheap questions asked early, not behind the
      // fifteen-minute price.
      //
      // Three is also the whole list. The river query runs over a padded
      // bounding box, so it caught the Litava flowing past outside the city
      // and made it the answer for exactly two stops -- not a question, a coin
      // landing on its edge. `min_river_stops` in build_map.py drops any
      // river that thin and reassigns its stops, which is what keeps this at
      // three real answers instead of three plus a tail.
      //
      // Museums (37), libraries (23) and universities (21) are gone from both
      // lists: a target is only worth having if the player can place the
      // answer, and no one holds a list of 37 museums. Zoo is gone because
      // OSM's five Brno "zoos" are the actual zoo plus a butterfly house, a
      // llama centre, Slepicky z Rokle and Kozi zahrada, so its apparently
      // strong 63% was noise rather than geography.
      matching: ["river"],                                   // 56%
      // Every "is your nearest X closer to you than mine is to me?" scored
      // between 67.0% and 69.1% -- a 2.1 point spread across eight questions
      // built on eight different POI categories. They were one question in
      // eight costumes, and picking between them was a decision with no
      // consequence. None survive; measuring keeps only the three questions
      // in `extras`, which measure something other than a POI distance.
      measuring: [],
      // Radii are set by one rule: **the answer must name a place more often
      // than not**, measured over the stations the hider actually chooses.
      //
      // They were tuned before on expected survivors across the whole map,
      // which sounds right and is not, because the "none within" bucket
      // counts towards that score like any other. The radii it produced made
      // "there are none within 1.5 km of me" the modal answer, and against a
      // real hider it was far worse than the map-wide figure suggested: at
      // 1.5 km, hospitals answered "none" for 89% of the stations a hider
      // picks, and cinemas at 2 km for 86%. The most expensive question in
      // the game told you almost nothing almost every time.
      //
      // Widened until "none" falls under half. Brno has nine hospitals and
      // eight cinemas in a city 17 km across, so the radius that names one of
      // them has to be measured in kilometres, not in the rulebook's mile.
      // The comment on each line is the share of the map still standing.
      //
      // Aerodromes are cut: two of them, so the question had three outcomes
      // and "none within 4 km" covered two thirds of the map. A coin flip at
      // the most expensive price in the game.
      tentacles: [
        { cat: "hospital", km: 4 },                            // 16%
        { cat: "cinema",   km: 4 },                            // 20%
        { cat: "brewery",  km: 2.5 },                          // 19%
      ],

      // The questions that are not built from a POI list are declared here by
      // id, so a map can carry only the ones that work on it. Omit `extras`
      // and a map gets all of them, which is what the region map does.
      //
      // Cut for Brno: match_letter (90%) and match_length (84%), the two
      // weakest questions in the catalogue and the only two that are answered
      // by spelling rather than by geography -- worst of all for a player
      // reading Czech station names as a guest.
      extras: [
        "match_district",   // 89%, kept on legibility: the only matching
                            // answer that is a shape you can see on the map
        "match_line",       // 84%, and the rulebook's canonical target. It was
                          // 76% before the night buses came out: N89-N99
                          // ran right across the city and shared a line
                          // with almost anything.
        "match_mode",       // 60%, strongest matching question here
        "measure_lines",    // 63%
        "measure_ele",      // 65%
        "measure_hub",      // 66%
      ],
      // Wording for match_mode. The stop `kind` baked into the map is "tram"
      // where the merged stop includes a railway=tram_stop node, so the
      // question is really "trams, or no trams -- the same as me?", and the
      // context line tells the seeker which side they are on before they pay.
      // The stop `kind` baked into the map is "tram" where the merged stop
      // includes a railway=tram_stop node. Only the value is a rule; the
      // wording lives in js/i18n.js under `kind.brno.*`, because it is one
      // question with different words on each map and in each language.
      kindQuestion: { value: "tram" },
      // Zoom 11 covers most of Brno and its outskirts, so photo_sky was ten
      // minutes for a picture that could be anywhere. The other three are a
      // rooftop, a neighbourhood and a quarter of the city.
      photoZooms: [17, 15, 13],
    },
  },

  // ---- hiding zone -----------------------------------------------------
  // The book's zone is a 400 m circle the hider may roam inside. Here the
  // hider sits on the station node itself, so that every answer and every
  // deduction is computed against exactly the same point -- otherwise the
  // seeker could correctly eliminate the true station. The zone survives as
  // the endgame search area.
  zoneKm: 0.4,

  // ---- hider deck ------------------------------------------------------
  // Composition is our own balance pass: the rulebook's exact card counts
  // are not published, but the card *types* and effects below are the book's.
  deck: {
    timeBonus: [
      { minutes: 5, count: 10 }, { minutes: 10, count: 8 },
      { minutes: 15, count: 5 }, { minutes: 20, count: 3 }, { minutes: 30, count: 2 },
    ],
    // What each powerup does is in js/hider.js, what it is called is in
    // js/i18n.js under `card.<id>.name`; here only how many are in the deck.
    //
    //   veto       play instead of answering; the seekers learn only that
    //   randomize  they must ask a different question from the same category
    //   draw2/3    discard n, draw n+1, at any time
    //   expand     draw 1 and raise the hand limit by 1
    //   duplicate  counts as a copy of any other card in hand
    //   move       relocate to an adjacent station, seekers frozen
    powerups: [
      { id: "veto",       count: 3 },
      { id: "randomize",  count: 2 },
      { id: "draw2",      count: 3 },
      { id: "draw3",      count: 2 },
      { id: "expand",     count: 2 },
      { id: "duplicate",  count: 2 },
      { id: "move",       count: 2 },
    ],
    // Curses: the effects are the rulebook's; the physical casting cost and
    // physical challenge are reworked for a screen (see curses.js). `cost` is
    // how many cards must be discarded to cast it.
    curses: [
      { id: "jammed_door",   count: 2, cost: 2 },
      { id: "gamblers_feet", count: 2, cost: 1 },
      { id: "right_turn",    count: 2, cost: 1 },
      { id: "u_turn",        count: 2, cost: 1 },
      { id: "urban_explorer",count: 1, cost: 2 },
      { id: "spotty_memory", count: 2, cost: 1 },
      { id: "drained_brain", count: 1, cost: 0 },
      { id: "overflowing",   count: 2, cost: 1 },
      { id: "travel_agent",  count: 2, cost: 0 },
      { id: "hangman",       count: 2, cost: 2 },
      { id: "labyrinth",     count: 2, cost: 2 },
      { id: "endless_tumble",count: 2, cost: 0 },
    ],
  },
};

// The two hider personalities. Names and descriptions are in js/i18n.js
// under `diff.<id>.name` / `.hint`; what is a rule is only which ids exist.
export const DIFFICULTY = {
  fair:    { id: "fair" },
  devious: { id: "devious" },
};

// Whether the hider deck is in play. `false` is the pure-deduction game: no
// draws, no time bonuses, no veto, no curses, so the score is exactly the
// minutes the seeker spent. Nothing about the questions, the travel model or
// the candidate set changes with it -- see `cards` in js/game.js.
export const CARDS_DEFAULT = true;
