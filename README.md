# Hide + Seek — South Moravia & Brno

A computer version of the hide-and-seek game from *Jet Lag: The Game*, played
across real Czech transit networks. A round opens at a random stop; the hider
gets a head start to travel and go to ground; then you ask questions, read the
map and close the net. Your score is the clock when you find them, and lower is
better.

Play it on your own against the app, or **two of you on one phone**: one hides
and passes the device over, the other seeks, and whoever is found is found
somewhere — which is where the next round starts. See
[Two players, one device](#two-players-one-device).

Two maps, roughly the rulebook's Large and Small games:

| Map | Network | Stops | Lines |
| --- | --- | --- | --- |
| South Moravia | regional trains | 180 | 26 |
| Brno | trams, trolleybuses and buses | 539 | 80 |

```
./run.sh          # then open http://localhost:8080/
```

If you have opened it before and a change does not show up, the service worker
is serving you its cached copy of the app. **http://localhost:8080/?fresh=1**
unregisters it and empties the app cache, then reloads clean — downloaded map
tiles are kept. App files are fetched network-first, so this should only ever
be needed after an update that changes the service worker itself.

It also installs to an Android phone — see [On a phone](#on-a-phone).

No build step and nothing to install — plain ES modules, served by Python's
`http.server`. An internet connection is needed for map tiles; the game data
itself is two small JSON files in the repo.

## What the game actually is

Strip away the travel vlog and this is a deduction game over real geography
with a time economy. Every answer is a geometric constraint on the map:

| Question | Constraint |
| --- | --- |
| Radar — "within 4 km?" | a disc, drawn on the map as a ring |
| Thermometer — "hotter after I moved?" | a half-plane, the bisector of your leg |
| Measuring — "higher up than me?" | a half-plane |
| Matching — "same district? same line? same nearest river?" | set membership |
| Tentacles — "which hospital are you nearest?" | a Voronoi cell |

So the engine is one object: **the candidate set**, every station still
consistent with everything the hider has said. It drives the amber dots on the
map, win detection, and the hider's own reasoning. It opens as everywhere the
hider could have reached in their head start — the first constraint of the
round is the one the rules hand you before anyone asks anything.

The other half is the clock. A question costs 5 minutes — 10 for a photo or
for Tentacles — and a journey costs what the timetable costs. That is the whole
tension: questions are cheap but each one hands the hider cards, and cards
become curses.

Tentacles is priced apart on purpose. It is the one question whose answer names
a place rather than splitting the map in two, and at five minutes like the rest
it was simply the best opening move every time. Fifteen went too far the other
way and made it a question no careful player would ever buy. Ten leaves it the
strongest question in the game and roughly level with the best cheap ones per
minute spent, which is where a luxury belongs: worth it, never automatic.

## Faithful to the rulebook, with four deliberate changes

The rules follow [rules.jetlagthegame.com](https://rules.jetlagthegame.com) —
the six question categories, their draw/keep values (matching and measuring
3/1, radar and thermometer 2/1, photo 1/1, tentacles 4/2), the doubling cost of
repeat questions, the six-card hand limit, time bonuses that only count if
still in hand, vetoes, and the curse deck. Where a rule could not survive
contact with a screen, the change is marked in the source:

**Photos become aerial imagery.** A browser cannot ask you for a photograph, so
the hider replies with a real satellite crop centred on themselves at one of
four zoom levels — a rooftop, a neighbourhood, a town, a landscape. It is the
one question the game does not filter for you: like a real photo, reading it
is your job. Brno keeps only the first three: at the widest zoom the crop
covers most of the city, so it cost ten minutes for a picture that could have
been taken anywhere.

**Curses become minigames.** Most of the book's curses are physical —
photograph a more expensive car, stack a cairn, tie a lemon to your coat. Their
*function* is to burn the seekers' time, so each is rebuilt as either a
mechanical penalty (The Gambler's Feet slows your next journeys, The U-Turn
sends you back) or a timed minigame you must clear before continuing: hangman
at 2 minutes a wrong letter, a labyrinth at 1 minute a step, a die you must
roll to a 5 or 6 at 5 minutes a throw.

Those two numbers used to be 8 and 2, and they were far too high. A single bad
hangman word ran to a hundred minutes — longer than the rest of the run put
together — which is not a curse burning your time, it is a different game
bolted on that decides the round on how well you guess Czech nouns. The maze
was the same problem more quietly: a dozen-odd steps out of a 7×7 grid plus a
wrong turn or two, at two minutes each. A curse should hurt and then be over.

**The hider sits on the station node.** The book gives them a 400 m zone to
roam. Here they stay on the point itself, so that answering a question and
filtering the candidate set run against exactly the same coordinates — the
alternative is a game that can correctly eliminate the station the hider is
standing on. The zone survives as the endgame search.

**Distances are metric, per-map, and measured rather than guessed.** A 25 km
radar covers all of Brno; a 500 m radar over the region is always "no". So is
the *set* of questions each map offers — see "How many questions" below. All of
it lives in `js/rules.js`, where every tunable number sits with the reasoning
attached.

## The hiding period, and where a round starts

The rulebook opens a round with both sides at the same stop and a head start
for the hider: they travel out on public transport for a fixed window — 30
minutes in a Small game, an hour in a Medium one — and must be in their zone
when it ends. The seekers then set off from the same stop.

Both halves of that used to be missing, and both were costing the game
something real.

**The starting stop is now drawn at random** rather than being the network hub.
The hub is one stop. Every Brno round opened at the main station and every
regional round at Brno hl.n., which meant the same opening board and the same
first three questions every single time. Stops with a single edge are skipped:
a terminus is a fine place to hide and a poor place to start, because the first
move is forced.

**The candidate set now starts as everywhere inside the window.** Before, every
stop on the map was a candidate, so the first four or five questions were spent
re-deriving something the rules already tell you — that a hider with half an
hour cannot be at the far end of the network. Measured over random starting
stops, the number of stops inside the window is:

| | 20m | 30m | 45m | 60m | 90m |
| --- | --- | --- | --- | --- | --- |
| Brno | 48 | 138 | 383 | 508 | 538 |
| South Moravia | 13 | 23 | 48 | 84 | 148 |

So Brno hides in 30 minutes and the region in 60, both adjustable on the start
screen. The effect on a run is large: the median Brno round went from 18
questions and 339 minutes to 10 questions and 191.

An unlucky start — a village at the end of a branch, a terminal loop — can put
far fewer than that in play, and a round that opens with eight possible stops is
over before it starts, so the window widens in ten-minute steps until at least
25 stops are inside it. The seekers are told the window they actually got,
because everything they deduce from it has to be true.

That last point is why the window is a ceiling and not a floor. The hider
prefers to spend most of the head start — a stop deep into the window scores
better in `chooseStation` — but it is only a preference. Any stop inside the
window has to be a real possibility, or the amber dots on the map would be
quietly lying about where the hider can be.

## What the questions are asked about

Targets are chosen per map, and the test is whether hearing the answer tells
you roughly where to look.

Both maps use **rivers**, **transit lines**, **districts** and elevation, plus
a handful of POI categories. Rivers turned out to be the best geographic target
on offer: in Brno "which river are you nearest to" carves the city into three
real pieces (Svratka 245 stops, Svitava 197, Ponávka 97), and across the region
it gives real basins — Dyje 38, Svratka 25, Svitava 25, Litava 24, Morava 17,
then a dozen smaller ones. They are also linear features, so nearest is computed
to the nearest point on the river, not to a centroid an arbitrary distance away.

The Ponávka needs a word, because it is the one target that had to be named by
hand. OSM tags it `waterway=stream` — it is small and culverted for much of its
run through the centre — so the plain `waterway=river` query missed it, and
widening that query to streams would have buried the question under forty named
potoky. It arrives instead through `extra_waterways` in `build_map.py`.

The list is exactly three, and that took a second guard. The river query runs
over a padded bounding box so lines are not clipped, which meant Brno also
caught the Litava flowing past outside the city — nearest to precisely two
stops. An answer that names two stops out of 542 is not a question, so
`min_river_stops` drops any river that thin and reassigns its stops to their
next nearest. Either the map has three rivers or it has two; what it must not
have is a long tail. The region map has not opted in — it would lose twelve
names, which is a decision for its own pass.

It also produced the one genuinely surprising result of the whole pass. Adding
it made the river question *worse* as Matching and much better as Tentacles.
Matching asks "is your nearest river the same as mine?", which is a yes/no, and
a yes/no is strongest when the map splits in half — which two rivers did almost
exactly (Svratka 298, Svitava 242, and 50% survivors). A third real bucket
unbalances that: 54%. But Tentacles asks *which one*, and there three placeable
answers beat two — 27% survivors at a 2 km radius, against 50% before. Better
data moved the question to a different category rather than strengthening it
where it was. The river is now the strongest question in the Brno catalogue.

**Museums, libraries and universities are absent from both maps.** Nearly every
village in South Moravia has a museum, so "your nearest museum" is really just
"your own village" — and the answer names something like *Muzeum Slovácká
chalupa*, which nobody can place. Brno has the opposite problem and the same
result: 37 museums, 23 libraries and 21 faculty buildings, none of which a
player holds in their head. A target is only worth having if you can put the
answer on a map. `tools/survey_pois.py` scores any candidate category the same
way, if you want to add more — but score it for legibility by eye as well.

**Means of transport** is Brno's strongest matching target, and the most legible
question in the game: 147 of its stops are reached by trams and 392 are not, so
"tram, or not?" is a question you can partly answer by looking at the map before
you ask it. It comes from the `kind` the build already records per stop. The
rail map carries the same field with different values — 88 stations against 92
halts — and could ask the same question, but has not been given the wording yet.

The region's districts are the 21 ORP areas; Brno's are its 29 městské části.
Brno gets no finer division than that: the suburb and quarter names OSM carries
are katastrální území, which split the city further without telling you
anything a district would not.

## How many questions, and why so few

Brno's catalogue used to generate 45 questions. A playtest found the obvious
problem: a well-played run *asks* eight, so on every turn the other 33 were read,
weighed and skipped. The evening went into browsing, not deducing.

Every question was measured the same way — the share of the 542 stops still
standing after one answer, averaged over 60 seeker positions. Lower is stronger,
and 50% is the ceiling for anything answered yes or no. Two findings did most of
the cutting:

- **Eight of the eleven Measuring questions were one question in eight
  costumes.** "Is your nearest museum / library / cinema / hospital / brewery /
  university / zoo / river closer to you than mine is to me?" scored between
  67.0% and 69.1% — a 2.1 point spread. Picking between them was a decision with
  no consequence. None survive.
- **A feature does not belong in two categories.** River and cinema each
  generated both a Matching and a Tentacles question, which plays as the same
  question asked twice at two different prices. The cinema kept its Tentacles
  slot, where it is 47% against 68%. The river kept Matching, which is the one
  place a measurement was overruled: "which river?" is much the stronger
  question at 27% against 56%, but the river is the feature every player
  already carries in their head, and asking whether we share one is what people
  reach for. It belongs among the cheap questions.

The rest went for being degenerate — a 15 km radar on a city whose widest gap is
17.1 km is always "yes"; a 0.25 km radar gives the same answer as the 0.5 km one
on 99.5% of stops; a Tentacles question about Brno's two aerodromes was a coin
flip charged at the most expensive price in the game — or for being answerable by
spelling rather than by geography, which is what *"does your station's name start
with the same letter as mine?"* really is.

That leaves **19 questions on Brno**: 4 radar, 2 thermometer, 4 matching, 3
measuring, 3 tentacles, 3 photo. Across 40 simulated runs the cut moves the
median from 7 questions to 8 and leaves the 90th percentile unchanged at 11 —
the menu shrinks by 58% and the game does not get longer.

One number in there is worth knowing about. Map-wide, the 0.5 km radar is the
*worst* question in the catalogue: 98.4% of stops survive it. It is kept because
that figure describes the opening, not the endgame — across 60 simulated runs
the seeker reached for a fine radar 107 times out of 455 asks, almost always
once the survivors were already clustered around them. A question's average
strength is not its strength when you need it.

South Moravia has not had this pass and its 49 questions are unchanged. Its
measuring questions are not the twins Brno's were, because 180 stations spread
over a whole region put real distance between the targets.

## Reading distance off the map

Every distance the game quotes is in kilometres — radar radii, tentacles radii,
"3.2 km from it" — and the one thing a slippy map will not tell you is how big
it currently is. So there is a **scale bar** in the bottom-left, and **dashed
rings around the seeker at exactly this map's radar distances**, labelled. "Are
you within 4 km of me?" is a shape, and you should be able to see the shape
before deciding whether the answer is worth five minutes.

## Seeing the answers before you pay

A question that names a place is only information if you know what else it
could have named. Being told your nearest hospital is the Vojenská nemocnice
means nothing until you know there are eight others.

So every question that has an answer set carries it, and the panel shows it
before you spend the five minutes: a disclosure under each question listing all
of its possible answers, with **your own** highlighted. Three rivers, nine
hospitals, eight cinemas, thirteen breweries, twenty-nine districts, ninety-one
lines. Each question also shows what it would be comparing against — *"yours is
Kino Art"*, *"you are on 1, 3, N90"* — which the engine already computed and
used to write into the log *after* the ask, on the wrong side of the decision.

## Night services

Brno's map carries daytime services only. The round opens at 08:00 and every
headway in the timetable is a daytime one, so the eleven night lines N89–N99
were putting departures on the board for vehicles that do not run at the hour
the game is played — and they were doing more damage than that. Running right
across the city, they made *"is your stop served by any of the same lines as
mine?"* far weaker than it should be: 76% of the map survived that question
with them in, 84% without, because almost any two stops shared a night bus.

Dropping them takes Brno from 542 stops to 539 and from 91 lines to 80.
Achtelky, Jundrovská and Zvonařka went with them: those three are served by
nothing else, so at eight in the morning they are not places anybody is hiding.
`skip_lines` in `build_map.py` keeps them out of a rebuild.

## Where the hider hides, and why Tentacles was useless

A playtest found Tentacles answering *"there are none within 1.5 km of me"*
essentially every time, and the reason turned out to be two mistakes pointing
the same way.

The hider was always on the rim of the map. `chooseStation` rewarded distance
from the seeker without limit, so the outer terminus always won; and its second
term, meant to pick somewhere surrounded by stations that answer questions the
same way, counted stations *in the same district* within 12 km — which is not a
measure of camouflage, it is a measure of how big your district is, and Brno's
big districts are all on the edge. Camouflage is plain density now: how many
stations sit within 2 km, wherever they are. That points at the middle of the
city rather than away from it. Over 250 hiding places the median moved from 7.0
km out to 5.6 against a map median of 4.3, and the number of stations ever
chosen went from 131 to 173.

Distance is no longer scored against an invented ceiling either. It used to
saturate at 40 minutes — far enough to be a real journey, and past that it
stopped counting — which was a guess standing in for a rule. The hiding period
is that rule: the hider cannot be further away than the head start allowed, and
inside it, spending more of the window is simply better.

The radii were the bigger half. They had been tuned on expected survivors across
the whole map, which sounds right and is not, because the "none within" bucket
counts towards that score like any other — so the tuner happily bought its
score from a bucket that tells the seeker almost nothing. Measured against the
stations a hider actually picks rather than against the map, hospitals at 1.5 km
answered "none" **89%** of the time and cinemas at 2 km **86%**.

They are now set by one rule: **the answer must name a place more often than
not**, measured over the hider's real choices. That puts hospitals and cinemas
at 4 km and breweries at 2.5 — a long way past the rulebook's mile, but Brno has
nine hospitals in a city 17 km across, and there is no radius that both names
one and stays modest. Tentacles is now the strongest question in the game, at
about 55–60% of the remaining map removed per 5 minutes spent against 44% for
the river, which is what its 10 minutes and 4-draw/2-keep are buying.

## Lines, and the departure board

Both maps carry line membership, which supplies the rulebook's **Transit Line**
matching target — *"is your stop served by any of the same lines as mine?"* —
plus a measuring variant comparing how many lines each stop has, which
separates interchanges from the quiet ends of the network.

In Brno it also decides how you move. **A journey is one ride on one line.**
The board at your stop lists every line and direction that serves it, when the
next three leave, and every stop each one reaches, with the time on board and
the clock time you would arrive. You pick a stop and confirm. To get anywhere
else you get off at an interchange and board again — which is the whole reason
an interchange is worth anything.

The timetable is the smallest thing that can be read off a board: every line
runs on a fixed headway from its terminus, so a stop *N* minutes down the line
departs at *N*, *N* + headway, *N* + 2×headway, and so on from the start of
service. Trams every 5 minutes, buses and trolleybuses every 10. There is no
timetable file — the whole schedule is one number per mode in `RULES`, and the
board is derived from it.

The modes come from OSM's own route tagging rather than from the numbering, and
it is worth having checked: Brno has 11 tram lines, 14 trolleybus and 55 bus,
and line 21 is a trolleybus, which a guess at "25–39 are trolleybuses" gets
wrong. Route relations also supply the ordered stop list per direction, which
the map file now bakes as `lineStops` — the edge graph alone cannot give it,
because merging the two directions into undirected edges turns half the network
into branching soup.

What this replaced was a shortest path across the whole network with a flat
3-minute charge per change of line. That is not a journey, it is a teleport
with a fee: it never waited for anything.

Runs got longer, and it is worth being plain about how much. A Brno run against
a fair hider went from a median clock of **245 minutes to 320**, and from 9
questions to 18. Waiting for vehicles is most of that, and it is realism working
as intended. If a run runs long the dials are `headway`, `askMinutes`, and
whether a change of line has to be a separate move at all.

Everything that estimates a journey goes through the same search, so the number
the map shows and the price the board charges are the same arithmetic. Clicking
a distant station still works: the popup offers the **first leg** towards it and
says how many legs the whole thing is.

Two details worth knowing. Walking one stop is always offered, at two and a
half times the riding time — not as a convenience but because a handful of
terminal loops appear in no route relation at all, and without it they are
places the seeker can arrive at and never leave, or never reach, which would
let a hider sit somewhere unfindable. And a map with no `headway` in `RULES`
keeps the old free travel: the region's trains do not run every five minutes,
and pretending otherwise would be a lie dressed as precision.

## Two hiders

- **Fair** commits to a station before you start and answers honestly from it.
- **Devious** never commits. For each question it works out what the answer
  would be for every station still standing, and gives the answer that leaves
  the largest set alive. It never lies — every answer is true of some station
  consistent with everything said before — it is simply the luckiest possible
  hider, and it is forced to commit when one candidate remains, or when you ask
  for a photo. Expect to have to eliminate the entire map.

A person hiding in a two-player match is a fair hider by construction — they
chose a stop before the clock started and the app answers from it — so the
choice does not appear on the start screen when there are two of you.

## Two players, one device

The rulebook's match is a series of rounds in which everyone hides once, and
the hider who survives longest wins. That works on a single phone because the
two roles never need the screen at the same time.

1. A handover screen names who the device is for. It covers everything —
   whatever is on screen when a phone changes hands has been given away.
2. The hider gets the map to themselves, with every stop inside the head start
   lit up and brighter the deeper into the window it is. They tap one, see what
   the journey costs them, and hide there. *Surprise me* picks for them.
3. The device goes back. The map is reset first: the hider leaves it zoomed in
   on where they went, and Leaflet keeps a tooltip open on a tapped marker,
   either of which would hand over the answer for nothing.
4. The seeker plays exactly the round the solo game plays. From their side
   there is no difference — the hider is at one stop, and every answer is true
   of that stop.
5. Whoever is found is found somewhere, and **that is where the next round
   begins**, for both sides. A match is a walk across the map rather than two
   unrelated rounds, and a hider who runs a long way buys their opponent a
   start in unfamiliar country.

The result sheet after each round shows the standings — total minutes survived
as hider — with the caveat attached, because a comparison after an odd number
of rounds is not a comparison: one player has hidden once more than the other.
Rounds keep going as long as you want them to.

What the hider gives up by not holding the phone is **card play**: the app draws,
keeps, vetoes and casts curses on their behalf, using the same logic the solo
hider uses. The alternative is passing the device back for every single
question, which is not a game anyone would finish. Answering is not a
concession — the app knows where the hider went and answers truthfully from
there, exactly as an honest person would.

## On a phone

The game is a PWA, so Android installs it straight from the browser: open it in
Chrome, then **Add to Home screen**. It runs full-screen with no address bar,
and the layout stacks the map above the panel on a narrow screen.

Chrome only offers that for a page served over HTTPS, which `./run.sh` on
localhost is not, so the phone needs the files somewhere with a certificate.
Any static host will do and none of them need a build step -- there is nothing
to build. GitHub Pages from the repo root is the least ceremony:

```
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
# then: Settings -> Pages -> Deploy from a branch -> main / (root)
```

This one lives at **https://273143.github.io/jetlag/**, deployed that way from
`main`; a push is a release. Note that Pages on a free account needs the repo
to be *public* — a private one silently offers you nothing but the paid option.

Every path in the app is relative -- the manifest's `start_url` and `scope`,
the service worker registration, the vendored Leaflet -- so it works unchanged
under a project subpath like `https://<you>.github.io/<repo>/`, which is what
Pages gives a project repo. That is checked rather than assumed: a run, a
two-player match and the offline nag have all been driven against the site
served one directory down, and the manifest, service worker and icons all
resolve from there.

Two things exist only for playing away from a desk. `js/wakelock.js` holds a
screen wake lock for the length of a round, because a round is twenty minutes
of looking at a map without touching it and, in a match, a phone that locks
itself mid-handover hands the next player whatever the last one was reading.
And the start screen now puts a sheet in front of the Start button when the map
has never been saved offline -- once per session, and never when you are
already offline and there is nothing to be done about it.

Offline is the point, since the natural place to play this is a train or a pub.
A service worker precaches the app and both map files, about 700 KB, so the
whole deduction game works with no signal after one visit. Map tiles are the
bulk and are downloaded on request from the start screen, at two sizes:

| | South Moravia | Brno |
| --- | --- | --- |
| Map — everything needed to play | 21 MB | 8 MB |
| Map + photos — adds the aerial imagery | 101 MB | 76 MB |

Whatever you have simply looked at is cached too, so a run you have played
stays available regardless.

The trick that makes the photo pack merely large rather than impossible: a
photo is always centred on a *stop*, and there are only 180 or 542 of those, so
close-up imagery is fetched three-by-three around each stop instead of across
the whole map. Packing South Moravia at zoom 17 wholesale would be nineteen
thousand tiles per zoom level and rising.

Leaflet is vendored into `vendor/` rather than loaded from a CDN, for the same
reason.

This was the last part of the game to go untested, and it is no longer: the
app was installed from the address above on an Android phone on 2026-09-02 and
a map pack downloaded and stored. Before that it had shipped on arithmetic
alone, because Cache Storage in headless Chromium is unreliable rather than
absent — `caches.open()` stalls on a cold profile and answers on a warm one.
That is worth remembering before trusting a green test here: `tools/nagtest.html`
does read storage for real, and detects and skips where it cannot, but no
harness in this repo has ever fetched a whole pack. The download wants a phone.

Everything that touches Cache Storage is wrapped in a timeout, so a browser
that blocks it degrades to a clear message rather than a spinner that never
stops — and the offline nag treats unreadable storage as "say nothing", never
as "not saved".

## Layout

```
ARCHITECTURE.md       map of the code: every file, the state shapes, the
                      invariants, and where to change what
CLAUDE.md             the short version, for coding agents
index.html            shell
js/rules.js           every tunable number, and why it has that value
js/timetable.js       departures, the board, and time-dependent journeys
js/questions.js       the question catalogue
js/data.js            map loading and line-aware routing
js/hider.js           hiding, answering, the deck, the curse and powerup AI
js/game.js            state machine: asking, travelling, curses, scoring
js/curses.js          curse effects and the minigames
js/match.js           pass-and-play bookkeeping: whose turn, where next, scores
js/hidephase.js       the handover screen and the hiding period
js/map.js  js/ui.js   Leaflet map and the panel
js/offline.js         offline tile packs
js/wakelock.js        keeps the screen on for the length of a round
sw.js                 service worker: precache, tile cache
vendor/               Leaflet, vendored so offline really means offline
data/*.json           the baked maps
tools/build_map.py    rebuilds them from OpenStreetMap
tools/osmlib.py       shared OSM fetching and geometry
tools/tune_tentacles.py   measures how strong each Tentacles radius is
tools/survey_pois.py      scores candidate POI categories as questions
tools/test.sh         engine self-test, across every map
tools/uitest.sh       drives the real interface: a whole run, a whole
                      two-player match on each map, and the offline nag
```

The trick that keeps the game honest is in `js/questions.js`: each question is
a single function `ask(station, ctx)`. The engine calls it on the hider to get
the answer, and on every candidate to filter the set. Both sides run identical
code, so an answer can never eliminate the hider — which is exactly how a
deduction game like this usually goes quietly wrong.

## Rebuilding the maps

```
python3 tools/build_map.py all     # or: south-moravia | brno
```

Every Overpass response is cached under `.cache/`, so a second run is quick.

The two maps need different treatment, because OSM maps the two networks very
differently:

**Rail.** Route relations here list barely any stops — a median of two per
line — so the graph is derived geometrically instead: snap every station onto
the raw track network, grow a multi-source Dijkstra from all of them at once,
and where two stations' territories meet, they are consecutive stops. Line
membership is then recovered separately, by matching stations against each
route's *track* geometry, which the relations do carry in full. Only
`route=train` counts: `route=railway` is infrastructure, and would offer you
corridor names like "I. TŽK" as though they were something you could ride.

**Urban transit.** Here the route relations are excellent, so the graph and the
line membership both come straight out of their ordered stop lists. The work is
in the stops themselves: a city stop is several OSM nodes — a pair either side
of the street, a stop_position on the rails, a platform beside them — so nodes
sharing a name within 350 m are merged. That turns 2,753 stop objects into 542
places someone could actually be hiding.

Three repairs matter, and all were found by checking output against real
timetables rather than by reading the code. Do not remove them:

- The query must **not** filter on `service`. In large junction stations the
  through-running tracks carry service tags, and excluding them severed the
  corridor: Brno–Břeclav came out at 159 minutes instead of 35.
- Short gaps in the rail data are bridged, but only between *dangling ends* of
  different connected components and only under 600 m. Boskovice and Zboněk sit
  2 km apart on the ground and were 233 km apart in the raw graph.
- Each link keeps its own track speed limit. Costing everything at one flat
  line speed put Brno–Břeclav at 67 minutes against a real 35, because 160 km/h
  main line was being charged as if it were 70.

Travel times land within a few minutes of the real timetable on both maps —
mean absolute error 4.8 minutes across the region (Blansko 24 vs 25, Znojmo 98
vs 100, Kyjov 60 vs 60) and 1.9 minutes across Brno. Boskovice is the notable
outlier at 44 against a real 70: a branch line whose true cost is infrequent
service, which nothing in this model represents.

To add another map, add an entry to `MAPS` in `build_map.py` and to `MAPS` in
`js/data.js`, then give it question distances in `js/rules.js` — use
`tools/tune_tentacles.py` to pick the Tentacles radii rather than guessing.
Nothing else is map-specific.

## Tests

```
./tools/test.sh      # 60 automated runs across both maps, invariants, coverage
./tools/uitest.sh    # clicks through the real UI end to end, on each map
```

The engine test asserts the things that would ruin the game silently: the hider
is never eliminated by their own answer, the candidate set never empties, the
seeker's view and the hider's view never disagree, every candidate is inside the
head start the seeker was told about, and every run terminates. It also reports
which curses and powerups actually fired, so a feature that has quietly become
unreachable shows up as a missing line rather than as code that looks
implemented — and how many distinct stops thirty rounds started at, because "the
start is random" is the kind of claim that fails silently by being the hub every
time.

`uitest.sh` also drives a whole two-player match per map, through the real
handover and hiding screens. What it is really checking is that the seeker is
handed nothing they should not have: not the hiding place in the handover text,
and not a tooltip left open on the map.

Both harnesses give Chromium a throwaway profile per run. That is not
fastidiousness: with a shared profile the module cache served stale JavaScript,
and a run once passed against a function that did not exist.

## Known limits

- Travel times are derived from distance and speed limits. Brno now layers a
  real headway on top, so waits and departure times are honest, but the time
  *on board* is still modelled rather than timetabled. The region map has no
  timetable at all, so a branch line served twice a day still looks as
  convenient as a tram every four minutes.
- Tentacles radii were widened a long way past the rulebook's mile (hospitals
  and cinemas to 4 km, breweries to 2.5) to stop "there are none within" being
  the answer. Brno has nine hospitals in a city 17 km across; there is no
  radius that both names one and stays modest.
- The Brno headway is flat all day. A run that goes long does not meet an
  evening service winding down.
- Brno is larger than the rulebook's Small game, which wants 30–100 stops. 542
  is the real network. The half-hour head start brings the opening position
  down to a median of about 220 stops, which is a far better-shaped run, but it
  is still not a Small game.
- In a two-player match the hider chooses where to hide and nothing else. The
  app plays their cards for them, so the bluffing half of the hider's game —
  when to burn a veto, when to cast a curse — is not something a person gets to
  do without handing the phone back at every question.
- The offline tile download is unverified on real hardware (see above).
- Three of Brno's four Tentacles radii are small enough that "none within" is
  the largest answer bucket, so most of their measured strength is
  really "are you near one at all?". That is the deliberate consequence of
  tuning them to land just under 50%, but it means the game's most expensive
  question often names nothing. Widening the radii would fix the legibility and
  make tentacles much stronger than everything else; it wants a repricing
  rather than just a new number.
- The question catalogue has been trimmed on Brno but not on South Moravia,
  which still offers 49.
- The Duplicate powerup only does its scoring job (copying your best time
  bonus); it cannot stand in for an arbitrary card.
- The Mediocre Travel Agent is now a gamble rather than a tax: the booking must
  be within three stops of the hider (`travelAgentHops`), so it still burns the
  seekers’ clock but the destination is evidence, and everything more than
  three stops from it is ruled out. A fair hider takes the furthest ring it can
  and the longest journey in it; a devious one weighs candidates kept against
  minutes burned, because scoring on candidates alone books the busiest
  interchange one minute away and curses nobody. The hider will not cast it
  below 60 candidates, where handing over a three-stop radius is suicide.
- Single round, seeker side only. The show alternates and compares times.

Map data © OpenStreetMap contributors. Elevation SRTM via OpenTopoData.
Aerial imagery © Esri. *Jet Lag: The Game* is by Wendover Productions; this is
an unaffiliated fan implementation of the published rules.
