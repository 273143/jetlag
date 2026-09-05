// Every user-facing string in the game, in Czech and English.
//
// The game is played over Czech networks, mostly by Czech speakers, so Czech
// is the default and English is the second language rather than the source of
// truth. Both are kept because the rulebook this implements is published in
// English: when a wording here drifts from what the book actually says, the
// English side is where that shows up.
//
// One file rather than one per language. The two dictionaries have to stay in
// step, and side by side a missing key is visible; in two files it is a
// deployment away from being noticed. `tools/i18ncheck.js` fails the test run
// if the key sets ever diverge, or if a key used in the code is in neither.
//
// Templates carry the markup, callers pass values already escaped:
//
//   t("log.travel", { name: esc(dest.name), n: 3 })
//
// Placeholders are `{name}` for a value and `{name:a|b|c}` for a form chosen
// by it. The chooser does double duty, which is what keeps Czech readable
// without a plural library:
//
//   number, three forms   Czech: 1 / 2-4 / 5+        "{n} zastáv{n:ka|ky|ek}"
//   number, two forms     English: 1 / everything else
//   "m" | "f" | "n"       grammatical gender         "{g:ý|á|é}"
//
// Gender is why POI labels are not just strings. "Is your nearest X the same
// as mine?" is one sentence in English and three in Czech, because "the same"
// agrees with the noun -- so a category carries its gender and the template
// selects on it, rather than the dictionary carrying thirty-three sentences.

const DICT = {};

// ---------------------------------------------------------------- runtime

export const LANGS = [
  { id: "cs", name: "Čeština" },
  { id: "en", name: "English" },
];

let lang = "cs";

export const currentLang = () => lang;

/** Set the language. Anything unknown falls back to Czech rather than to a
 *  half-translated screen. */
export function setLang(id) {
  lang = DICT[id] ? id : "cs";
  document.documentElement.lang = lang;
  try { localStorage.setItem("hs-lang", lang); } catch (err) { /* private window */ }
  return lang;
}

/**
 * The language to open in: an explicit ?lang= wins, then whatever was chosen
 * last time, then the browser's own preference, then Czech.
 *
 * The browser check is deliberately narrow -- only an outright English
 * preference gets English. A Slovak or Polish browser is far better served by
 * Czech than by English, and a Czech player on an English-locale phone is the
 * common case rather than the odd one.
 */
export function initLang(param = null) {
  let want = param;
  if (!want) { try { want = localStorage.getItem("hs-lang"); } catch (err) { want = null; } }
  if (!want) want = (navigator.languages ?? [navigator.language ?? ""])
    .some((l) => /^en\b/i.test(l)) ? "en" : "cs";
  return setLang(want);
}

/** Czech has three plural forms and English two, so the arity of the list in
 *  the template is what says which rule to apply. */
function pick(forms, value) {
  if (typeof value === "number") {
    if (forms.length >= 3) return forms[value === 1 ? 0 : (value >= 2 && value <= 4 ? 1 : 2)];
    return forms[value === 1 ? 0 : 1];
  }
  const at = { m: 0, f: 1, n: 2 }[value];
  return forms[at ?? 0] ?? forms[0];
}

/** Look a key up in the current language, falling back to the other one so a
 *  gap shows up as the wrong language rather than as the raw key. */
export function t(key, vars = {}) {
  const raw = DICT[lang]?.[key] ?? DICT.cs[key] ?? DICT.en[key] ?? key;
  return raw.replace(/\{(\w+)(?::([^}]*))?\}/g, (whole, name, forms) => {
    if (!(name in vars)) return whole;
    if (forms == null) return String(vars[name]);
    return pick(forms.split("|"), vars[name]);
  });
}

/** True when this key exists at all -- used by the map picker, which falls
 *  back to the name baked into the data file for a map nobody has translated. */
export const has = (key) => key in DICT.cs || key in DICT.en;

/**
 * Fill in the static shell.
 *
 * index.html is markup with `data-i18n` on anything that holds words, so the
 * structure stays readable as HTML instead of being assembled in JavaScript,
 * and the language switch is one call rather than a rebuild.
 */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll("[data-i18n-ph]")) el.placeholder = t(el.dataset.i18nPh);
  document.title = t("app.title");
}

/** The dictionary is exported so tools/i18ncheck.js can compare the two
 *  halves without parsing this file as text. */
export const dictionary = DICT;

// -------------------------------------------------------------------- Czech

