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
  const cs = (a, b) => a.localeCompare(b, "cs");
  const namesFor = (cat) =>
    cat === "river"
      ? (world.rivers ?? []).slice().sort(cs)
      : (world.pois?.[cat] ?? []).map((p) => p.name).sort(cs);

  // ---- Radar ----------------------------------------------------------
  for (const km of P.radarKm) {
    Q.push({
      id: `radar_${km}`, cat: "radar", short: `${km} km`,
      text: `Are you within ${km} km of me?`,
      ask: (s, ctx) => haversine(s, ctx.seeker) <= km,
      format: yesNo(`Yes — I am within ${km} km of you.`, `No — I am more than ${km} km away.`),
    });
  }

  // ---- Thermometer ----------------------------------------------------
  // Needs the seeker to actually move: the constraint is the perpendicular
  // bisector of the leg travelled, which is meaningless without a leg.
  for (const km of P.thermometerKm) {
    Q.push({
      id: `thermo_${km}`, cat: "thermometer", short: `${km} km`, travelKm: km,
      text: `I will travel at least ${km} km. Am I hotter or colder afterwards?`,
      ask: (s, ctx) => haversine(s, ctx.to) < haversine(s, ctx.from),
      format: yesNo("Hotter — you moved closer to me.", "Colder — you moved away from me."),
    });
  }

  // ---- Matching -------------------------------------------------------
  for (const t of P.matching) {
    if (!usable(t.cat)) continue;
    Q.push({
      id: `match_${t.cat}`, cat: "matching", short: t.label,
      text: `Is your nearest ${t.label} the same as mine?`,
      ask: (s, ctx) => near(t.cat).name[s.id] === near(t.cat).name[ctx.seeker.id],
      context: (ctx) => `yours is ${near(t.cat).name[ctx.seeker.id] ?? "— none —"}`,
      list: () => namesFor(t.cat),
      mine: (ctx) => near(t.cat).name[ctx.seeker.id],
      format: yesNo("Yes — the same one.", "No — a different one."),
    });
  }
  if (on("match_district") && varies((s) => s.district)) Q.push({
    id: "match_district", cat: "matching", short: "district",
    text: "Are you in the same district as me?",
    ask: (s, ctx) => s.district === ctx.seeker.district,
    context: (ctx) => `you are in ${ctx.seeker.district}`,
    list: () => [...new Set(world.stations.map((s) => s.district).filter(Boolean))].sort(cs),
    mine: (ctx) => ctx.seeker.district,
    format: yesNo("Yes — the same district.", "No — a different district."),
  });
  if (on("match_municipality") && varies((s) => s.municipality)) Q.push({
    id: "match_municipality", cat: "matching", short: "locality",
    text: "Are you in the same locality as me?",
    ask: (s, ctx) => s.municipality === ctx.seeker.municipality,
    context: (ctx) => `you are in ${ctx.seeker.municipality}`,
    format: yesNo("Yes — the same one.", "No — a different one."),
  });

  // Transit line, the rulebook's Matching target. On a city map with 140
  // lines this is the sharpest question in the game; on the rail map most
  // stations sit on exactly one line, so it is close to naming the corridor.
  if (world.lines?.length && on("match_line")) {
    Q.push({
      id: "match_line", cat: "matching", short: "transit line",
      text: "Is your stop served by any of the same lines as mine?",
      ask: (s, ctx) => s.lines.some((l) => ctx.seeker.lines.includes(l)),
      context: (ctx) => `you are on ${world.lineNames(ctx.seeker.lines).join(", ") || "no known line"}`,
      list: () => world.lines.slice(),
      format: yesNo("Yes — we share a line.", "No — no line runs through both."),
    });
    if (on("measure_lines") && varies((s) => s.lines.length)) Q.push({
      id: "measure_lines", cat: "measuring", short: "lines served",
      text: "Is your stop served by more lines than mine?",
      ask: (s, ctx) => s.lines.length > ctx.seeker.lines.length,
      context: (ctx) => `yours has ${ctx.seeker.lines.length}`,
      format: yesNo("More — mine is the busier interchange.", "Fewer or equal — mine is no busier than yours."),
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
    const K = P.kindQuestion;
    const isKind = (s) => s.kind === K.value;
    Q.push({
      id: "match_mode", cat: "matching", short: K.short,
      text: K.text,
      ask: (s, ctx) => isKind(s) === isKind(ctx.seeker),
      context: (ctx) => (isKind(ctx.seeker) ? K.yours : K.notYours),
      list: () => K.options ?? [],
      mine: (ctx) => (K.options ?? [])[isKind(ctx.seeker) ? 0 : 1],
      format: yesNo("Yes — the same as you.", "No — the other one."),
    });
  }
  if (on("match_letter")) Q.push({
    id: "match_letter", cat: "matching", short: "first letter",
    text: "Does your station's name start with the same letter as mine?",
    ask: (s, ctx) => s.name[0].toLocaleUpperCase("cs") === ctx.seeker.name[0].toLocaleUpperCase("cs"),
    context: (ctx) => `yours starts with ${ctx.seeker.name[0].toLocaleUpperCase("cs")}`,
    format: yesNo("Yes — the same letter.", "No — a different letter."),
  });
  if (on("match_length")) Q.push({
    id: "match_length", cat: "matching", short: "name length",
    text: "Does your station's name have the same number of letters as mine?",
    ask: (s, ctx) => world.letters[s.id] === world.letters[ctx.seeker.id],
    context: (ctx) => `yours has ${world.letters[ctx.seeker.id]} letters`,
    format: yesNo("Yes — the same number of letters.", "No — a different number."),
  });

  // ---- Measuring ------------------------------------------------------
  // A separate list from `matching`: asking about a feature one way does not
  // oblige you to offer the other. In Brno all eight "is your nearest X
  // closer than mine?" questions scored within 2.1 points of each other and
  // none survived the cut.
  for (const t of P.measuring) {
    if (!usable(t.cat)) continue;
    Q.push({
      id: `measure_${t.cat}`, cat: "measuring", short: t.label,
      text: `Is your nearest ${t.label} closer to you than mine is to me?`,
      ask: (s, ctx) => near(t.cat).km[s.id] < near(t.cat).km[ctx.seeker.id],
      context: (ctx) => `yours is ${near(t.cat).name[ctx.seeker.id] ?? "— none —"}, ${formatKm(near(t.cat).km[ctx.seeker.id])} away`,
      list: () => namesFor(t.cat),
      mine: (ctx) => near(t.cat).name[ctx.seeker.id],
      format: yesNo("Closer — mine is nearer than yours.", "Further — mine is further than yours."),
    });
  }
  if (on("measure_ele") && varies((s) => s.ele)) Q.push({
    id: "measure_ele", cat: "measuring", short: "elevation",
    text: "Are you at a higher elevation than me?",
    ask: (s, ctx) => s.ele > ctx.seeker.ele,
    context: (ctx) => `you are at ${Math.round(ctx.seeker.ele)} m`,
    format: yesNo("Higher — I am above you.", "Lower — I am at or below your elevation."),
  });
  if (on("measure_pop") && varies((s) => s.population)) Q.push({
    id: "measure_pop", cat: "measuring", short: "population",
    text: "Is your municipality larger than mine by population?",
    ask: (s, ctx) => s.population > ctx.seeker.population,
    context: (ctx) => `yours has ${ctx.seeker.population.toLocaleString("cs")} people`,
    format: yesNo("Larger — mine has more people.", "Smaller — mine has no more people than yours."),
  });
  if (on("measure_hub")) Q.push({
    id: "measure_hub", cat: "measuring", short: world.hub.name,
    text: `Are you closer to ${world.hub.name} than I am?`,
    ask: (s, ctx) => haversine(s, world.hub) < haversine(ctx.seeker, world.hub),
    context: (ctx) => `you are ${formatKm(haversine(ctx.seeker, world.hub))} from it`,
    format: yesNo("Closer — I am nearer to it than you.", "Further — I am further from it than you."),
  });

  // ---- Tentacles ------------------------------------------------------
  // The strongest question in the game: the answer names a specific place,
  // which pins the hider to that POI's Voronoi cell intersected with the disc.
  for (const t of P.tentacles) {
    if (!usable(t.cat)) continue;
    Q.push({
      id: `tent_${t.cat}_${t.km}`, cat: "tentacles", short: `${t.label} · ${t.km} km`,
      text: `Of all the ${t.label} within ${t.km} km of you, which are you nearest to?`,
      ask: (s) => (near(t.cat).km[s.id] <= t.km ? near(t.cat).name[s.id] : null),
      // The answer names a place, so the list of places is the question. Also
      // shown: the seeker's own nearest, which is what tells them whether an
      // answer of "none within" puts the hider near them or far from them.
      context: (ctx) =>
        near(t.cat).km[ctx.seeker.id] <= t.km
          ? `yours is ${near(t.cat).name[ctx.seeker.id]}`
          : `you have none within ${t.km} km`,
      list: () => namesFor(t.cat),
      mine: (ctx) => (near(t.cat).km[ctx.seeker.id] <= t.km ? near(t.cat).name[ctx.seeker.id] : null),
      format: (v) => (v ? `The nearest is ${v}.` : `There are none within ${t.km} km of me.`),
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
    { id: "photo_street", zoom: 17, short: "the street outside", text: "Send me a photo of the street outside your station." },
    { id: "photo_around", zoom: 15, short: "your surroundings", text: "Send me a photo of your surroundings." },
    { id: "photo_wide",   zoom: 13, short: "the view from here", text: "Send me a photo of the view from where you are." },
    { id: "photo_sky",    zoom: 11, short: "the horizon", text: "Send me a photo of the horizon in every direction." },
  ].filter((p) => !P.photoZooms || P.photoZooms.includes(p.zoom));
  for (const p of photos) {
    Q.push({
      ...p, cat: "photo", visual: true,
      ask: (s) => ({ lat: s.lat, lon: s.lon, zoom: p.zoom }),
      format: () => "Photo sent.",
    });
  }

  return Q;
}

export const CATEGORIES = [
  { id: "matching",    name: "Matching",    blurb: "Do we share the same nearest thing?" },
  { id: "measuring",   name: "Measuring",   blurb: "Compared to me, are you closer or further?" },
  { id: "radar",       name: "Radar",       blurb: "Are you within a given distance?" },
  { id: "thermometer", name: "Thermometer", blurb: "I travel, then you tell me hotter or colder." },
  { id: "tentacles",   name: "Tentacles",   blurb: "Which one of these are you nearest to?" },
  { id: "photo",       name: "Photo",       blurb: "Send me a picture of where you are." },
];

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
