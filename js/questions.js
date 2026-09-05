// The question catalogue.
//
// Every question exposes one function, ask(station, ctx, world), returning a
// comparable value. The engine uses it twice: once on the hider to produce the
// answer, and once on each surviving station to filter the candidate set. Both
// sides therefore run identical code, so an answer can never eliminate the
// station the hider is actually standing on -- the classic way a deduction
// game like this goes subtly wrong.

import { RULES } from "./rules.js";
import { haversine, formatKm } from "./geo.js";
import { t } from "./i18n.js";

const yesNo = (yes, no) => (v) => (v ? yes : no);

export function buildQuestions(world) {
  const Q = [];
  const near = (cat) => world.nearest[cat];
  const P = RULES.maps[world.id] ?? RULES.maps["south-moravia"];
  const varies = (fn) => new Set(world.stations.map(fn)).size > 1;
  // The questions that are not generated from a POI list are declared per map
  // by id, in RULES.maps[...].extras, so a map can carry only the ones that
  // work on it. A map that omits `extras` gets all of them.
  const on = (id) => !P.extras || P.extras.includes(id);
  // A target is usable when the map actually has two or more of them to tell
  // apart. Checked against `nearest` rather than `pois` so that rivers, which
  // are baked rather than derived from a point list, are covered too.
  const usable = (cat) =>
    world.nearest[cat] && new Set(world.nearest[cat].name.filter(Boolean)).size > 1;

  // Every possible answer to a question, for the panel to list before the
  // seeker pays. Playtest note: "lists of available museum, etc so all options
  // for each question". Being told your nearest hospital is the Vojenska
  // nemocnice is only information if you know what the other eight are.
  // Rivers are baked as a name list rather than a point list, so they come
  // from `world.rivers`; everything else is a POI category.
  // Place names are Czech whichever language the interface is in, so they are
  // always collated as Czech -- an English sort puts Zidenice before Reckovice.
  const cs = (a, b) => a.localeCompare(b, "cs");
  const namesFor = (cat) =>
    cat === "river"
      ? (world.rivers ?? []).slice().sort(cs)
      : (world.pois?.[cat] ?? []).map((p) => p.name).sort(cs);

  // ---- Radar ----------------------------------------------------------
  for (const km of P.radarKm) {
    Q.push({
      id: `radar_${km}`, cat: "radar", short: `${km} km`,
      text: t("q.radar.text", { km }),
      ask: (s, ctx) => haversine(s, ctx.seeker) <= km,
      format: yesNo(t("q.radar.yes", { km }), t("q.radar.no", { km })),
    });
  }

  // ---- Thermometer ----------------------------------------------------
  // Needs the seeker to actually move: the constraint is the perpendicular
  // bisector of the leg travelled, which is meaningless without a leg.
  for (const km of P.thermometerKm) {
    Q.push({
      id: `thermo_${km}`, cat: "thermometer", short: `${km} km`, travelKm: km,
      text: t("q.thermo.text", { km }),
      ask: (s, ctx) => haversine(s, ctx.to) < haversine(s, ctx.from),
      format: yesNo(t("q.thermo.hot"), t("q.thermo.cold")),
    });
  }

  // ---- Matching -------------------------------------------------------
  // A POI category carries three things the questions need: what it is called
  // in the singular, in the plural, and its grammatical gender. Czech makes
  // "the same as mine" agree with the noun, so the gender is not decoration --
  // without it these read as three separate broken sentences.
  const label = (cat) => t(`poi.${cat}.one`);
  const labels = (cat) => t(`poi.${cat}.many`);
  const gender = (cat) => t(`poi.${cat}.g`);

  for (const cat of P.matching) {
    if (!usable(cat)) continue;
    const g = gender(cat);
    Q.push({
      id: `match_${cat}`, cat: "matching", short: label(cat),
      text: t("q.matchPoi.text", { label: label(cat), g }),
      ask: (s, ctx) => near(cat).name[s.id] === near(cat).name[ctx.seeker.id],
      context: (ctx) => t("q.matchPoi.ctx", { name: near(cat).name[ctx.seeker.id] ?? t("q.none") }),
      list: () => namesFor(cat),
      mine: (ctx) => near(cat).name[ctx.seeker.id],
      format: yesNo(t("q.matchPoi.yes", { g }), t("q.matchPoi.no", { g })),
    });
  }
  if (on("match_district") && varies((s) => s.district)) Q.push({
    id: "match_district", cat: "matching", short: t("q.district.short"),
    text: t("q.district.text"),
    ask: (s, ctx) => s.district === ctx.seeker.district,
    context: (ctx) => t("q.district.ctx", { name: ctx.seeker.district }),
    list: () => [...new Set(world.stations.map((s) => s.district).filter(Boolean))].sort(cs),
    mine: (ctx) => ctx.seeker.district,
    format: yesNo(t("q.district.yes"), t("q.district.no")),
  });
  if (on("match_municipality") && varies((s) => s.municipality)) Q.push({
    id: "match_municipality", cat: "matching", short: t("q.municipality.short"),
    text: t("q.municipality.text"),
    ask: (s, ctx) => s.municipality === ctx.seeker.municipality,
    context: (ctx) => t("q.municipality.ctx", { name: ctx.seeker.municipality }),
    format: yesNo(t("q.municipality.yes"), t("q.municipality.no")),
  });

  // Transit line, the rulebook's Matching target. On a city map with 140
  // lines this is the sharpest question in the game; on the rail map most
  // stations sit on exactly one line, so it is close to naming the corridor.
  if (world.lines?.length && on("match_line")) {
    Q.push({
      id: "match_line", cat: "matching", short: t("q.line.short"),
      text: t("q.line.text"),
      ask: (s, ctx) => s.lines.some((l) => ctx.seeker.lines.includes(l)),
      context: (ctx) => {
        const mine = world.lineNames(ctx.seeker.lines).join(", ");
        return mine ? t("q.line.ctx", { lines: mine }) : t("q.line.ctxNone");
      },
      list: () => world.lines.slice(),
      format: yesNo(t("q.line.yes"), t("q.line.no")),
    });
    if (on("measure_lines") && varies((s) => s.lines.length)) Q.push({
      id: "measure_lines", cat: "measuring", short: t("q.lines.short"),
      text: t("q.lines.text"),
      ask: (s, ctx) => s.lines.length > ctx.seeker.lines.length,
      context: (ctx) => t("q.lines.ctx", { n: ctx.seeker.lines.length }),
      format: yesNo(t("q.lines.more"), t("q.lines.fewer")),
    });
  }
  // Means of transport. Brno's stops carry `kind`, set at build time from
  // whether the merged stop includes a railway=tram_stop node -- 147 tram
  // stops against 395 that are bus and trolleybus only. That makes it the
  // second strongest matching question on the map (61% survivors, against
  // 51% for the river and 76% for the transit line) and the most legible one
  // in the game: you can see which stops the trams reach without asking
  // anything. The rail map has the same field with different values (station
  // against halt), so the wording comes from the map rather than from here.
  if (on("match_mode") && P.kindQuestion && varies((s) => s.kind === P.kindQuestion.value)) {
    // One question, different words on each map -- Brno splits trams from
    // everything else, the region would split stations from halts -- so the
    // wording is keyed by map id in the dictionary rather than written here.
    const isKind = (s) => s.kind === P.kindQuestion.value;
    const K = (part) => t(`kind.${world.id}.${part}`);
    Q.push({
      id: "match_mode", cat: "matching", short: K("short"),
      text: K("text"),
      ask: (s, ctx) => isKind(s) === isKind(ctx.seeker),
      context: (ctx) => (isKind(ctx.seeker) ? K("yours") : K("notYours")),
      list: () => [K("opt0"), K("opt1")],
      mine: (ctx) => K(isKind(ctx.seeker) ? "opt0" : "opt1"),
      format: yesNo(t("q.matchPoi.yes", { g: "m" }), t("q.matchPoi.no", { g: "m" })),
    });
  }
  if (on("match_letter")) Q.push({
    id: "match_letter", cat: "matching", short: t("q.letter.short"),
    text: t("q.letter.text"),
    ask: (s, ctx) => s.name[0].toLocaleUpperCase("cs") === ctx.seeker.name[0].toLocaleUpperCase("cs"),
    context: (ctx) => t("q.letter.ctx", { letter: ctx.seeker.name[0].toLocaleUpperCase("cs") }),
    format: yesNo(t("q.letter.yes"), t("q.letter.no")),
  });
  if (on("match_length")) Q.push({
    id: "match_length", cat: "matching", short: t("q.length.short"),
    text: t("q.length.text"),
    ask: (s, ctx) => world.letters[s.id] === world.letters[ctx.seeker.id],
    context: (ctx) => t("q.length.ctx", { n: world.letters[ctx.seeker.id] }),
    format: yesNo(t("q.length.yes"), t("q.length.no")),
  });

  // ---- Measuring ------------------------------------------------------
  // A separate list from `matching`: asking about a feature one way does not
  // oblige you to offer the other. In Brno all eight "is your nearest X
  // closer than mine?" questions scored within 2.1 points of each other and
  // none survived the cut.
  for (const cat of P.measuring) {
    if (!usable(cat)) continue;
    Q.push({
      id: `measure_${cat}`, cat: "measuring", short: label(cat),
      text: t("q.measurePoi.text", { label: label(cat), g: gender(cat) }),
      ask: (s, ctx) => near(cat).km[s.id] < near(cat).km[ctx.seeker.id],
      context: (ctx) => t("q.measurePoi.ctx", {
        name: near(cat).name[ctx.seeker.id] ?? t("q.none"),
        km: formatKm(near(cat).km[ctx.seeker.id]),
      }),
      list: () => namesFor(cat),
      mine: (ctx) => near(cat).name[ctx.seeker.id],
      format: yesNo(t("q.measurePoi.closer"), t("q.measurePoi.further")),
    });
  }
  if (on("measure_ele") && varies((s) => s.ele)) Q.push({
    id: "measure_ele", cat: "measuring", short: t("q.ele.short"),
    text: t("q.ele.text"),
    ask: (s, ctx) => s.ele > ctx.seeker.ele,
    context: (ctx) => t("q.ele.ctx", { n: Math.round(ctx.seeker.ele) }),
    format: yesNo(t("q.ele.higher"), t("q.ele.lower")),
  });
  if (on("measure_pop") && varies((s) => s.population)) Q.push({
    id: "measure_pop", cat: "measuring", short: t("q.pop.short"),
    text: t("q.pop.text"),
    ask: (s, ctx) => s.population > ctx.seeker.population,
    context: (ctx) => t("q.pop.ctx", { n: ctx.seeker.population.toLocaleString("cs") }),
    format: yesNo(t("q.pop.larger"), t("q.pop.smaller")),
  });
  if (on("measure_hub")) Q.push({
    id: "measure_hub", cat: "measuring", short: world.hub.name,
    text: t("q.hub.text", { name: world.hub.name }),
    ask: (s, ctx) => haversine(s, world.hub) < haversine(ctx.seeker, world.hub),
    context: (ctx) => t("q.hub.ctx", { km: formatKm(haversine(ctx.seeker, world.hub)) }),
    format: yesNo(t("q.hub.closer"), t("q.hub.further")),
  });

  // ---- Tentacles ------------------------------------------------------
  // The strongest question in the game: the answer names a specific place,
  // which pins the hider to that POI's Voronoi cell intersected with the disc.
  for (const { cat, km } of P.tentacles) {
    if (!usable(cat)) continue;
    const g = gender(cat);
    Q.push({
      id: `tent_${cat}_${km}`, cat: "tentacles",
      short: t("q.tent.short", { labels: labels(cat), km }),
      text: t("q.tent.text", { labels: labels(cat), km, g }),
      ask: (s) => (near(cat).km[s.id] <= km ? near(cat).name[s.id] : null),
      // The answer names a place, so the list of places is the question. Also
      // shown: the seeker's own nearest, which is what tells them whether an
      // answer of "none within" puts the hider near them or far from them.
      context: (ctx) =>
        near(cat).km[ctx.seeker.id] <= km
          ? t("q.tent.ctx", { name: near(cat).name[ctx.seeker.id] })
          : t("q.tent.ctxNone", { km, g }),
      list: () => namesFor(cat),
      mine: (ctx) => (near(cat).km[ctx.seeker.id] <= km ? near(cat).name[ctx.seeker.id] : null),
      format: (v) => (v ? t("q.tent.nearest", { name: v }) : t("q.tent.none", { km, g })),
    });
  }

  // ---- Photo (ADAPTED) ------------------------------------------------
  // A screen cannot ask for a real photograph, so the hider sends an
  // unlabelled map crop centred on themselves instead: visual evidence the
  // seeker must interpret by eye. Deliberately not machine-filterable -- like
  // a real photo, reading it is the player's job.
  //
  // A map may keep only some of the zoom levels, via `photoZooms`: on Brno
  // zoom 11 covers the whole city and its outskirts, so that photo cost ten
  // minutes for a picture that could have been taken anywhere.
  const photos = [
    { id: "photo_street", key: "street", zoom: 17 },
    { id: "photo_around", key: "around", zoom: 15 },
    { id: "photo_wide",   key: "wide",   zoom: 13 },
    { id: "photo_sky",    key: "sky",    zoom: 11 },
  ].filter((p) => !P.photoZooms || P.photoZooms.includes(p.zoom));
  for (const p of photos) {
    Q.push({
      id: p.id, zoom: p.zoom, cat: "photo", visual: true,
      short: t(`q.photo.${p.key}.short`),
      text: t(`q.photo.${p.key}.text`),
      ask: (s) => ({ lat: s.lat, lon: s.lon, zoom: p.zoom }),
      format: () => t("q.photo.sent"),
    });
  }

  return Q;
}

// Ids only, in the order the tabs appear. The name and the one-line
// description are looked up when the tab is painted rather than baked in
// here: this array is evaluated when the module is imported, which is before
// the start screen has had a chance to say which language to use.
export const CATEGORIES = ["matching", "measuring", "radar", "thermometer",
                           "tentacles", "photo"];

export const categoryName = (id) => t(`cat.${id}.name`);
export const categoryBlurb = (id) => t(`cat.${id}.blurb`);

/** Answer `q` from the hider's station, and return the surviving candidates. */
export function applyQuestion(q, hider, ctx, world, candidates) {
  const answer = q.ask(hider, ctx, world);
  return { answer, survivors: filterByAnswer(q, ctx, world, candidates, answer) };
}

/** Keep only the stations that would have produced this exact answer. */
export function filterByAnswer(q, ctx, world, candidates, answer) {
  if (q.visual) return candidates;   // a photo is for human eyes, not a filter
  return candidates.filter((s) => sameAnswer(q.ask(s, ctx, world), answer));
}

export function sameAnswer(a, b) {
  return a === b || (a == null && b == null);
}