DICT.cs = {

  // ---- the shell and the start screen ----------------------------------
  "app.title": "Hide + Seek — jižní Morava a Brno",
  "start.tag": "Oba vyrážíte ze stejné náhodné zastávky. Skrývač dostane náskok, aby stihl odjet a zalézt; pak se ptáš, čteš mapu a utahuješ smyčku. Tvoje skóre jsou hodiny ve chvíli, kdy ho najdeš — čím míň, tím líp.",
  "start.map": "Mapa",
  "start.players": "Hráči",
  "start.names": "Kdo hraje",
  "start.p1": "Hráč 1",
  "start.p2": "Hráč 2",
  "start.hider": "Skrývač",
  "start.cards": "Karty",
  "start.lang": "Jazyk",
  "start.windowLabel": "Doba skrývání <small>(náskok skrývače)</small>",
  "start.seedLabel": "Seed <small>(stejný seed, stejné kolo)</small>",
  "start.play": "Spustit hru",
  "start.playMatch": "Spustit zápas",
  "start.loading": "načítá se…",
  "start.mapFailed": "mapu se nepodařilo načíst",
  "start.mapMeta": "{blurb} — {n} {n:zastávka|zastávky|zastávek}, {l} {l:linka|linky|linek}",

  "mode.solo.name": "Sám proti aplikaci",
  "mode.solo.hint": "Skrývá se a odpovídá aplikace. Níž si vyber, jak je mazaná.",
  "mode.pass.name": "Dva hráči, jeden telefon",
  "mode.pass.hint": "Jeden se schová a podá telefon, druhý hledá. Kde je nalezen, tam začíná další kolo.",

  "cards.on.name": "S kartami a kletbami",
  "cards.on.hint": "Plná pravidla: skrývač si za odpovědi líže karty, drží časové bonusy, vetuje otázky a sesílá kletby.",
  "cards.off.name": "Čistá dedukce",
  "cards.off.hint": "Žádné karty, žádné kletby, žádné veto. Jen otázky, mapa a hodiny — a skóre jsou přesně tvoje minuty.",

  "diff.fair.name": "Poctivý",
  "diff.fair.hint": "Skrývač si zastávku vybere dřív, než začneš, a odpovídá podle ní.",
  "diff.devious.name": "Vychytralý",
  "diff.devious.hint": "Skrývač se nezavazuje. Každá odpověď je pravdivá pro nějakou zastávku, která pořád stojí ve hře — jen si vybere tu, která ti pomůže nejmíň.",

  "map.brno.name": "Brno",
  "map.brno.blurb": "město tramvají, trolejbusem a autobusem",
  "map.south-moravia.name": "Jižní Morava",
  "map.south-moravia.blurb": "celý kraj vlakem",

  // ---- offline ---------------------------------------------------------
  "off.checking": "Zjišťuji offline úložiště…",
  "off.cannot": "Tenhle prohlížeč neumí ukládat mapy pro hru offline.",
  "off.save": "Ulož mapu {name}, ať se dá hrát bez signálu.",
  "off.full": "Mapa {name} je uložená celá, i s fotkami.",
  "off.mapOnly": "Mapa {name} je uložená a hratelná offline.",
  "off.addPhotos": " Přidej fotky, jestli chceš i otázky z kategorie Fotka.",
  "off.partial": "Mapa {name} je uložená z {pct} %.",
  "off.unreadable": "Ulož mapu {name}, ať se dá hrát bez signálu. (Nepodařilo se přečíst, co už je uložené: {err}.)",
  "off.btnMap": "Mapa · {mb} MB",
  "off.btnPhotos": "Mapa + fotky · {mb} MB",
  "off.btnClear": "Smazat",
  "off.saving": "Ukládám mapu {name}: {done} z {all} dlaždic",
  "off.savingLeft": ", zbývá asi {secs} s",
  "off.savingBad": " ({bad} nedostupných)",
  "off.savedSome": "Uloženo {ok} z {total} dlaždic. <b>{failed}</b> se nepodařilo stáhnout — spusť to znovu a mezery se doplní.",
  "off.saveError": "Ukládání se nepodařilo dokončit: {err}",
  "nag.title": "Mapa {name} není uložená pro offline",
  "nag.body": "Otázky, karty i hodiny fungují bez signálu už teď. Samotná mapa ne — ve vlaku by byla prázdná a z vlaku se s tím nedá nic dělat. Uložení stojí asi <b>{mb} MB</b> a na wifi zabere minutu dvě.",
  "nag.save": "Uložit mapu · {mb} MB",
  "nag.anyway": "Hrát i bez ní",

  // ---- the panel -------------------------------------------------------
  "hud.elapsed": "uplynulo",
  "hud.possible": "možností",
  "hud.cards": "karet skrývače",
  "ui.modeMatch": "{round}. kolo · {seeker} hledá hráče {hider} · náskok {window}",
  "ui.modeSolo": "{map} · {diff} skrývač · náskok {window} · seed {seed}",
  "ui.here": "Stojíš na zastávce <b>{name}</b>",
  "ui.hereMeta": "{bits} · místní čas {clock}",
  "ui.departures": "Odjezdy",
  "pane.ask": "Ptát se",
  "pane.log": "Odpovědi",
  "ui.qblurb": "{blurb} Stojí tě to {min} min; skrývač líže {draw} a nechává si {keep}.",
  "ui.qblurbNoCards": "{blurb} Stojí tě to {min} min.",
  "ui.repeat": "×{n} cena",
  "ui.cost": "{n} min",
  "ui.options": "{n} {n:možná odpověď|možné odpovědi|možných odpovědí}",

  "cat.matching.name": "Shoda",
  "cat.matching.blurb": "Máme oba nejblíž totéž?",
  "cat.measuring.name": "Měření",
  "cat.measuring.blurb": "Jsi oproti mně blíž, nebo dál?",
  "cat.radar.name": "Radar",
  "cat.radar.blurb": "Jsi do dané vzdálenosti?",
  "cat.thermometer.name": "Teploměr",
  "cat.thermometer.blurb": "Já popojedu a ty řekneš přihořívá, nebo samá voda.",
  "cat.tentacles.name": "Chapadla",
  "cat.tentacles.blurb": "Ke kterému z nich máš nejblíž?",
  "cat.photo.name": "Fotka",
  "cat.photo.blurb": "Pošli mi obrázek toho, kde jsi.",

  // ---- effects on the seeker ------------------------------------------
  "fx.thermo": "Běží teploměr: ujeď {km} km od zastávky {name}, aby se dal odečíst.",
  "fx.jammed": "Zaseknuté dveře: zbývá {n} {n:zastávka|zastávky|zastávek} k vypáčení.",
  "fx.slow": "Hráčovy nohy: {n} {n:další jízda|další jízdy|dalších jízd} o 50 % déle.",
  "fx.long": "Zatáčka vpravo: další jízda o 40 % déle.",
  "fx.return": "Otočka: vrať se na zastávku {name}.",
  "fx.mustVisit": "Cestovka: než se zase zeptáš, zajeď na zastávku {name}.",
  "fx.noRepeat": "Průzkumník města: nikdy dvě otázky z jedné zastávky.",
  "fx.blocked": "Děravá paměť: kategorie {cat} ještě {n}× nedostupná.",
  "fx.chalice": "Přetékající kalich: skrývač líže navíc ještě {n}×.",
  "fx.banned": "Vysátý mozek: {n} {n:otázka je|otázky jsou|otázek je} nadobro pryč.",

  // ---- why an action is refused ---------------------------------------
  "block.over": "Kolo skončilo.",
  "block.challenge": "Nejdřív se vypořádej s kletbou před sebou.",
  "block.thermo": "Nejdřív dokonči teploměr: popojeď dost daleko, aby šel odečíst.",
  "block.banned": "Vysátý mozek ti tuhle otázku vymazal z hlavy.",
  "block.blockedCat": "Děravá paměť: kategorie {cat} je nedostupná ještě {n} {n:otázku|otázky|otázek}.",
  "block.mustVisit": "Cestovka ti zarezervovala pobyt na zastávce {name}. Nejdřív tam zajeď.",
  "block.forcedReturn": "Otočka tě nejdřív posílá zpátky na zastávku {name}.",
  "block.noRepeatAsk": "Průzkumník města tě nenechá zeptat se dvakrát ze stejné zastávky. Popojeď.",
  "block.alreadyHere": "Tady už jsi a máš to prohledané.",
  "block.noRoute": "Na tu zastávku nevede žádná cesta.",

  // ---- the round's log -------------------------------------------------
  "log.open": "Ty i skrývač vyrážíte ze zastávky {name} v {clock}. Na to, aby odjel a schoval se, měl {window}{widened}. To ho staví na jednu z {n} zastávek. Hodiny jsou teď tvoje.",
  "log.openWidened": " — chtělo se {asked}, ale odsud je dosažitelného tak málo, že se okno otevíralo, dokud nebylo ve hře {min} zastávek",
  "log.thermoAck": "Rozumím. Dej vědět, až budeš {km} km od zastávky {name}.",
  "log.randomize": "Randomizace. Tuhle nedostaneš — odpovím na tuhle: „{text}“",
  "log.veto": "Veto. Na tuhle odpověď nedostaneš.",
  "log.draws": "Skrývač líže {draw} a nechává si {keep}.",
  "log.travel": "Jedeš na zastávku {name} — {via}, celkem {total}: {ride} na cestě, {wait} čekání.",
  "log.travelNoWait": "Jedeš na zastávku {name} — {via}, celkem {total} na cestě, nikde se nečeká.",
  "log.viaDirect": "bez přestupu ({lines})",
  "log.viaChanges": "{n} {n:přestup|přestupy|přestupů} ({lines})",
  "log.viaPath": "{n} {n:zastávka|zastávky|zastávek} cesty",
  "log.onFoot": "pěšky",
  "log.stay": "Zůstáváš na zastávce {name} a prohledáváš ji — skrývačův Přesun vrátil tohle nástupiště do hry.",
  "log.slowed": "Hráčovy nohy tě zpomalily.",
  "log.longWay": "Zatáčka vpravo tě posílá oklikou.",
  "log.holidayOver": "Dovolená skončila. Můžeš se zase ptát.",
  "log.jammedFail": "Zaseknuté dveře: házíš {roll}. Deset minut pryč, než jsi je vypáčil.",
  "log.jammedOk": "Zaseknuté dveře: házíš {roll} a dveře povolí.",
  "log.found": "Prohledáš {m}m zónu kolem zastávky {name} a je tam. Nalezen.",
  "log.noSign": "Po skrývači na zastávce {name} ani stopa. Ve hře zůstává {n} zastávek.",
  "log.thermoShort": "Teploměr: {gone} od zastávky {name}. Než půjde odečíst, musíš mít za sebou {km} km.",
  "log.move": "Skrývač hraje Přesun a stěhuje se na sousední zastávku. Všechno, co ti řekl, popisovalo, kde byl: z {before} možných zastávek je {after}.",
  "log.plays": "Skrývač hraje {name}.",
  "log.cornered": "Se vším, co ti bylo řečeno, je konzistentní už jen zastávka {name}.",
  "log.bug": "Nesedí žádná zastávka. V kole se něco pokazilo.",
  "log.hangmanSolved": "Šibenice vyřešena: „{word}“. {n} {n:špatný tip|špatné tipy|špatných tipů}, {min} minut pryč.",
  "log.tumbleSolved": "Kostka konečně padla na {roll} po {n} {n:hodu|hodech|hodech}, což stálo {min} minut.",
  "log.mazeSolved": "Z labyrintu ven na {n} {n:krok|kroky|kroků}, což stálo {min} minut.",
  "log.cut": "{n} {n:zastávka vyloučena|zastávky vyloučeny|zastávek vyloučeno}",

  // ---- the map popup and the journey sheet -----------------------------
  "pop.possible": "pořád možná",
  "pop.searched": "prohledáno",
  "pop.out": "vyloučeno",
  "pop.searchHere": "Prohledat tady — {time}",
  "pop.travel": "Jet sem — {time}",
  "pop.unreachable": "Nedostupné",

  "jr.title": "Cesta na zastávku {name}",
  "jr.note": "Celá cesta na jedno klepnutí, i s přestupy. Hodiny se pohnou o všechno včetně čekání na nástupišti.",
  "jr.legRide": "{mode} {ref} → {to}",
  "jr.legWalk": "pěšky → {to}",
  "jr.legTime": "odjezd {clock} · {onboard} jízdy",
  "jr.legWalkTime": "{onboard} chůze",
  "jr.legWait": "{wait} čekání",
  "jr.legNoWait": "přestup rovnou",
  "jr.total": "Příjezd {clock} — stojí tě to {total}",
  "jr.split": "{ride} na cestě · {wait} čekání · {n} {n:přestup|přestupy|přestupů}",
  "jr.splitDirect": "{ride} na cestě · {wait} čekání · bez přestupu",
  "jr.plain": "{total} cesty, {n} {n:zastávka|zastávky|zastávek}{lines}",
  "jr.plainLines": " přes {lines}",
  "jr.confirm": "Vyrazit",
  "jr.cancel": "Zpět",

  "board.title": "Odjezdy — {name}",
  "board.note": "{clock}. Co odsud právě jede. Jet se dá i kamkoli jinam: klepni na zastávku na mapě a dostaneš celou cestu i s přestupy.",
  "board.onfoot": "pěšky",
  // What a vehicle is called. The mode comes off the map data as "tram" /
  // "trolleybus" / "bus" whatever the interface language is, so it has to be
  // translated at the point it is printed rather than left as a data word in
  // the middle of a Czech sentence.
  "transit.tram": "tramvaj",
  "transit.trolleybus": "trolejbus",
  "transit.bus": "autobus",
  "transit.walk": "pěšky",
  "board.walkTo": "pěšky na {n} {n:zastávku|zastávky|zastávek}",
  "board.towards": "směr {name}",
  "board.live": "{n} pořád možných",
  "board.return": "zpáteční směr",
  "board.stay": "Zůstat tady",

  // ---- curse minigames -------------------------------------------------
  "ch.hangman.body": "Uhodni pětipísmenné slovo. Každé špatné písmeno tě stojí {per} minut. Zatím: <b>{wrong}</b> špatně, <b>{lost}</b> pryč.",
  "ch.tumble.body": "Kutálej kostku z kopce, dokud nepadne 5 nebo 6. Každý hod tě stojí {per} minut. Zatím: <b>{n}</b> hodů, <b>{lost}</b> pryč.",
  "ch.tumble.throw": "Hodit kostkou",
  "ch.tumble.again": "Hodit znovu",
  "ch.maze.body": "Projdi šipkami z levého horního rohu do pravého dolního. Každý krok tě stojí {per} minut. Zatím: <b>{n}</b> kroků, <b>{lost}</b> pryč.",

  // ---- the end of a round ---------------------------------------------
  "res.foundAt": "Našel jsi ho na zastávce {name}",
  "res.clock": "na hodinách",
  "res.bonus": "držené časové bonusy",
  "res.total": "skóre skrývače",
  "res.totalNoCards": "výsledný čas",
  "res.stats": "Položil jsi {q} {q:otázku|otázky|otázek} a prohledal {s} {s:zastávku|zastávky|zastávek}.",
  "res.new": "Nová hra",
  "res.look": "Prohlédnout mapu",
  "res.matchTitle": "{seeker} našel hráče {hider} na zastávce {name}",
  "res.matchSpent": " — z {window} náskoku strávil {used} cestou sem.",
  "res.rounds": "{n} {n:kolo|kola|kol} ve skrýši",
  "res.ahead": "{name} vede na čase stráveném ve skrýši.",
  "res.level": "Na čase ve skrýši je to nerozhodně.",
  "res.unfair": "{name} se v tomhle kole ještě neschovával — zahrajte další, ať je srovnání férové.",
  "res.nextStarts": "{n}. kolo začíná tady, na zastávce {name}: kdo je nalezen, je nalezen někde — a tam začíná to další.",
  "res.next": "Podej telefon hráči {name} — {n}. kolo",

  // ---- pass and play ---------------------------------------------------
  "ho.round": "{n}. kolo",
  "ho.hides": "{name} se schovává",
  "ho.hidesText": "Kolo začíná na zastávce <b>{start}</b> a máš <b>{window}</b> na to, aby ses odsud dostal pryč. {other}: nedívej se.",
  "ho.hidesBtn": "Jsem {name} — ukaž mi mapu",
  "ho.seeks": "{name} hledá",
  "ho.seeksText": "{other} je schovaný někde do <b>{window}</b> od zastávky {start}. Aplikace za něj odpovídá pravdivě, podle toho, kde opravdu je.",
  "ho.seeksBtn": "Jsem {name} — spustit hodiny",
  "hb.choose": "{name}, vyber si, kde se schováš",
  "hb.chooseText": "Jsi na zastávce <b>{start}</b> a máš <b>{window}</b> náskoku. Klepni na kteroukoli rozsvícenou zastávku — {n} jich stihneš včas. Čím je jasnější, tím víc náskoku spolkne.",
  "hb.go": "Schovat se tady",
  "hb.goAt": "Schovat se: {name}",
  "hb.random": "Vyber za mě",
  "hb.startTitle": "Odsud jste oba vyrazili",
  "hb.startText": "Schovat se tady znamená být nalezen na první pokus. Někam jeď.",
  "hb.tooFarTitle": "{name} je moc daleko",
  "hb.tooFarText": "{time} cesty, a ty máš jen <b>{window}</b>. Vyber si něco rozsvíceného.",
  "hb.chosenText": "<b>{used}</b> od zastávky {start} — {left}{where}",
  "hb.left": "{time} náskoku zbývá",
  "hb.allSpent": "celý náskok utracený",
};

