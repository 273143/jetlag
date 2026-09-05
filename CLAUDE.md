# CLAUDE.md

A browser implementation of *Jet Lag: The Game*'s Hide + Seek, played over real
Czech transit networks (regional trains, and Brno's trams/trolleybuses/buses).
Vanilla ES modules, no build step, no dependencies, Leaflet vendored.

**Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing code** — it maps every
file, the state shapes, the invariants, and a "where do I change X?" table.
[README.md](README.md) is the design rationale: why each number is what it is.

## Commands

```bash
./run.sh                          # serve on http://localhost:8080/
./tools/test.sh                   # dictionary check, then engine: 60 runs, invariants (~1 min)
./tools/uitest.sh                 # UI: a full run per map, cards off, English, 2-player matches
node tools/i18ncheck.js           # just the dictionary, both ways (instant)
./tools/shot.sh 'index.html?map=brno&seed=7&go=1' out.png   # headless screenshot
python3 tools/build_map.py all    # rebuild data/*.json from OpenStreetMap
```

The browser tools use whichever Chromium is installed; set `CHROME=/path/to/it`
if they cannot find one.

Run **both** test scripts before calling a change done. They are the contract:
this game can fail silently — a wrong candidate set still looks like a game.

Useful URLs: `?fresh=1` (clear a stale service worker), `?go=1` (skip the start
screen), `?players=2`, `?hiding=30`, `?seed=`, `?map=`, `?hider=devious`,
`?lang=cs|en`, `?cards=0` (the deck-free game).

## The one idea

The engine is a single object: **the candidate set**, every stop still
consistent with everything the hider has said. It drives the map, win detection
and the hider's own reasoning. Every question is one function
`ask(station, ctx, world)`, run on the hider to get the answer *and* on every
candidate to filter — identical code on both sides, which is what makes it
impossible for an answer to eliminate the hider.

## Hard rules

1. Answering and filtering use the same `ask`. Never write a second filter.
2. The candidate set always contains the hider and never empties mid-run.
3. The seeker may only be shown what follows from what they were told.
4. Engine randomness goes through `mulberry32(seed)` — no `Math.random` in
   `game.js`, `hider.js`, `deck.js`, `curses.js`. A seed reproduces a round.
5. Only `game.js` charges the clock. `ui.js` holds no rules; it asks
   `askBlocker` / `travelBlocker` whether something is allowed.
6. In a two-player match nothing on screen at a handover may reveal the hiding
   place — text, zoom, popup or Leaflet tooltip.
7. Every tunable number lives in `js/rules.js`, with the measurement that
   produced it in a comment above it.
8. Every user-facing string lives in `js/i18n.js`, in **both** Czech and
   English. Never a literal in a `.js` file or in `index.html`; values
   interpolated into a template must already be through `esc()`.
   `node tools/i18ncheck.js` fails on a gap in either direction.
9. A journey's `wait` and `onboard` add up to what it charges, and everything
   that quotes one reads `state.travel`, which is tied to the clock.
10. A new `js/*.js` file must be added to `SHELL_FILES` in `sw.js`, and `SHELL`
    bumped.

## Style

- Comments explain **why**, not what: what was tried, what it measured, what
  went wrong with the obvious alternative. Match the surrounding density —
  it is high, and deliberately so.
- Changing a balance number without measuring it is the main way to break this
  game. `tools/survey_pois.py` and `tools/tune_tentacles.py` exist for that.
- No dependencies, no framework, no build step. Keep it that way.
- ASCII in source comments (`--`, not an em dash); UTF-8 in user-facing strings.
- Escape interpolated HTML with `esc()` from `js/ui.js`.
- Czech is the default language and English is the second one. Both are always
  written together; a key added to one dictionary and not the other fails the
  test run rather than shipping as the wrong language.
