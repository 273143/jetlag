# Architecture

Orientation for anyone — human or agent — about to change this codebase.
[README.md](README.md) explains *why* the game is the way it is; this file
explains *where things are* and *what must not break*.

No build step, no dependencies, no framework. Plain ES modules served over
HTTP, Leaflet vendored in `vendor/`. `./run.sh` serves the directory; every
file you edit is live on the next reload.

---

## Contents

| # | Part | Files | Read it when you want to… |
| --- | --- | --- | --- |
| 1 | [The world](#1-the-world) | `js/data.js`, `data/*.json`, `js/geo.js` | change what a map contains, or how stops connect |
| 2 | [Travel](#2-travel) | `js/timetable.js`, `travelTimes` in `js/data.js` | change how moving costs time, departures, routing |
| 3 | [Rules and content](#3-rules-and-content) | `js/rules.js`, `js/questions.js`, `js/curses.js`, `js/deck.js` | retune a number, add a question, add a curse |
| 4 | [The engine](#4-the-engine) | `js/game.js` | change what asking, travelling or scoring does |
| 5 | [The hider](#5-the-hider) | `js/hider.js` | change where the hider hides or how it plays cards |
| 6 | [Rounds and matches](#6-rounds-and-matches) | `js/match.js`, `js/hidephase.js` | change the two-player flow, handovers, standings |
| 7 | [Presentation](#7-presentation) | `js/ui.js`, `js/map.js`, `index.html`, `css/style.css` | change the panel, the map, the sheets, the styling |
| 7b | [Words](#7b-words) | `js/i18n.js` | change any wording, or add a language |
| 8 | [Bootstrap](#8-bootstrap) | `js/main.js` | change the start screen, URL params, round wiring |
| 8b | [Keeping a round](#8b-keeping-a-round) | `js/save.js` | change what survives the app being closed |
| 9 | [Offline and install](#9-offline-and-install) | `sw.js`, `js/offline.js`, `js/wakelock.js`, `manifest.webmanifest` | change caching, tile packs, the screen lock, the PWA |
| 10 | [Tooling](#10-tooling) | `tools/*` | rebuild a map, measure a constant, run the tests |

Then: [The shape of one turn](#the-shape-of-one-turn) ·
[Invariants](#invariants--do-not-break-these) ·
[Where do I change X?](#where-do-i-change-x) ·
[Conventions](#conventions) · [Gotchas](#gotchas)

---

## 1. The world

`loadWorld(url)` in **`js/data.js`** fetches a baked map file and precomputes
the lookups the question engine needs. Everything downstream treats the result
as read-only.

```js
world = {
  id, name, blurb, kind,          // "brno" | "south-moravia"; kind is "pt" | "rail"
  bbox: [s, w, n, e], center: [lat, lon], attribution,
  stations: [station],            // index in this array === station.id
  byId: Map<id, station>,
  adj: [[{ to, km, minutes, lines }]],   // per station, both directions
  edges: [[a, b, km, minutes, lines]],   // raw, as baked
  lines: ["1", "2", …],           // line refs; a line is referred to by index
  lineModes: ["tram", …],         // parallel to lines
  lineStops: [[{ stops: [id], times: [min] }]],  // per line, per variant
  districts: [name], rivers: [name],
  pois: { hospital: [{ name, lat, lon }], … },
  nearest: { hospital: { name: [perStation], km: [perStation] }, … },
  hub,                            // busiest stop; used ONLY by measure_hub
  lineNames(idxs), letters,
}
```

```js
station = { id, name, lat, lon, kind, district, municipality,
            population, ele, lines: [lineIdx], degree }
```

`nearest[cat]` is the whole reason POI questions are O(1) at run time: the
nearest feature's name and distance are precomputed per station at load. Rivers
are *linear* features baked at build time (`raw.linears`) because
nearest-point-on-a-river is not nearest-to-its-centroid — they arrive in the
same shape, so every question type works on them unchanged.

**`js/geo.js`** is pure helpers: `haversine`, `nearest`, `within`, `formatKm`
(`3,2 km` / `3.2 km`), `formatDuration` (minutes → `1 h 05 min` / `1h 05m`),
`formatClock` (minutes since midnight → `08:40`). The first two read their
punctuation from the dictionary, which is the only thing the language decides
about a number.

## 2. Travel

Two models, chosen by whether the map declares a `headway` in `RULES`:

| Map | Model | Entry point |
| --- | --- | --- |
| Brno | timetabled: real departures, real waits, real changes | `timetableTimes`, `boardAt` in `js/timetable.js` |
| South Moravia | line-aware shortest path with a transfer penalty | `travelTimes` in `js/data.js` |

**`js/timetable.js`.** The whole schedule is one number per mode: a line runs
on a fixed headway from its terminus, so a stop `t` minutes down the line
departs at `t mod headway`. Nothing is looked up; the departure board is
derived. `boardAt(world, stopId, clock)` returns one entry per line *and
direction*, each with its next departures and every stop it serves onward.
Walking to an adjacent stop is always offered at 2.5× the riding time — not a
convenience, but what guarantees the graph is never a trap (some terminal loops
are served only in the arriving direction).

`timetableTimes(world, from, clock)` is that same board search run to
exhaustion, so the estimate the map shows and the price a journey charges are
the same arithmetic. Both maps' functions return the same interface:
`{ minutes: Float64Array, pathTo(id), lineTo(id) }`, plus `legs(id)` on the
timetabled one.

**A move is a whole journey.** It used to be one ride on one line: clicking a
stop off your line was refused with "ride to an interchange first", and the
seeker hand-routed the network a leg at a time. The cost model is unchanged --
`timetableTimes` was always time-dependent, so the engine's itinerary is priced
exactly as the leg-by-leg version was -- but the connecting is done for you.
`journey(state, toId)` in `js/game.js` returns that itinerary with the wait and
the time on board kept apart, and `journeyLegs` in `js/timetable.js` does the
passenger arithmetic; every screen that offers a journey shows the split, which
is the part the old restriction taught for free.

**`state.travel` is a view, not a field.** It is defined as a getter that
recomputes whenever the clock or the seeker moves. Every departure in it is
relative to the clock, and the clock moves for asking a question and for losing
a hangman guess as well as for travelling -- while it was only the map's
estimate a stale copy was merely optimistic; now that it sets the price, it
would quote trams that had already gone.

## 3. Rules and content

**`js/rules.js`** — *every tunable number in the game, with the reasoning
attached*. Numbers only: what a POI category is called, what a curse is
called, what a difficulty is called all live in `js/i18n.js` now, keyed by the
id that stays here. This is the most important file to read before changing balance.
Top-level: `startClock`, `searchMinutes`, `handLimit`, `hiding`, `askMinutes`,
`draw`, `zoneKm`, `deck`, and `maps`. Per map under `maps[id]`:
`hidingMinutes`, `hidingChoices`, `radarKm`, `thermometerKm`,
`transferMinutes`, `headway`, `travelAgentHops`, `matching`, `measuring`,
`tentacles`, `extras`, `kindQuestion`, `photoZooms`.

Numbers here are *measured*, and the comment above each one says what was
measured and what it produced. Changing one without redoing that measurement
is the main way to quietly break the game's balance.

**`js/questions.js`** — the catalogue. `buildQuestions(world)` returns an array
built from the per-map lists above. Every question is one object:

```js
{ id, cat, short, text,
  ask(station, ctx, world),   // the comparable value — the whole question
  format(answer),             // the hider's spoken reply
  context?(ctx),              // what the seeker's own value is, shown before paying
  list?(), mine?(ctx),        // every possible answer, and the seeker's own
  visual?, travelKm? }
```

`ctx` is `{ seeker }`, plus `{ from, to }` for a thermometer. Six categories:
`matching`, `measuring`, `radar`, `thermometer`, `tentacles`, `photo`.
`buildQuestions` runs per round, which is what lets the texts come out of the
dictionary in whichever language the start screen chose; `CATEGORIES` is a list
of ids only, because it is evaluated at import time, before there is a choice.

`applyQuestion` answers from the hider and filters in one step;
`filterByAnswer` keeps only stations whose `ask` produced the same value. **The
same `ask` runs on the hider and on every candidate** — that is what makes it
impossible for an answer to eliminate the hider. Photos are `visual: true` and
filter nothing: reading them is the player's job.

**`js/curses.js`** — `CURSES[id].apply(state, rng, extras)` mutates
`state.effects` (a penalty) or sets `state.challenge` (a minigame). Effects are
consumed in `game.js`: `jammedDoors`, `slowLegs`, `longWay`, `forcedReturn`,
`mustVisit`, `noRepeatAsk`, `blockedCategory`, `chalice`. Challenges are
`hangman`, `tumble`, `labyrinth`, all stepped through `challengeStep`.

**`js/deck.js`** — `buildDeck`, `shuffle`, `cardValue` (what a card is worth to
the hider AI, in notional minutes), and `mulberry32`, the seeded PRNG that
makes a whole round reproducible.

## 4. The engine

**`js/game.js`** is UI-agnostic: it mutates state, appends to `state.log`, and
returns a small result object. It never touches the DOM.

Opening a round:

```js
randomStart(world, seed)                  // a random stop with ≥2 edges
hidingRange(world, startId, wanted)        // { reach, minutes, asked, widened, stops }
newGame(world, { difficulty, seed, startId, hidingMinutes, hiderStationId })
```

`hidingRange` is the opening position: `stops` is everywhere reachable inside
the head start, and it becomes both the seeker's candidate set and the hider's
choice of hiding place. If too few stops are inside it the window widens (see
`RULES.hiding`) and `minutes` reports what was actually granted.

```js
state = {
  world, questions, difficulty, seed, rng,
  cards,                       // false is the deck-free, pure-deduction game
  seekerId, startId, previousStation,
  hiding: { reach, minutes, asked, widened, stops },
  clock,                       // minutes elapsed; the score
  candidates: [station],       // THE core object — everything still consistent
  checked: Set<id>,            // stops physically searched
  asked: Map<qid, times>, bannedQuestions: Set<qid>,
  effects, challenge, pendingThermo,
  travel,                      // getter: reachFrom(state) at the clock as it is now
  log: [{ who, text, clock, … }],   // who: system | seeker | hider | curse
  status: "playing" | "found",
  hider,                       // the Hider instance
}
```

Actions, all of which return `{ ok, … }` and refuse rather than throw:

| Call | What it does |
| --- | --- |
| `ask(state, q)` | charges the clock, gets the answer, filters candidates, lets the hider draw and maybe curse |
| `travel(state, toId)` | charges the journey, moves, searches the stop, ends the run if the hider is there |
| `challengeStep(state, input)` | one letter / one throw / one step of a curse minigame |
| `askBlocker` / `travelBlocker` | why this is not allowed right now, or `null` — the UI disables buttons with these |
| `board`, `journey`, `reachFrom` | travel queries the UI needs |
| `finalScore(state)` | `{ elapsed, bonus, total }` — the hider's score; `bonus` is always 0 with cards off |

`journey(state, toId)` is what a click on a distant stop buys: `{ minutes,
onboard, wait, changes, stops, lines, legs, timetabled }`. `travel` charges
`minutes` and the UI shows the rest.

**Cards off.** `newGame(world, { cards: false })` is the pure-deduction game.
Everything about the questions, the candidate set, the hiding window and travel
is untouched; what goes away is the hider's deck, and with it the draws, the
veto, Randomize, Move, the time bonuses and every curse. `hiderDraws`,
`maybePowerups` and `maybeCurse` each return early on the flag, and `Hider`
never builds a deck — both sides, so neither depends on the other noticing.
The score becomes the clock exactly.

## 5. The hider

**`js/hider.js`** — one class, two personalities, plus a person.

| | Behaviour |
| --- | --- |
| `fair` | commits to a stop in the constructor, answers from it |
| `devious` | never commits; answers whichever truthful value leaves the most candidates standing, forced to commit at one candidate or at a photo |
| human | `hiding.stationId` is passed in from the pass-and-play hiding phase; behaves as `fair` |

`this.candidates` mirrors the seeker's set — the selftest asserts the two views
never disagree. `chooseStation()` scores stops inside the hiding window on how
much of the window they use plus how many stops sit within 2 km (camouflage),
and picks from the strong tail so it varies.

The rest is deck play: `drawAndKeep`, `trimHand`, `payCost`, `timeBonus`, and
the decision functions `wantsVeto`, `wantsRandomize`, `wantsMove` / `doMove`,
`chooseCurse`, `playHousekeeping`. These run automatically **even in a
two-player match** — a person chooses where to hide and nothing else.

## 6. Rounds and matches

**`js/match.js`** — no DOM, no game state. Whose turn it is, where the next
round starts, what everyone has scored: `round`, `hiderIndex`, `results`,
`roundSeed()`, `record(state, score)`, `advance(foundStationId)`, `totals`,
`hidesEach`, `level`, `leader`. Rounds chain — `advance` sets `startId` to the
stop where the hider was found.

**`js/hidephase.js`** — the two screens a pass-and-play round needs, both
promises so `main.js` reads as a sequence of awaits:

- `handoff({ eyebrow, title, text, action })` — full-screen cover. Resolves on
  the button. Nothing behind it is painted for the incoming player.
- `hidePhase({ gmap, world, start, range, name })` — resolves with the chosen
  station id. Swaps `gmap.onStationClick`, adds `#app.hiding`, drives
  `#hidebar`.

## 7. Presentation

**`js/ui.js`** — the panel. Holds no rules: it reads state, calls the handlers
it was given, and asks `*Blocker()` why a button should be disabled.

```js
new UI(state, gmap, { ask, travel, challenge, nextRound }, { match })
```

`refresh()` rebuilds everything and is called after every action. `renderLog`
appends only new entries (`this.logged`).

The panel below the header is **two panes sharing one column**, not two stacked
boxes: `#askpane` (the category tabs and the question list) and `#logwrap` (the
answers). `this.pane` says which is up, `setPane()` swaps them, and `renderLog`
calls `setPane("log")` itself whenever a hider answer or a curse arrives — so
asking is still one click, and reading the reply costs none. The count on the
Answers tab is the number of hider entries in the log. The panes exist because
the text is big enough to read on a tram: split, neither half showed three
lines. Note `setPane` re-pins the log's scroll on the way in — a hidden element
has no scroll height, so it cannot be done while the pane is away.

Modal sheets: the departure board,
the ride confirmation, the three curse minigames, the result — and
`showMatchResult`, which adds standings and the handover. `dispose()` must be
called before a new round's UI takes over (it drops the labyrinth key handler).
`esc()` lives here and is the only HTML escaper — use it for anything
interpolated, including anything going into a `t()` template.

`journeyHtml(plan)` is the itinerary — the wait/ride split and one row per leg
— and is shared by the map popup and the confirmation sheet, so the number on
the button is always the sum of the rows under it.

**`js/map.js`** — Leaflet. One `GameMap` for the whole session; rounds reuse
it.

| Method | Use |
| --- | --- |
| `render(state)` | the seeker's paint: candidates amber, seeker blue, searched grey, found red |
| `renderReach({ startId, reach, window, chosenId })` | the hiding period's paint: brighter the deeper into the window |
| `showConstraint(state, q, answer)` | the geometry behind the last answer (radar disc, thermometer leg) |
| `drawRanges` | radar rings around the seeker, redrawn only when it moves |
| `reset()` | between rounds: clear overlays, close popups **and tooltips**, refit |
| `fitWorld()` / `fitStops(stops)` | framing |
| `makePhoto(el, {lat, lon, zoom})` | the aerial crop a photo question answers with |

The palette is read from CSS custom properties once, so colours stay in
`css/style.css`.

**`index.html`** is a static shell: `#app` (map + `#panel`, whose panes are
`#askpane` and `#logwrap`, switched by `#pane`), `#hidebar`,
`#handoff`, `#modal`, `#start`. Everything inside is filled in by JS; nothing
is templated.

## 7b. Words

**`js/i18n.js`** holds every user-facing string, in Czech and English, in one
file with the two dictionaries side by side. Czech is the default; English is
kept because the rulebook this implements is published in English, and a
wording that has drifted from the book shows up on that side.

```js
t("log.travel", { name: esc(dest.name), n: 3 })   // values arrive escaped
```

Placeholders are `{name}` for a value and `{name:a|b|c}` for a form chosen by
it. The chooser does double duty, which is what keeps Czech readable with no
plural library: a number picks 1 / 2-4 / 5+ in Czech and 1 / other in English
(the arity of the list says which), and `"m"`/`"f"`/`"n"` picks a grammatical
gender. Gender is why a POI category carries `poi.<cat>.one`, `.many` and `.g`
rather than a bare label: "is your nearest X the same as mine?" is one sentence
in English and three in Czech, and the question templates are written to keep
every label in the nominative so no case table is needed.

`applyStatic()` fills the shell from `data-i18n`, `data-i18n-html` and
`data-i18n-ph` attributes in `index.html`. `initLang(param)` picks the language
— `?lang=` first, then what was chosen last time, then an outright English
browser preference, then Czech — and the start screen's picker calls `setLang`
and repaints. The language is fixed for the length of a round: log entries are
worded when they happen.

`tools/i18ncheck.js` runs first in `tools/test.sh` and fails the build if the
two dictionaries diverge, if a key the code asks for is missing, if a key
nobody asks for is left behind, or if a `{value}` exists on one side only.
Missing text is silent at run time, which is exactly why it is checked here.

## 8. Bootstrap

**`js/main.js`** wires it together: map picker, players picker, hider picker,
hiding-period picker, offline controls, then

```
start() → playRound() → [handoff → hidePhase → reset → handoff] → newGame → new UI
                              ↑                                            │
                              └──────── on.nextRound ← result sheet ←──────┘
```

URL parameters: `?map=`, `?seed=`, `?hider=fair|devious`, `?hiding=<minutes>`,
`?players=2`, `?lang=cs|en`, `?cards=0` (the deck-free game), `?go=1` (start
immediately), `?fresh=1` (unregister the service worker and empty the app
cache). `window.__debug` is set every round — `{ phase, state, ui, gmap, match,
start, range, ask, travel, journey, … }` — and is what the UI tests drive.

## 8b. Keeping a round

**`js/save.js`** writes a half-played round to local storage so closing the
app does not lose it.

What is stored is *the minimum that cannot be recomputed*, because the rest of
the engine is deterministic and recomputing is far safer than serialising. A
round is `newGame(world, {seed, startId, difficulty, cards, hidingMinutes})`
plus everything that has happened since — so a snapshot is those arguments and
the mutable half of the state, and `restore` is `newGame` again followed by the
mutable half put back over the top. The question catalogue, the hiding window,
the reachability search and `state.travel` all rebuild themselves, which is why
none of them are in the file.

Three things needed care:

- **The random streams.** `state.rng` and `hider.rng` are closures; their whole
  state is the one word `mulberry32` keeps, exposed as `rng.position()`. Saving
  the position and re-seeding with it continues the identical stream. Save the
  *seed* instead and a resumed round keeps its clock and quietly rerolls the
  deck and every curse — which looks perfect at the moment of restore.
- **Sets, Maps and stations.** None survive JSON. A station is stored by id and
  looked up on the way back, so a restored candidate is the same object the
  rest of the game compares against.
- **The hiding place is in the snapshot**, because the app has to answer from
  it. No worse than `window.__debug`, but worth knowing.

`main.js` calls `keep(state)` after every handler that moves the state, plus
once before the handover so a round closed during the hiding phase resumes into
the same round. One slot, versioned (an old snapshot is discarded, never
half-read), and dropped after 24 hours.

The start screen offers it back on a card above everything else, with what it
is — map, clock, how many stops are left, or in a match the round and both
players. Resuming switches to the language the round was played in: the log is
a transcript that has already been written.

`tools/selftest.html` round-trips a state through JSON and then drives the
original and the copy through the same decisions, asserting they stay identical
— a field-by-field comparison at the moment of restore cannot see a rerolled
deck. `tools/resumetest.html` does the whole thing through the real start
screen, solo and as a match.

## 9. Offline and install

**`sw.js`** precaches the app shell (`SHELL_FILES`) and serves app files
**network-first** so an edit shows up on the first reload; the cache is the
offline fallback. Tiles are cached separately and never purged.

**`js/offline.js`** downloads tile packs on request. Tiles are packed
three-by-three around each *stop* rather than wholesale, which is the
difference between a couple of thousand tiles and hundreds of thousands.
`PACKS` holds the zoom levels per map.

The start screen nags about this. `tilesAreMissing` / `nagAboutTiles` in
**`js/main.js`** put a sheet in front of the Start button when the map pack is
under half stored -- once per session, and never when already offline, where
there is nothing to be done about it. It hangs off the button's click handler
rather than `start()` so that `?go=1` and both UI tests still go straight in.

**`js/wakelock.js`** holds a `screen` wake lock for the length of a round:
`keepAwake()` at the top of `playRound`, `releaseWake()` on the find. The
browser revokes the lock whenever the page is hidden, so it re-acquires on
`visibilitychange` rather than assuming one request lasts. Entirely
best-effort -- unsupported or refused changes nothing about the game.

## 10. Tooling

| Command | What it does |
| --- | --- |
| `./run.sh` | serve on :8080 |
| `./tools/test.sh` | the dictionary check, then 60 automated runs, invariants, and what actually fired |
| `node tools/i18ncheck.js` | the two dictionaries against each other and against the code |
| `./tools/uitest.sh` | drives the real UI: a full run per map, one with cards off, one in English, a full two-player match per map, closing and resuming the app, then the offline nag and the phone-sized layout |
| `./tools/shot.sh 'index.html?go=1' out.png` | headless screenshot, for looking at the UI without a display |
| `python3 tools/build_map.py all` | rebuild `data/*.json` from OpenStreetMap |
| `python3 tools/survey_pois.py brno` | score candidate POI categories as questions |
| `python3 tools/tune_tentacles.py brno` | pick Tentacles radii by measurement |

Test pages: `tools/selftest.html` (engine), `tools/uitest.html` (one run),
`tools/2ptest.html` (a whole match), `tools/resumetest.html` (closing the app
mid-round and picking it back up, solo and as a match), `tools/nagtest.html` (the offline sheet in
front of Start — it detects whether the browser has a working Cache API and
asserts the fallback instead where it does not), `tools/phonetest.html` (the
full-screen overlays at 412x915 and 360x640) — the shell scripts above are thin wrappers
that serve the directory and point headless Chromium at them, sharing
`tools/lib.sh` (`serve`, `browse`, `report`). The Python side shares
`tools/osmlib.py` (OSM fetching, geometry, POI categories) and
`tools/overpass.py` (the cached Overpass client — responses land in
`.cache/overpass/`, so a rebuild does not re-hammer the API).

Each browser run gets a throwaway Chromium profile — with a shared one the module cache served stale JavaScript and a run
once passed against a function that did not exist. `tools/lib.sh` finds
whichever name Chromium goes by on the machine (`chromium-browser`,
`chromium`, `google-chrome`…), or honours `CHROME=/path/to/it`; hardcoding one
meant the suite silently did not run at all on the other, which looks exactly
like it passing.

---

## The shape of one turn

```
click a question                 click a stop on the map
      │                                  │
ui.on.ask(q)                       ui.on.travel(station)
      │                                  │
game.ask(state, q)                 game.travel(state, id)
  askBlocker                         travelBlocker
  charge(askMinutes)                 charge(journey)
  hider.wantsRandomize / wantsVeto   move seeker, checked.add
  hider.answer(q, ctx) ──────┐       hider.eliminate(dest) → found?
  filterByAnswer(candidates) ─┴─ q.ask runs on both sides
  hider.drawAndKeep                  resolveThermometer
  maybePowerups / maybeCurse         checkCornered
      │                                  │
      └──────────► state.log ◄───────────┘
                      │
                 ui.refresh() → panel + gmap.render(state)
```

## Invariants — do not break these

1. **One `ask` per question, run on both sides.** Answering and filtering must
   call the same function. Anything else can eliminate the stop the hider is
   standing on, which is how deduction games go quietly wrong.
2. **The candidate set always contains the hider** while `status === "playing"`,
   and never empties. Both are asserted by `tools/test.sh`.
3. **Everything the seeker sees must follow from what they were told.** The
   hiding window is disclosed, so the candidate set may be restricted by it.
   A restriction the seeker is *not* told about would make the amber dots lie —
   which is why the hider's preference for spending the window is a preference
   and not a floor.
4. **Determinism.** All engine randomness goes through `mulberry32` seeded from
   `state.seed`. No `Math.random` in `js/game.js`, `js/hider.js`, `js/deck.js`
   or `js/curses.js` — a seed has to reproduce a round exactly.
5. **Only `game.js` moves the clock** (its `charge`). The UI never adds minutes.
6. **`ui.js` holds no rules.** If the UI needs to know whether something is
   allowed, it asks `askBlocker` / `travelBlocker`.
7. **Nothing on screen at a handover may reveal the hiding place** — text, map
   zoom, an open popup or an open Leaflet tooltip. `gmap.reset()` before the
   handover, and `tools/2ptest.html` asserts it.
8. **Numbers live in `js/rules.js`** with the measurement that produced them,
   and **words live in `js/i18n.js`**, in both languages, checked by
   `tools/i18ncheck.js`.
9. **A resumed round is the same round.** Anything added to the state must be
   added to `snapshot`/`restore` in `js/save.js`, and anything that consumes
   randomness must go through a generator whose position is saved. Asserted by
   `tools/test.sh`, which replays both copies rather than just comparing them.
10. **A journey's `wait` and `onboard` sum to what it charges.** The seeker
   decides on the split as much as on the total; a split that did not add up
   would be a lie nothing else in the game would notice. Asserted by
   `tools/test.sh`.

## Where do I change X?

| I want to… | Change |
| --- | --- |
| change any wording, or add a language | `js/i18n.js` — then `node tools/i18ncheck.js` |
| retune a question's price or card cost | `RULES.askMinutes`, `RULES.draw` |
| change a radar / thermometer / tentacles radius | `RULES.maps[id]` — and re-measure with `tools/tune_tentacles.py` |
| change the hiding window | `RULES.maps[id].hidingMinutes` / `.hidingChoices`; the floor is `RULES.hiding` |
| add a question | `js/questions.js` (the object), then list its id in `RULES.maps[id].extras` or its target in `matching` / `measuring` / `tentacles` |
| remove a question from one map only | `RULES.maps[id].extras` |
| add a curse | `RULES.deck.curses` + `CURSES[id]` in `js/curses.js`; a minigame also needs a `render*` in `js/ui.js` and a branch in `challengeStep` |
| change how the hider chooses a hiding place | `Hider.chooseStation` |
| change how the hider plays cards | `cardValue` in `js/deck.js`, and the `wants*` methods in `js/hider.js` |
| change journey cost or departures | `js/timetable.js` (Brno) or `travelTimes` in `js/data.js` (region) |
| change what a journey shows before it is paid for | `journey` in `js/game.js`, `journeyHtml` in `js/ui.js` |
| change what the deck-free game removes | the `cards` guards in `js/game.js` and `js/hider.js` |
| add a field to the game state | `js/game.js` — **and** `snapshot`/`restore` in `js/save.js` |
| change what survives the app closing | `js/save.js`; bump `VERSION` if the shape changes |
| change the map's colours or dots | `js/map.js` + the custom properties in `css/style.css` |
| change the panel, sheets or wording | `js/ui.js` |
| change the round or match flow | `js/main.js`, `js/match.js`, `js/hidephase.js` |
| change offline nagging or the screen lock | `tilesAreMissing` in `js/main.js`, `js/wakelock.js` |
| change a full-screen overlay (`#start`, `#handoff`) | `css/style.css` — keep it `display:flex` + `overflow-y:auto` with `margin:auto` on the card, or it stops scrolling on a phone |
| **add a new `js/*.js` file** | also add it to `SHELL_FILES` in `sw.js` **and bump `SHELL`** |
| add a new map | `MAPS` in `js/data.js`, `RULES.maps`, `MAPS` in `tools/build_map.py`, `PACKS` in `js/offline.js`, `SHELL_FILES` in `sw.js` |

## Conventions

- **Comments explain why, not what.** The house style is a paragraph above a
  constant or a function saying what was tried, what it measured, and what went
  wrong with the obvious alternative. Match it; a `// increment i` comment is
  more out of place here than no comment.
- **Constants are measured.** If you change a balance number, say in the comment
  what you measured to justify it. `tools/` exists for exactly this.
- **No dependencies, no build step, no framework.** Leaflet is vendored so that
  offline means offline.
- ASCII in source comments (`--` rather than an em dash); UTF-8 is fine in
  user-facing strings and in Czech place names.
- Tests are the contract. Add an assertion when you add behaviour — especially
  for anything that can fail *silently*, which is most of this game.

## Gotchas

- **Service worker staleness.** If a change does not show up, a registered
  worker is serving its cached copy. `?fresh=1` fixes it; if the cached copy
  predates that escape hatch, serve on a different port (a different origin has
  no worker) or unregister via DevTools → Application.
- **Leaflet opens a tooltip on click, not just hover**, and on a touch screen
  nothing closes it again. That is a two-player information leak; `reset()`
  closes them.
- **`world.hub` is not the starting stop** any more — it is only the target of
  the `measure_hub` question. Rounds start at `randomStart`.
- **`degree` vs `lines.length`.** `degree` is graph edges; `lines` is transit
  lines serving the stop. Both are baked, and they mean different things.
- **A journey is priced when it is offered and charged when it is taken**, and
  both read `state.travel`, which is a getter tied to the clock. Anything that
  moves the clock without going through `charge` will quote departures that
  have already left.
- **The hider's `Move` powerup can put them outside the hiding window**, so the
  "everyone is inside the window" check only holds at round start.
- Tests take about a minute each; `uitest.sh` runs four browser sessions.