// POI labels, and the grammar the questions need to agree with them. `one`
// and `many` are both nominative -- every question below is phrased so that
// the label never has to decline, which is what keeps this to three fields
// instead of a case table.
Object.assign(DICT.cs, {
  "poi.river.one": "řeka",           "poi.river.many": "řeky",              "poi.river.g": "f",
  "poi.castle.one": "hrad nebo zámek", "poi.castle.many": "hrady a zámky",  "poi.castle.g": "m",
  "poi.brewery.one": "pivovar",      "poi.brewery.many": "pivovary",        "poi.brewery.g": "m",
  "poi.hospital.one": "nemocnice",   "poi.hospital.many": "nemocnice",      "poi.hospital.g": "f",
  "poi.aerodrome.one": "letiště",    "poi.aerodrome.many": "letiště",       "poi.aerodrome.g": "n",
  "poi.university.one": "univerzita", "poi.university.many": "univerzity",  "poi.university.g": "f",
  "poi.cinema.one": "kino",          "poi.cinema.many": "kina",             "poi.cinema.g": "n",
  "poi.zoo.one": "zoo",              "poi.zoo.many": "zoo",                 "poi.zoo.g": "f",
  "poi.theme_park.one": "zábavní park", "poi.theme_park.many": "zábavní parky", "poi.theme_park.g": "m",
  "poi.museum.one": "muzeum",        "poi.museum.many": "muzea",            "poi.museum.g": "n",
  "poi.library.one": "knihovna",     "poi.library.many": "knihovny",        "poi.library.g": "f",

  // ---- the question catalogue -----------------------------------------
  "q.radar.text": "Jsi do {km} km ode mě?",
  "q.radar.yes": "Ano — jsem do {km} km od tebe.",
  "q.radar.no": "Ne — jsem dál než {km} km.",

  "q.thermo.text": "Popojedu aspoň {km} km. Přihoří ti, nebo bude samá voda?",
  "q.thermo.hot": "Přihořívá — přiblížil ses ke mně.",
  "q.thermo.cold": "Samá voda — vzdálil ses ode mě.",

  "q.matchPoi.text": "Je {g:tvůj nejbližší|tvoje nejbližší|tvoje nejbližší} {label} {g:stejný jako můj|stejná jako moje|stejné jako moje}?",
  "q.matchPoi.ctx": "ty máš {name}",
  "q.matchPoi.yes": "Ano — {g:ten samý|ta samá|to samé}.",
  "q.matchPoi.no": "Ne — {g:jiný|jiná|jiné}.",
  "q.none": "— nic —",

  "q.measurePoi.text": "Je k tobě {g:tvůj nejbližší|tvoje nejbližší|tvoje nejbližší} {label} blíž než {g:můj|moje|moje} ke mně?",
  "q.measurePoi.ctx": "ty máš {name}, {km} daleko",
  "q.measurePoi.closer": "Blíž — mám to blíž než ty.",
  "q.measurePoi.further": "Dál — mám to dál než ty.",

  "q.tent.text": "{labels} do {km} km od tebe — {g:který|která|které} je ti nejblíž?",
  "q.tent.short": "{labels} · {km} km",
  "q.tent.ctx": "ty máš {name}",
  "q.tent.ctxNone": "ty nemáš {g:žádný|žádnou|žádné} do {km} km",
  "q.tent.nearest": "Nejblíž mám {name}.",
  "q.tent.none": "Do {km} km ode mě {g:žádný|žádná|žádné} není.",

  "q.district.short": "obvod",
  "q.district.text": "Jsi ve stejném obvodu jako já?",
  "q.district.ctx": "ty jsi v obvodu {name}",
  "q.district.yes": "Ano — stejný obvod.",
  "q.district.no": "Ne — jiný obvod.",

  "q.municipality.short": "obec",
  "q.municipality.text": "Jsi ve stejné obci jako já?",
  "q.municipality.ctx": "ty jsi v obci {name}",
  "q.municipality.yes": "Ano — ve stejné.",
  "q.municipality.no": "Ne — v jiné.",

  "q.line.short": "linka",
  "q.line.text": "Obsluhuje tvoji zastávku některá ze stejných linek jako moji?",
  "q.line.ctx": "ty jsi na lince {lines}",
  "q.line.ctxNone": "ty nejsi na žádné známé lince",
  "q.line.yes": "Ano — sdílíme linku.",
  "q.line.no": "Ne — žádná linka nevede oběma.",

  "q.lines.short": "počet linek",
  "q.lines.text": "Obsluhuje tvoji zastávku víc linek než moji?",
  "q.lines.ctx": "ta tvoje jich má {n}",
  "q.lines.more": "Víc — moje je rušnější přestupní uzel.",
  "q.lines.fewer": "Míň nebo stejně — moje není rušnější než tvoje.",

  "q.letter.short": "první písmeno",
  "q.letter.text": "Začíná název tvojí zastávky stejným písmenem jako moje?",
  "q.letter.ctx": "ta tvoje začíná na {letter}",
  "q.letter.yes": "Ano — stejné písmeno.",
  "q.letter.no": "Ne — jiné písmeno.",

  "q.length.short": "délka názvu",
  "q.length.text": "Má název tvojí zastávky stejný počet písmen jako moje?",
  "q.length.ctx": "ta tvoje má {n} písmen",
  "q.length.yes": "Ano — stejný počet písmen.",
  "q.length.no": "Ne — jiný počet.",

  "q.ele.short": "nadmořská výška",
  "q.ele.text": "Jsi výš než já?",
  "q.ele.ctx": "ty jsi v {n} m n. m.",
  "q.ele.higher": "Výš — jsem nad tebou.",
  "q.ele.lower": "Níž — jsem stejně vysoko nebo níž.",

  "q.pop.short": "počet obyvatel",
  "q.pop.text": "Má tvoje obec víc obyvatel než moje?",
  "q.pop.ctx": "ta tvoje má {n} obyvatel",
  "q.pop.larger": "Víc — moje má víc lidí.",
  "q.pop.smaller": "Míň — moje jich nemá víc než tvoje.",

  "q.hub.text": "Jsi blíž k zastávce {name} než já?",
  "q.hub.ctx": "ty jsi od ní {km}",
  "q.hub.closer": "Blíž — jsem k ní blíž než ty.",
  "q.hub.further": "Dál — jsem od ní dál než ty.",

  "q.photo.street.short": "ulice před zastávkou",
  "q.photo.street.text": "Pošli mi fotku ulice před tvojí zastávkou.",
  "q.photo.around.short": "okolí",
  "q.photo.around.text": "Pošli mi fotku svého okolí.",
  "q.photo.wide.short": "výhled odsud",
  "q.photo.wide.text": "Pošli mi fotku výhledu z místa, kde jsi.",
  "q.photo.sky.short": "obzor",
  "q.photo.sky.text": "Pošli mi fotku obzoru na všechny strany.",
  "q.photo.sent": "Fotka odeslána.",

  // Wording for the "same means of transport" question, which is one question
  // with different words on each map -- Brno splits trams from everything
  // else, the region splits proper stations from halts.
  "kind.brno.short": "druh dopravy",
  "kind.brno.text": "Obsluhuje tvoji zastávku stejný druh dopravy jako moji — tramvaj, nebo ne?",
  "kind.brno.yours": "na tvoji zastávku jezdí tramvaje",
  "kind.brno.notYours": "na tvoji zastávku nejede žádná tramvaj, jen autobusy a trolejbusy",
  "kind.brno.opt0": "obsluhovaná tramvajemi",
  "kind.brno.opt1": "jen autobusy a trolejbusy",

  // ---- the hider's cards ----------------------------------------------
  "card.veto.name": "Veto",
  "card.randomize.name": "Randomizace",
  "card.draw2.name": "Odhoď 1, líži 2",
  "card.draw3.name": "Odhoď 2, líži 3",
  "card.expand.name": "Rozšíření ruky",
  "card.duplicate.name": "Duplikát",
  "card.move.name": "Přesun",

  // ---- curses ----------------------------------------------------------
  "curse.jammed_door.name": "Zaseknuté dveře",
  "curse.jammed_door.flavour": "Každé dveře, kterých se dotkneš, se zaseknou. Další tři zastávky tě jen tak dovnitř nepustí.",
  "curse.jammed_door.effect": "Další 3 zastávky, na které dorazíš, stojí hod 2k6; pod 7 tě to stojí 10 minut.",
  "curse.gamblers_feet.name": "Hráčovy nohy",
  "curse.gamblers_feet.flavour": "Tvoje nohy se nerozhodnou pro směr, dokud se neporadí s kostkou.",
  "curse.gamblers_feet.effect": "Další 2 jízdy trvají o 50 % déle.",
  "curse.right_turn.name": "Zatáčka vpravo",
  "curse.right_turn.flavour": "Smíš zahnout jen doprava, což není způsob, jak přejet kraj.",
  "curse.right_turn.effect": "Další jízda musí jet oklikou: o 40 % déle.",
  "curse.u_turn.name": "Otočka",
  "curse.u_turn.flavour": "Jel jsi špatným směrem. Vystup a vrať se.",
  "curse.u_turn.effect": "Než uděláš cokoli jiného, musíš se vrátit na zastávku, ze které jsi právě odjel.",
  "curse.u_turn.effectNone": "Nebylo kam tě poslat zpátky, takže bude místo toho další jízda o 50 % delší.",
  "curse.urban_explorer.name": "Průzkumník města",
  "curse.urban_explorer.flavour": "Nesneseš sedět na nástupišti a přemýšlet.",
  "curse.urban_explorer.effect": "Do konce kola se nemůžeš zeptat dvakrát ze stejné zastávky.",
  "curse.spotty_memory.name": "Děravá paměť",
  "curse.spotty_memory.flavour": "Celá kategorie otázek ti vypadla z hlavy.",
  "curse.spotty_memory.effect": "Další 3 otázky nesmí být z kategorie {cat}.",
  "curse.drained_brain.name": "Vysátý mozek",
  "curse.drained_brain.flavour": "Tři otázky ti byly z hlavy vymazány úplně.",
  "curse.drained_brain.effect": "Do konce kola zakázáno — {list}.",
  "curse.overflowing.name": "Přetékající kalich",
  "curse.overflowing.flavour": "Skrývačův pohár přetéká.",
  "curse.overflowing.effect": "Skrývač si u každé z dalších 3 odpovědí líže kartu navíc.",
  "curse.travel_agent.name": "Průměrná cestovka",
  "curse.travel_agent.flavour": "Byl ti jménem zarezervován zájezd. Cestovka byla podezřele konkrétní.",
  "curse.travel_agent.effect": "Než se zeptáš na další otázku, musíš navštívit zastávku {name} — a cestovka rezervuje jen do {hops} zastávek od skrývače. {n} {n:zastávka vyloučena|zastávky vyloučeny|zastávek vyloučeno}.",
  "curse.travel_agent.effectNone": "Cestovka nenašla kam. Nic se neděje.",
  "curse.hangman.name": "Skrytá šibenice",
  "curse.hangman.flavour": "Než se někam hneš, musíš vyhrát šibenici.",
  "curse.hangman.effect": "Uhodni slovo. Každé špatné písmeno tě stojí {n} minuty.",
  "curse.labyrinth.name": "Labyrint",
  "curse.labyrinth.flavour": "Zastávka se přeskládala do bludiště. Najdi cestu ven.",
  "curse.labyrinth.effect": "Projdi z levého horního rohu do pravého dolního. Každý krok tě stojí {n} minutu.",
  "curse.endless_tumble.name": "Nekonečný kutálec",
  "curse.endless_tumble.flavour": "Kostka se musí kutálet z kopce a musí padnout dobře.",
  "curse.endless_tumble.effect": "Ať padne 5 nebo 6. Každý hod tě stojí {n} minut.",

  // The hangman keyboard is a to z, so the Czech list is words that are
  // genuinely written without diacritics -- not words with the accents
  // stripped off, which would be teaching the wrong spelling.
  "hangman.words": "vlaky kolej prkno houba kotel louka lampa banka oblak potok kopec domek hrady polka sklep tunel peron cesta strom sloup chata budka ploty vrata schod kotva kamna brody",

  // ---- formatting ------------------------------------------------------
  "fmt.minutes": "{m} min",
  "fmt.hours": "{h} h {m} min",
  "fmt.metres": "{m} m",
  "fmt.km": "{km} km",
  "fmt.decimal": ",",
});

// ------------------------------------------------------------------ English

DICT.en = {

  "app.title": "Hide + Seek — South Moravia & Brno",
  "start.tag": "You both start at the same random stop. The hider gets a head start to travel and go to ground; then you ask questions, work the map and close the net. Your score is the clock when you find them — lower is better.",
  "start.map": "Map",
  "start.players": "Players",
  "start.names": "Who is playing",
  "start.p1": "Player 1",
  "start.p2": "Player 2",
  "start.hider": "Hider",
  "start.cards": "Cards",
  "start.lang": "Language",
  "start.windowLabel": "Hiding period <small>(the hider's head start)</small>",
  "start.seedLabel": "Seed <small>(same seed, same round)</small>",
  "start.play": "Start the run",
  "start.playMatch": "Start the match",
  "start.loading": "loading…",
  "start.mapFailed": "could not be loaded",
  "start.mapMeta": "{blurb} — {n} stop{n:|s}, {l} line{l:|s}",

  "mode.solo.name": "On your own",
  "mode.solo.hint": "The app hides and answers. Pick how cunning it is below.",
  "mode.pass.name": "Two players, one device",
  "mode.pass.hint": "One hides and passes the phone; the other seeks. Whoever is found, the next round starts where they were found.",

  "cards.on.name": "Cards and curses",
  "cards.on.hint": "The full rules: the hider draws for answering, holds time bonuses, vetoes questions and casts curses.",
  "cards.off.name": "Pure deduction",
  "cards.off.hint": "No cards, no curses, no veto. Questions, the map and the clock — and the score is exactly your own minutes.",

  "diff.fair.name": "Fair",
  "diff.fair.hint": "The hider commits to a station before you start and answers honestly.",
  "diff.devious.name": "Devious",
  "diff.devious.hint": "The hider does not commit. Every answer is truthful for some station still standing — they just pick the one that helps you least.",

  "map.brno.name": "Brno",
  "map.brno.blurb": "the city, by tram, trolleybus and bus",
  "map.south-moravia.name": "South Moravia",
  "map.south-moravia.blurb": "the whole region, by train",

  "off.checking": "Checking offline storage…",
  "off.cannot": "This browser cannot store maps for offline play.",
  "off.save": "Save {name} to play with no signal.",
  "off.full": "{name} is fully saved, photos and all.",
  "off.mapOnly": "{name} is saved and playable offline.",
  "off.addPhotos": " Add photos if you want the Photo questions too.",
  "off.partial": "{name} is {pct}% saved.",
  "off.unreadable": "Save {name} to play with no signal. (Could not read what is already stored: {err}.)",
  "off.btnMap": "Map · {mb} MB",
  "off.btnPhotos": "Map + photos · {mb} MB",
  "off.btnClear": "Clear",
  "off.saving": "Saving {name}: {done} of {all} tiles",
  "off.savingLeft": ", about {secs}s left",
  "off.savingBad": " ({bad} unavailable)",
  "off.savedSome": "Saved {ok} of {total} tiles. <b>{failed}</b> could not be fetched — run it again to fill the gaps.",
  "off.saveError": "Could not finish saving: {err}",
  "nag.title": "{name} is not saved for offline",
  "nag.body": "The questions, the cards and the clock already work with no signal. The map itself does not — on a train it would be blank, and there would be no way to fix that from the train. Saving it costs about <b>{mb} MB</b> and takes a minute or two on wifi.",
  "nag.save": "Save the map · {mb} MB",
  "nag.anyway": "Play without it",

  "hud.elapsed": "elapsed",
  "hud.possible": "possible",
  "hud.cards": "hider cards",
  "ui.modeMatch": "Round {round} · {seeker} seeking {hider} · {window} head start",
  "ui.modeSolo": "{map} · {diff} hider · {window} head start · seed {seed}",
  "ui.here": "You are at <b>{name}</b>",
  "ui.hereMeta": "{bits} · local time {clock}",
  "ui.departures": "Departures",
  "pane.ask": "Ask",
  "pane.log": "Answers",
  "ui.qblurb": "{blurb} Costs you {min} min; the hider draws {draw}, keeps {keep}.",
  "ui.qblurbNoCards": "{blurb} Costs you {min} min.",
  "ui.repeat": "×{n} cost",
  "ui.cost": "{n}m",
  "ui.options": "{n} possible answer{n:|s}",

  "cat.matching.name": "Matching",
  "cat.matching.blurb": "Do we share the same nearest thing?",
  "cat.measuring.name": "Measuring",
  "cat.measuring.blurb": "Compared to me, are you closer or further?",
  "cat.radar.name": "Radar",
  "cat.radar.blurb": "Are you within a given distance?",
  "cat.thermometer.name": "Thermometer",
  "cat.thermometer.blurb": "I travel, then you tell me hotter or colder.",
  "cat.tentacles.name": "Tentacles",
  "cat.tentacles.blurb": "Which one of these are you nearest to?",
  "cat.photo.name": "Photo",
  "cat.photo.blurb": "Send me a picture of where you are.",

  "fx.thermo": "Thermometer running: travel {km} km from {name} to read it.",
  "fx.jammed": "The Jammed Door: {n} more station{n:|s} to force open.",
  "fx.slow": "The Gambler's Feet: next {n} journey{n:|s} 50% longer.",
  "fx.long": "The Right Turn: next journey 40% longer.",
  "fx.return": "The U-Turn: go back to {name}.",
  "fx.mustVisit": "Travel agent: visit {name} before asking again.",
  "fx.noRepeat": "The Urban Explorer: never two questions from one station.",
  "fx.blocked": "Spotty Memory: no {cat} questions for {n} more.",
  "fx.chalice": "The Overflowing Chalice: hider draws extra {n} more time{n:|s}.",
  "fx.banned": "The Drained Brain: {n} question{n:|s} wiped for good.",

  "block.over": "The run is over.",
  "block.challenge": "Clear the curse in front of you first.",
  "block.thermo": "Finish your thermometer first: travel far enough to read it.",
  "block.banned": "The Drained Brain wiped this question from your mind.",
  "block.blockedCat": "Spotty Memory: no {cat} questions for another {n} question{n:|s}.",
  "block.mustVisit": "The travel agent booked you into {name}. Go there first.",
  "block.forcedReturn": "The U-Turn sends you back to {name} first.",
  "block.noRepeatAsk": "The Urban Explorer will not let you ask twice from the same station. Move on.",
  "block.alreadyHere": "You are already here, and you have searched it.",
  "block.noRoute": "There is no route to that station.",

  "log.open": "You and the hider both set out from {name} at {clock}. They had {window} to travel and hide{widened}. That puts them at one of {n} stops. The clock is yours now.",
  "log.openWidened": " — {asked} was asked for, but so little is reachable from here that the window was opened up until {min} stops were in play",
  "log.thermoAck": "Understood. Tell me when you have gone {km} km from {name}.",
  "log.randomize": "Randomize. You do not get that one — answer this instead: “{text}”",
  "log.veto": "Veto. You get no answer to that one.",
  "log.draws": "The hider draws {draw} and keeps {keep}.",
  "log.travel": "You travel to {name} — {via}, {total} in total: {ride} moving, {wait} waiting.",
  "log.travelNoWait": "You travel to {name} — {via}, {total} moving, with nothing to wait for.",
  "log.viaDirect": "no changes ({lines})",
  "log.viaChanges": "{n} change{n:|s} ({lines})",
  "log.viaPath": "{n} stop{n:|s} of travel",
  "log.onFoot": "on foot",
  "log.stay": "You stay at {name} and search it — the hider's Move put this platform back in play.",
  "log.slowed": "The Gambler's Feet slow you down.",
  "log.longWay": "The Right Turn sends you round the houses.",
  "log.holidayOver": "Holiday over. You may ask questions again.",
  "log.jammedFail": "The Jammed Door: you roll {roll}. Ten minutes lost shouldering it open.",
  "log.jammedOk": "The Jammed Door: you roll {roll} and the door gives.",
  "log.found": "You sweep the {m} m zone around {name} and there they are. Found.",
  "log.noSign": "No sign of them at {name}. {n} station(s) still possible.",
  "log.thermoShort": "Thermometer: {gone} from {name}. You need {km} km before it can be read.",
  "log.move": "The hider plays Move and relocates to an adjacent station. Everything they told you described where they were: {before} possible stations becomes {after}.",
  "log.plays": "The hider plays {name}.",
  "log.cornered": "Only {name} is still consistent with everything you have been told.",
  "log.bug": "No station fits. Something has gone wrong with the run.",
  "log.hangmanSolved": "Hangman solved: “{word}”. {n} wrong guess{n:|es}, {min} minutes gone.",
  "log.tumbleSolved": "The die finally lands on {roll} after {n} throw{n:|s}, costing {min} minutes.",
  "log.mazeSolved": "Out of the labyrinth in {n} step{n:|s}, costing {min} minutes.",
  "log.cut": "{n} station{n:|s} ruled out",

  "pop.possible": "still possible",
  "pop.searched": "searched",
  "pop.out": "ruled out",
  "pop.searchHere": "Search here — {time}",
  "pop.travel": "Travel here — {time}",
  "pop.unreachable": "Unreachable",

  "jr.title": "Journey to {name}",
  "jr.note": "The whole journey in one tap, changes included. The clock moves by all of it, waiting on the platform as well.",
  "jr.legRide": "{mode} {ref} → {to}",
  "jr.legWalk": "on foot → {to}",
  "jr.legTime": "departs {clock} · {onboard} on board",
  "jr.legWalkTime": "{onboard} walking",
  "jr.legWait": "{wait} waiting",
  "jr.legNoWait": "straight on",
  "jr.total": "Arrive {clock} — costs you {total}",
  "jr.split": "{ride} moving · {wait} waiting · {n} change{n:|s}",
  "jr.splitDirect": "{ride} moving · {wait} waiting · no changes",
  "jr.plain": "{total} of travel, {n} stop{n:|s}{lines}",
  "jr.plainLines": " via {lines}",
  "jr.confirm": "Set off",
  "jr.cancel": "Back",

  "board.title": "Departures — {name}",
  "board.note": "{clock}. What is leaving from here right now. You can also go anywhere else: tap a stop on the map and you get the whole journey, changes included.",
  "board.onfoot": "on foot",
  "transit.tram": "tram",
  "transit.trolleybus": "trolleybus",
  "transit.bus": "bus",
  "transit.walk": "on foot",
  "board.walkTo": "{n} stop{n:|s} you can walk to",
  "board.towards": "towards {name}",
  "board.live": "{n} still possible",
  "board.return": "return working",
  "board.stay": "Stay here",

  "ch.hangman.body": "Guess the five-letter word. Every wrong letter costs you {per} minutes. So far: <b>{wrong}</b> wrong, <b>{lost}</b> lost.",
  "ch.tumble.body": "Roll the die down the hill until it lands on a 5 or a 6. Every throw costs you {per} minutes. So far: <b>{n}</b> throws, <b>{lost}</b> lost.",
  "ch.tumble.throw": "Throw the die",
  "ch.tumble.again": "Throw again",
  "ch.maze.body": "Walk from the top-left to the bottom-right with the arrow keys. Every step costs you {per} minutes. So far: <b>{n}</b> steps, <b>{lost}</b> lost.",

  "res.foundAt": "Found them at {name}",
  "res.clock": "on the clock",
  "res.bonus": "time-bonus cards held",
  "res.total": "the hider's score",
  "res.totalNoCards": "the final time",
  "res.stats": "You asked {q} question{q:|s} and searched {s} station{s:|s}.",
  "res.new": "New run",
  "res.look": "Look at the map",
  "res.matchTitle": "{seeker} found {hider} at {name}",
  "res.matchSpent": " — {used} of a {window} head start spent getting there.",
  "res.rounds": "{n} round{n:|s} hidden",
  "res.ahead": "{name} is ahead on time hidden.",
  "res.level": "Level on time hidden.",
  "res.unfair": "{name} has yet to hide this time round — play the next one to make it a fair comparison.",
  "res.nextStarts": "Round {n} starts here, at {name}: whoever is found is found somewhere, and that is where the next one begins.",
  "res.next": "Pass to {name} — round {n}",

  "ho.round": "Round {n}",
  "ho.hides": "{name} hides",
  "ho.hidesText": "The round starts at <b>{start}</b>, and you have <b>{window}</b> to get away from it. {other}: look away.",
  "ho.hidesBtn": "I'm {name} — show me the map",
  "ho.seeks": "{name} seeks",
  "ho.seeksText": "{other} is hidden somewhere within <b>{window}</b> of {start}. The app answers for them, truthfully, from where they actually are.",
  "ho.seeksBtn": "I'm {name} — start the clock",
  "hb.choose": "{name}, choose where to hide",
  "hb.chooseText": "You are at <b>{start}</b> with <b>{window}</b> of head start. Tap any lit stop — {n} are close enough to reach in time. The brighter it is, the more of your head start it spends.",
  "hb.go": "Hide here",
  "hb.goAt": "Hide at {name}",
  "hb.random": "Surprise me",
  "hb.startTitle": "That is where you both started",
  "hb.startText": "Hiding here would be found in one move. Go somewhere.",
  "hb.tooFarTitle": "{name} is too far",
  "hb.tooFarText": "{time} away, and you only have <b>{window}</b>. Pick something lit.",
  "hb.chosenText": "<b>{used}</b> from {start} — {left}{where}",
  "hb.left": "{time} of your head start left over",
  "hb.allSpent": "the whole head start spent",

  "poi.river.one": "river",             "poi.river.many": "rivers",
  "poi.castle.one": "castle or chateau", "poi.castle.many": "castles & chateaux",
  "poi.brewery.one": "brewery",         "poi.brewery.many": "breweries",
  "poi.hospital.one": "hospital",       "poi.hospital.many": "hospitals",
  "poi.aerodrome.one": "aerodrome",     "poi.aerodrome.many": "aerodromes",
  "poi.university.one": "university",   "poi.university.many": "universities",
  "poi.cinema.one": "cinema",           "poi.cinema.many": "cinemas",
  "poi.zoo.one": "zoo",                 "poi.zoo.many": "zoos",
  "poi.theme_park.one": "theme park",   "poi.theme_park.many": "theme parks",
  "poi.museum.one": "museum",           "poi.museum.many": "museums",
  "poi.library.one": "library",         "poi.library.many": "libraries",
  // English needs no agreement, but the keys have to exist on both sides.
  "poi.river.g": "f", "poi.castle.g": "m", "poi.brewery.g": "m",
  "poi.hospital.g": "f", "poi.aerodrome.g": "n", "poi.university.g": "f",
  "poi.cinema.g": "n", "poi.zoo.g": "f", "poi.theme_park.g": "m",
  "poi.museum.g": "n", "poi.library.g": "f",

  "q.radar.text": "Are you within {km} km of me?",
  "q.radar.yes": "Yes — I am within {km} km of you.",
  "q.radar.no": "No — I am more than {km} km away.",

  "q.thermo.text": "I will travel at least {km} km. Am I hotter or colder afterwards?",
  "q.thermo.hot": "Hotter — you moved closer to me.",
  "q.thermo.cold": "Colder — you moved away from me.",

  "q.matchPoi.text": "Is your nearest {label} the same as mine?",
  "q.matchPoi.ctx": "yours is {name}",
  "q.matchPoi.yes": "Yes — the same one.",
  "q.matchPoi.no": "No — a different one.",
  "q.none": "— none —",

  "q.measurePoi.text": "Is your nearest {label} closer to you than mine is to me?",
  "q.measurePoi.ctx": "yours is {name}, {km} away",
  "q.measurePoi.closer": "Closer — mine is nearer than yours.",
  "q.measurePoi.further": "Further — mine is further than yours.",

  "q.tent.text": "Of all the {labels} within {km} km of you, which are you nearest to?",
  "q.tent.short": "{labels} · {km} km",
  "q.tent.ctx": "yours is {name}",
  "q.tent.ctxNone": "you have none within {km} km",
  "q.tent.nearest": "The nearest is {name}.",
  "q.tent.none": "There are none within {km} km of me.",

  "q.district.short": "district",
  "q.district.text": "Are you in the same district as me?",
  "q.district.ctx": "you are in {name}",
  "q.district.yes": "Yes — the same district.",
  "q.district.no": "No — a different district.",

  "q.municipality.short": "locality",
  "q.municipality.text": "Are you in the same locality as me?",
  "q.municipality.ctx": "you are in {name}",
  "q.municipality.yes": "Yes — the same one.",
  "q.municipality.no": "No — a different one.",

  "q.line.short": "transit line",
  "q.line.text": "Is your stop served by any of the same lines as mine?",
  "q.line.ctx": "you are on {lines}",
  "q.line.ctxNone": "you are on no known line",
  "q.line.yes": "Yes — we share a line.",
  "q.line.no": "No — no line runs through both.",

  "q.lines.short": "lines served",
  "q.lines.text": "Is your stop served by more lines than mine?",
  "q.lines.ctx": "yours has {n}",
  "q.lines.more": "More — mine is the busier interchange.",
  "q.lines.fewer": "Fewer or equal — mine is no busier than yours.",

  "q.letter.short": "first letter",
  "q.letter.text": "Does your station's name start with the same letter as mine?",
  "q.letter.ctx": "yours starts with {letter}",
  "q.letter.yes": "Yes — the same letter.",
  "q.letter.no": "No — a different letter.",

  "q.length.short": "name length",
  "q.length.text": "Does your station's name have the same number of letters as mine?",
  "q.length.ctx": "yours has {n} letters",
  "q.length.yes": "Yes — the same number of letters.",
  "q.length.no": "No — a different number.",

  "q.ele.short": "elevation",
  "q.ele.text": "Are you at a higher elevation than me?",
  "q.ele.ctx": "you are at {n} m",
  "q.ele.higher": "Higher — I am above you.",
  "q.ele.lower": "Lower — I am at or below your elevation.",

  "q.pop.short": "population",
  "q.pop.text": "Is your municipality larger than mine by population?",
  "q.pop.ctx": "yours has {n} people",
  "q.pop.larger": "Larger — mine has more people.",
  "q.pop.smaller": "Smaller — mine has no more people than yours.",

  "q.hub.text": "Are you closer to {name} than I am?",
  "q.hub.ctx": "you are {km} from it",
  "q.hub.closer": "Closer — I am nearer to it than you.",
  "q.hub.further": "Further — I am further from it than you.",

  "q.photo.street.short": "the street outside",
  "q.photo.street.text": "Send me a photo of the street outside your station.",
  "q.photo.around.short": "your surroundings",
  "q.photo.around.text": "Send me a photo of your surroundings.",
  "q.photo.wide.short": "the view from here",
  "q.photo.wide.text": "Send me a photo of the view from where you are.",
  "q.photo.sky.short": "the horizon",
  "q.photo.sky.text": "Send me a photo of the horizon in every direction.",
  "q.photo.sent": "Photo sent.",

  "kind.brno.short": "means of transport",
  "kind.brno.text": "Is your stop served by the same means of transport as mine — tram, or not?",
  "kind.brno.yours": "trams serve your stop",
  "kind.brno.notYours": "no tram serves your stop, only buses and trolleybuses",
  "kind.brno.opt0": "served by trams",
  "kind.brno.opt1": "buses and trolleybuses only",

  "card.veto.name": "Veto",
  "card.randomize.name": "Randomize",
  "card.draw2.name": "Discard 1, Draw 2",
  "card.draw3.name": "Discard 2, Draw 3",
  "card.expand.name": "Expand Hand",
  "card.duplicate.name": "Duplicate",
  "card.move.name": "Move",

  "curse.jammed_door.name": "The Jammed Door",
  "curse.jammed_door.flavour": "Every door you touch sticks. The next three stations you reach will not let you in easily.",
  "curse.jammed_door.effect": "The next 3 stations you enter cost a 2d6 roll; under 7 loses you 10 minutes.",
  "curse.gamblers_feet.name": "The Gambler's Feet",
  "curse.gamblers_feet.flavour": "Your feet will not commit to a direction without consulting a die first.",
  "curse.gamblers_feet.effect": "Your next 2 journeys take 50% longer.",
  "curse.right_turn.name": "The Right Turn",
  "curse.right_turn.flavour": "You may only ever turn right, which is no way to cross a region.",
  "curse.right_turn.effect": "Your next journey must go the long way round: 40% longer.",
  "curse.u_turn.name": "The U-Turn",
  "curse.u_turn.flavour": "You were going the wrong way. Get off and go back.",
  "curse.u_turn.effect": "You must return to the station you just left before doing anything else.",
  "curse.u_turn.effectNone": "You had nowhere to be sent back to, so your next journey is 50% longer instead.",
  "curse.urban_explorer.name": "The Urban Explorer",
  "curse.urban_explorer.flavour": "You cannot bear to sit still on a platform and think.",
  "curse.urban_explorer.effect": "For the rest of the run you cannot ask two questions from the same station.",
  "curse.spotty_memory.name": "Spotty Memory",
  "curse.spotty_memory.flavour": "A whole category of question has slipped your mind.",
  "curse.spotty_memory.effect": "You cannot ask {cat} questions for your next 3 questions.",
  "curse.drained_brain.name": "The Drained Brain",
  "curse.drained_brain.flavour": "Three questions have been scrubbed from your mind entirely.",
  "curse.drained_brain.effect": "Banned for the rest of the run — {list}.",
  "curse.overflowing.name": "The Overflowing Chalice",
  "curse.overflowing.flavour": "The hider's cup runneth over.",
  "curse.overflowing.effect": "The hider draws an extra card on each of their next 3 answers.",
  "curse.travel_agent.name": "The Mediocre Travel Agent",
  "curse.travel_agent.flavour": "A holiday has been booked on your behalf. The agent has been suspiciously specific.",
  "curse.travel_agent.effect": "You must visit {name} before you may ask another question — and the agent only books within {hops} stops of the hider. {n} station{n:|s} ruled out.",
  "curse.travel_agent.effectNone": "The travel agent could not find anywhere. Nothing happens.",
  "curse.hangman.name": "The Hidden Hangman",
  "curse.hangman.flavour": "You must win a game of hangman before you go anywhere.",
  "curse.hangman.effect": "Guess the word. Every wrong letter costs you {n} minutes.",
  "curse.labyrinth.name": "The Labyrinth",
  "curse.labyrinth.flavour": "The station has rearranged itself into a maze. Find your way out.",
  "curse.labyrinth.effect": "Walk from the top-left to the bottom-right. Every step costs you {n} minute.",
  "curse.endless_tumble.name": "The Endless Tumble",
  "curse.endless_tumble.flavour": "A die must be rolled down the hill, and it must land well.",
  "curse.endless_tumble.effect": "Roll a 5 or a 6 to continue. Every roll costs you {n} minutes.",

  "hangman.words": "train board north river cliff gorge plaza abbey cargo vault wharf bench spire kiosk crown hedge marsh grove tower canal depot ridge brook field cabin chalk flint",

  "fmt.minutes": "{m}m",
  "fmt.hours": "{h}h {m}m",
  "fmt.metres": "{m} m",
  "fmt.km": "{km} km",
  "fmt.decimal": ".",
};
