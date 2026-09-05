// Rendering and input. Holds no game rules; it reads state and calls game.js.

import { CATEGORIES, categoryName, categoryBlurb } from "./questions.js";
import { RULES } from "./rules.js";
import { formatDuration, formatClock } from "./geo.js";
import { makePhoto } from "./map.js";
import { askBlocker, travelBlocker, finalScore, seeker, board, journey } from "./game.js";
import { t, has } from "./i18n.js";

/** What to call a vehicle. The mode is a data word -- "trolleybus" -- and
 *  anything the dictionary does not know is printed as it came off the map
 *  rather than as a missing key. */
const modeName = (mode) => (has(`transit.${mode}`) ? t(`transit.${mode}`) : mode);

const $ = (id) => document.getElementById(id);

export class UI {
  /**
   * @param {object}  [opts.match]  the pass-and-play match this round belongs
   *   to, if any. Only the result sheet cares: a round inside a match ends in
   *   standings and a handover rather than in "New run".
   */
  constructor(state, gmap, handlers, { match = null } = {}) {
    this.state = state;
    this.gmap = gmap;
    this.on = handlers;
    this.match = match;
    this.cat = "radar";
    // Which of the two panes the panel is showing. They share the panel
    // rather than splitting it because at a readable size neither half is
    // tall enough to be worth reading -- see #pane in css/style.css.
    this.pane = "ask";
    this.logged = 0;
    // Which answer lists the player has expanded. Kept on the UI rather than
    // in game state: refresh() rebuilds the panel after every action, and a
    // list that snapped shut each time would be useless.
    this.openOptions = new Set();

    // The head start belongs here rather than buried in the log: every
    // candidate on the map is on it because of that number.
    $("mode").textContent = match
      ? t("ui.modeMatch", {
          round: match.round, seeker: match.seekerName, hider: match.hiderName,
          window: formatDuration(state.hiding.minutes),
        })
      : t("ui.modeSolo", {
          map: t(`map.${state.world.id}.name`), diff: t(`diff.${state.difficulty}.name`),
          window: formatDuration(state.hiding.minutes), seed: state.seed,
        });
    // With no deck there is no hand to count, and a stat stuck on zero all
    // round is worse than no stat at all.
    $("handstat").hidden = !state.cards;
    // A match reuses the panel across rounds, so the last round's log has to
    // go with it -- the entry counter starts at zero either way.
    $("log").innerHTML = "";
    $("effects").innerHTML = "";
    this.buildPaneTabs();
    this.buildCategoryTabs();
    this.refresh();
  }

  /** Let go of everything outside the panel before a new round takes over.
   *  The labyrinth's key handler is on the window, and a dropped UI that kept
   *  listening would step the previous round's maze. */
  dispose() {
    if (this.mazeKeys) removeEventListener("keydown", this.mazeKeys);
    this.mazeKeys = null;
    this.closeModal();
  }

  /** The Ask / Answers switch. Built here rather than left static in the
   *  shell because a match makes a new UI per round over the same DOM, and
   *  static buttons would collect one listener per round. */
  buildPaneTabs() {
    const nav = $("pane");
    nav.innerHTML = "";
    for (const [id, name] of [["ask", t("pane.ask")], ["log", t("pane.log")]]) {
      const b = document.createElement("button");
      b.dataset.pane = id;
      b.innerHTML = `<span>${name}</span><i></i>`;
      b.addEventListener("click", () => this.setPane(id));
      nav.append(b);
    }
  }

  /** @param {"ask"|"log"} pane */
  setPane(pane) {
    this.pane = pane;
    $("askpane").hidden = pane !== "ask";
    $("logwrap").hidden = pane !== "log";
    for (const b of $("pane").children) {
      b.setAttribute("aria-selected", String(b.dataset.pane === this.pane));
    }
    // A hidden element has no scroll height, so the log cannot be pinned to
    // the bottom while it is the pane that is put away -- do it on the way in.
    if (pane === "log") $("logwrap").scrollTop = $("logwrap").scrollHeight;
  }

  buildCategoryTabs() {
    const nav = $("cats");
    nav.innerHTML = "";
    for (const id of CATEGORIES) {
      const b = document.createElement("button");
      b.textContent = categoryName(id);
      b.dataset.cat = id;
      b.addEventListener("click", () => { this.cat = id; this.refresh(); });
      nav.append(b);
    }
  }

  refresh() {
    const s = this.state;
    $("clock").textContent = formatDuration(s.clock);
    $("candcount").textContent = s.status === "found" ? "found" : s.candidates.length;
    $("handcount").textContent = s.hider.hand.length;

    const me = seeker(s);
    const lines = s.world.lineNames(me.lines ?? []);
    $("here").innerHTML =
      t("ui.here", { name: esc(me.name) }) +
      (lines.length ? ` <span class="lines">${lines.map((l) => `<i>${esc(l)}</i>`).join("")}</span>` : "") +
      "<br>" + t("ui.hereMeta", {
        bits: [me.district, me.municipality, `${Math.round(me.ele)} m`]
          .filter(Boolean).map(esc).join(" · "),
        clock: formatClock(RULES.startClock + s.clock),
      });
    if (board(s)) {
      const b = document.createElement("button");
      b.className = "departures";
      b.textContent = t("ui.departures");
      b.addEventListener("click", () => this.showBoard());
      $("here").append(b);
    }

    this.renderEffects();
    this.renderQuestions();
    this.renderLog();
    this.gmap.render(s);

    if (s.challenge) this.showChallenge();
    else if (s.status === "found") this.showResult();
  }

  renderEffects() {
    const s = this.state, e = s.effects, out = [];
    if (s.pendingThermo) {
      const from = s.world.byId.get(s.pendingThermo.fromId);
      out.push(t("fx.thermo", { km: s.pendingThermo.km, name: esc(from.name) }));
    }
    if (e.jammedDoors > 0) out.push(t("fx.jammed", { n: e.jammedDoors }));
    if (e.slowLegs > 0) out.push(t("fx.slow", { n: e.slowLegs }));
    if (e.longWay > 0) out.push(t("fx.long"));
    if (e.forcedReturn != null) out.push(t("fx.return", { name: esc(s.world.byId.get(e.forcedReturn).name) }));
    if (e.mustVisit != null) out.push(t("fx.mustVisit", { name: esc(s.world.byId.get(e.mustVisit).name) }));
    if (e.noRepeatAsk) out.push(t("fx.noRepeat"));
    if (e.blockedCategory) out.push(t("fx.blocked", {
      cat: categoryName(e.blockedCategory.cat), n: e.blockedCategory.questions }));
    if (e.chalice > 0) out.push(t("fx.chalice", { n: e.chalice }));
    if (s.bannedQuestions.size) out.push(t("fx.banned", { n: s.bannedQuestions.size }));
    $("effects").innerHTML = out.map((line) => `<div class="effect">${line}</div>`).join("");
  }

  renderQuestions() {
    const s = this.state;
    const box = $("questions");
    box.innerHTML = "";
    for (const b of $("cats").children) b.setAttribute("aria-selected", String(b.dataset.cat === this.cat));

    const blurb = document.createElement("div");
    blurb.className = "qblurb";
    const { draw, keep } = RULES.draw[this.cat];
    blurb.textContent = s.cards
      ? t("ui.qblurb", { blurb: categoryBlurb(this.cat), min: RULES.askMinutes[this.cat], draw, keep })
      : t("ui.qblurbNoCards", { blurb: categoryBlurb(this.cat), min: RULES.askMinutes[this.cat] });
    box.append(blurb);

    // Everything a question can tell you, before you pay for it. A question
    // whose answer names a place is only information if you know the other
    // places it could have named, and the seeker's own value is half of every
    // comparison -- both used to appear in the log *after* the ask, which is
    // exactly the wrong side of the decision.
    const ctx = { seeker: seeker(s) };
    for (const q of s.questions.filter((x) => x.cat === this.cat)) {
      const row = document.createElement("div");
      row.className = "qrow";

      const b = document.createElement("button");
      b.className = "q";
      const times = s.asked.get(q.id) || 0;
      const ctxText = q.context?.(ctx);
      b.innerHTML = `<span>${esc(q.text)}` +
        (ctxText ? `<i class="ctx">${esc(ctxText)}</i>` : "") + `</span>` +
        // Repeats cost the hider double, so the price rises only where there
        // is a hider deck to charge it to.
        (times && s.cards ? `<span class="rep">${esc(t("ui.repeat", { n: times + 1 }))}</span>` : "") +
        `<span class="cost">${esc(t("ui.cost", { n: RULES.askMinutes[q.cat] }))}</span>`;
      const blocker = askBlocker(s, q);
      if (blocker) { b.disabled = true; b.title = blocker; }
      b.addEventListener("click", () => this.on.ask(q));
      row.append(b);

      const list = q.list?.() ?? [];
      if (list.length) {
        const mine = q.mine?.(ctx);
        const d = document.createElement("details");
        d.className = "opts";
        d.open = this.openOptions.has(q.id);
        d.addEventListener("toggle", () => {
          if (d.open) this.openOptions.add(q.id); else this.openOptions.delete(q.id);
        });
        d.innerHTML =
          `<summary>${esc(t("ui.options", { n: list.length }))}</summary>` +
          `<div class="olist">` +
          list.map((n) => `<i${n === mine ? ' class="mine"' : ""}>${esc(n)}</i>`).join("") +
          `</div>`;
        row.append(d);
      }
      box.append(row);
    }
  }

  renderLog() {
    const s = this.state, log = $("log");
    // What the seeker paid for. Anything else in the log -- their own moves,
    // the round's opening -- is a receipt, and is not worth taking the panel
    // away from the question they are part-way through choosing.
    let pull = false;
    for (; this.logged < s.log.length; this.logged++) {
      const e = s.log[this.logged];
      if (e.quiet) continue;
      if (e.who === "hider" || e.who === "curse") pull = true;
      const div = document.createElement("div");
      div.className = `entry ${e.who}${e.found ? " found" : ""}`;
      const when = `<span class="t">${formatDuration(e.clock)}</span>`;
      if (e.who === "curse") {
        div.innerHTML = `${when}<b>${esc(e.text)}</b>` +
          `<span class="fx">${esc(e.flavour ?? "")} ${esc(e.effect ?? "")}</span>`;
      } else {
        div.innerHTML = when + esc(e.text) +
          (e.context ? `<span class="ctx">(${esc(e.context)})</span>` : "") +
          (e.cut > 0 ? `<span class="cut">${esc(t("log.cut", { n: e.cut }))}</span>` : "");
      }
      log.append(div);
      if (e.photo) {
        const ph = document.createElement("div");
        ph.className = "photo";
        div.append(ph);
        makePhoto(ph, e.photo);
      }
    }
    $("pane").querySelector('[data-pane="log"] i').textContent =
      s.log.filter((e) => e.who === "hider" && !e.quiet).length || "";
    // setPane re-pins the scroll, so this is also what keeps the log at the
    // bottom -- including the first call, which is what paints the tabs.
    this.setPane(pull ? "log" : this.pane);
  }

  /**
   * Popup shown when a station on the map is clicked: what it is, and the
   * whole journey there.
   *
   * This is where the change of travel model shows. A move used to be one
   * ride on one line, so a click on anything off that line came back with an
   * estimate and an instruction -- "no service from here goes there, ride to
   * an interchange first" -- and the seeker hand-routed the network a leg at
   * a time. Now the button goes there, changes and all.
   *
   * What the restriction did give you for free was a running lesson in what a
   * change costs, and it must not disappear with it. So the popup is the
   * ticket as well as the button: the split into moving and waiting, how many
   * changes, and every leg with its line, its departure and its wait.
   */
  stationPopup(station) {
    const s = this.state;
    const blocker = travelBlocker(s, station.id);
    const alive = s.candidates.some((c) => c.id === station.id);
    const here = station.id === s.seekerId;
    const plan = here ? null : journey(s, station.id);
    const el = document.createElement("div");
    const lines = s.world.lineNames(station.lines ?? []);
    el.innerHTML =
      `<b>${esc(station.name)}</b>` +
      (lines.length ? `<div class="lines">${lines.map((l) => `<i>${esc(l)}</i>`).join("")}</div>` : "") +
      `<div class="meta">${[station.district, `${Math.round(station.ele)} m`].filter(Boolean).map(esc).join(" · ")}` +
      ` · ${esc(alive ? t("pop.possible") : s.checked.has(station.id) ? t("pop.searched") : t("pop.out"))}</div>` +
      (plan ? this.journeyHtml(plan) : "");

    const btn = document.createElement("button");
    btn.className = "travel";
    btn.textContent = here
      // You can be standing on a live candidate again after the hider plays
      // Move; searching where you stand costs the search time, not a journey.
      ? t("pop.searchHere", { time: formatDuration(RULES.searchMinutes) })
      : plan
        ? t("pop.travel", { time: formatDuration(plan.minutes) })
        : t("pop.unreachable");
    if (blocker) { btn.disabled = true; btn.title = blocker; }
    btn.addEventListener("click", () => this.on.travel(station));
    el.append(btn);
    return el;
  }

  /**
   * The itinerary, as HTML: the totals split into moving and waiting, then
   * one row per leg.
   *
   * Shared by the popup and the confirmation sheet because it is the same
   * information in both, and because the number in the button has to be the
   * sum of the rows underneath it or nobody will believe either.
   */
  journeyHtml(plan) {
    const summary = plan.timetabled
      ? (plan.changes > 0
          ? t("jr.split", { ride: formatDuration(plan.onboard),
                            wait: formatDuration(plan.wait), n: plan.changes })
          : t("jr.splitDirect", { ride: formatDuration(plan.onboard),
                                  wait: formatDuration(plan.wait) }))
      : t("jr.plain", {
          total: formatDuration(plan.minutes), n: plan.stops,
          lines: plan.lines.length ? t("jr.plainLines", { lines: plan.lines.join(" → ") }) : "",
        });

    const rows = plan.legs.map((leg) => {
      const to = this.state.world.byId.get(leg.toId);
      const head = leg.walk
        ? t("jr.legWalk", { to: esc(to.name) })
        : t("jr.legRide", { mode: esc(modeName(leg.mode)), ref: esc(leg.ref), to: esc(to.name) });
      const time = leg.walk
        ? t("jr.legWalkTime", { onboard: formatDuration(leg.onboard) })
        : t("jr.legTime", { clock: formatClock(RULES.startClock + leg.depart),
                            onboard: formatDuration(leg.onboard) });
      const wait = leg.wait > 0 ? t("jr.legWait", { wait: formatDuration(leg.wait) })
                                : t("jr.legNoWait");
      return `<li class="${leg.walk ? "onfoot" : leg.mode}"><b>${head}</b>` +
             `<span>${esc(time)} · ${esc(wait)}</span></li>`;
    }).join("");

    return `<div class="jsplit">${esc(summary)}</div>` +
           (rows ? `<ol class="jlegs">${rows}</ol>` : "");
  }

  /**
   * The departure board at the seeker's stop.
   *
   * One panel per line and direction: where it is heading, when the next
   * three leave, and every stop it serves from here with the time on board
   * and the clock time you would arrive.
   *
   * It is no longer the only way to travel -- any stop on the map is one tap
   * away now -- but it is still the only way to see what is actually leaving
   * from under your feet, which is how you decide whether waiting four
   * minutes for the tram beats walking. Choosing a stop opens the same
   * confirmation as the map does, and the journey it confirms is the fastest
   * one, which for a stop on this line is this ride.
   */
  showBoard() {
    const s = this.state;
    const entries = board(s);
    if (!entries) return;
    const me = seeker(s);
    const clockAt = (m) => formatClock(RULES.startClock + m);

    this.openModal((sheet) => {
      sheet.innerHTML =
        `<h2>${esc(t("board.title", { name: me.name }))}</h2>` +
        `<p class="sheetnote">${esc(t("board.note", { clock: clockAt(s.clock) }))}</p>`;

      // A busy interchange has forty-seven services on it, so the board opens
      // the way a real one reads: every line and direction with its next
      // departures, and the stops behind a tap.
      //
      // Which ones open is the useful part. Early on every service still
      // carries candidates, so "open the ones that do" opens all forty-seven
      // and collapses nothing; late on only one or two do. So it opens the
      // few carrying the most stations that could still hold the hider, which
      // is the same list at both ends of a run.
      const alive = new Set(s.candidates.map((c) => c.id));
      const liveCount = (e) => e.stops.filter((st) => alive.has(st.id)).length;
      const OPEN = 4;
      const cutoff = entries.map(liveCount).sort((a, b) => b - a)[OPEN - 1] ?? 0;
      let opened = 0;
      for (const e of entries) {
        const live = liveCount(e);
        const worth = live > 0 && live >= cutoff && opened < OPEN;
        if (worth) opened++;
        const sec = document.createElement("details");
        sec.className = "svc" + (e.walk ? " onfoot" : "") + (live ? " worth" : "");
        const alive_ = live ? `<b>${esc(t("board.live", { n: live }))}</b>` : "";
        sec.innerHTML = e.walk
          ? `<summary><span class="mode walk">${esc(t("board.onfoot"))}</span> ` +
            `${esc(t("board.walkTo", { n: e.stops.length }))}` + alive_ + `</summary>`
          : `<summary><span class="mode ${e.mode}">${esc(modeName(e.mode))} ${esc(e.ref)}</span>` +
            `<span class="tw">${esc(t("board.towards", { name: e.towards }))}</span>` +
            `<span class="next">${e.departures.map(clockAt).join(" · ")}</span>` +
            (e.reversed ? `<i>${esc(t("board.return"))}</i>` : "") +
            alive_ + `</summary>`;

        const list = document.createElement("div");
        list.className = "stoplist";
        for (const stop of e.stops) {
          const st = s.world.byId.get(stop.id);
          const cost = e.walk
            ? { wait: 0, onboard: stop.onboard, minutes: stop.onboard }
            : { wait: e.departures[0] - s.clock, onboard: stop.onboard,
                minutes: e.departures[0] - s.clock + stop.onboard };
          const row = document.createElement("button");
          row.className = "stoprow" + (alive.has(stop.id) ? " alive" : "");
          row.innerHTML =
            `<span class="nm">${esc(st.name)}</span>` +
            `<span class="dur">${formatDuration(cost.onboard)}</span>` +
            `<span class="arr">${clockAt(s.clock + cost.minutes)}</span>`;
          const blocker = travelBlocker(s, stop.id);
          if (blocker) { row.disabled = true; row.title = blocker; }
          row.addEventListener("click", () => this.confirmJourney(st));
          list.append(row);
        }
        sec.append(list);
        sec.open = worth || entries.length <= 4;
        sheet.append(sec);
      }

      const close = document.createElement("button");
      close.className = "btn";
      close.textContent = t("board.stay");
      close.addEventListener("click", () => this.closeModal());
      sheet.append(close);
    });
  }

  /** The whole journey somewhere, before it costs anything. */
  confirmJourney(station) {
    const s = this.state;
    const plan = journey(s, station.id);
    if (!plan) return;
    this.openModal((sheet) => {
      sheet.innerHTML =
        `<h2>${esc(t("jr.title", { name: station.name }))}</h2>` +
        `<p class="sheetnote">${esc(t("jr.note"))}</p>` +
        `<div class="ticket">` + this.journeyHtml(plan) +
        `<div class="total">${esc(t("jr.total", {
          clock: formatClock(RULES.startClock + s.clock + plan.minutes),
          total: formatDuration(plan.minutes),
        }))}</div></div>`;
      const go = document.createElement("button");
      go.className = "btn go";
      go.textContent = t("jr.confirm");
      go.addEventListener("click", () => { this.closeModal(); this.on.travel(station); });
      const back = document.createElement("button");
      back.className = "btn";
      back.textContent = t("jr.cancel");
      back.addEventListener("click", () => this.showBoard());
      sheet.append(go, back);
    });
  }

  // ---------------------------------------------------------- modal work

  openModal(render) {
    $("modal").hidden = false;
    render($("sheet"));
  }
  closeModal() { $("modal").hidden = true; $("sheet").innerHTML = ""; }

  showChallenge() {
    const c = this.state.challenge;
    if (this.shownChallenge === c) return;
    this.shownChallenge = c;
    this.openModal((sheet) => this.renderChallenge(sheet));
  }

  renderChallenge(sheet) {
    const c = this.state.challenge;
    if (!c) { this.shownChallenge = null; this.closeModal(); this.refresh(); return; }
    sheet.innerHTML = "";
    if (c.type === "hangman") this.renderHangman(sheet, c);
    if (c.type === "tumble") this.renderTumble(sheet, c);
    if (c.type === "labyrinth") this.renderLabyrinth(sheet, c);
  }

  step(input) {
    this.on.challenge(input);
    this.renderChallenge($("sheet"));
    this.refreshQuiet();
  }

  /** Update the HUD without re-entering the modal logic. */
  refreshQuiet() {
    $("clock").textContent = formatDuration(this.state.clock);
    this.renderLog();
  }

  renderHangman(sheet, c) {
    const shown = [...c.word].map((ch) => (c.guessed.has(ch) ? ch : "_")).join(" ");
    sheet.insertAdjacentHTML("beforeend",
      `<h2 class="curse">${esc(t("curse.hangman.name"))}</h2>` +
      `<p>${t("ch.hangman.body", {
         per: c.minutesPerMiss, wrong: c.wrong,
         lost: formatDuration(c.wrong * c.minutesPerMiss) })}</p>` +
      `<div class="word">${shown}</div>`);
    const keys = document.createElement("div");
    keys.className = "keys";
    for (const ch of "abcdefghijklmnopqrstuvwxyz") {
      const b = document.createElement("button");
      b.textContent = ch;
      if (c.guessed.has(ch)) { b.disabled = true; if (!c.word.includes(ch)) b.className = "miss"; }
      b.addEventListener("click", () => this.step(ch));
      keys.append(b);
    }
    sheet.append(keys);
  }

  renderTumble(sheet, c) {
    const last = c.rolls[c.rolls.length - 1];
    sheet.insertAdjacentHTML("beforeend",
      `<h2 class="curse">${esc(t("curse.endless_tumble.name"))}</h2>` +
      `<p>${t("ch.tumble.body", {
         per: c.minutesPerRoll, n: c.rolls.length,
         lost: formatDuration(c.rolls.length * c.minutesPerRoll) })}</p>` +
      `<div class="dice">${last ? "⚀⚁⚂⚃⚄⚅"[last - 1] : "·"}</div>`);
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = c.rolls.length ? t("ch.tumble.again") : t("ch.tumble.throw");
    b.addEventListener("click", () => this.step(null));
    sheet.append(b);
  }

  renderLabyrinth(sheet, c) {
    const { w, h, cells } = c.maze;
    sheet.insertAdjacentHTML("beforeend",
      `<h2 class="curse">${esc(t("curse.labyrinth.name"))}</h2>` +
      `<p>${t("ch.maze.body", {
         per: c.minutesPerStep, n: c.steps,
         lost: formatDuration(c.steps * c.minutesPerStep) })}</p>`);
    const grid = document.createElement("div");
    grid.className = "maze";
    grid.style.gridTemplateColumns = `repeat(${w}, 30px)`;
    for (let i = 0; i < w * h; i++) {
      const cell = document.createElement("div");
      // A wall exists on each side the carver did not open.
      if (!(cells[i] & 1)) cell.classList.add("n");
      if (!(cells[i] & 2)) cell.classList.add("e");
      if (!(cells[i] & 4)) cell.classList.add("s");
      if (!(cells[i] & 8)) cell.classList.add("w");
      if (i === w * h - 1) cell.classList.add("goal");
      if (i === c.at) cell.classList.add("you");
      grid.append(cell);
    }
    sheet.append(grid);
    if (!this.mazeKeys) {
      this.mazeKeys = (ev) => {
        if (!this.state.challenge || this.state.challenge.type !== "labyrinth") return;
        const map = { ArrowUp: "N", ArrowRight: "E", ArrowDown: "S", ArrowLeft: "W" };
        if (map[ev.key]) { ev.preventDefault(); this.step(map[ev.key]); }
      };
      addEventListener("keydown", this.mazeKeys);
    }
  }

  /** The numbers a round ends on, shared by both result sheets.
   *
   *  Two of them with the deck out of play: with no cards there are no time
   *  bonuses, so the clock and the score are the same number, and printing it
   *  twice with a "+0m" between them says nothing. */
  scoreRow({ elapsed, bonus, total }) {
    const cell = (value, label, lead) =>
      `<div><b style="font-size:26px;font-family:var(--mono)` +
      (lead ? ";color:var(--candidate)" : "") + `">${esc(value)}</b>` +
      `<div style="color:var(--dim);font-size:11px">${esc(label)}</div></div>`;
    if (!this.state.cards) {
      return `<div class="row" style="gap:22px;margin-bottom:16px">` +
        cell(formatDuration(total), t("res.totalNoCards"), true) + `</div>`;
    }
    return `<div class="row" style="gap:22px;margin-bottom:16px">` +
      cell(formatDuration(elapsed), t("res.clock")) +
      cell(`+${bonus}m`, t("res.bonus")) +
      cell(formatDuration(total), t("res.total"), true) + `</div>`;
  }

  showResult() {
    if (this.shownResult) return;
    this.shownResult = true;
    const s = this.state;
    const score = finalScore(s);
    if (this.match) return this.showMatchResult(score);
    this.openModal((sheet) => {
      sheet.innerHTML =
        `<h2>${esc(t("res.foundAt", { name: s.hider.committed.name }))}</h2>` +
        `<p>${[s.hider.committed.district, s.hider.committed.municipality]
               .filter(Boolean).map(esc).join(" · ")}</p>` +
        this.scoreRow(score) +
        `<p>${esc(t("res.stats", {
           q: [...s.asked.values()].reduce((a, b) => a + b, 0), s: s.checked.size }))}</p>`;
      const again = document.createElement("button");
      again.className = "btn";
      again.textContent = t("res.new");
      again.addEventListener("click", () => location.reload());
      const close = document.createElement("button");
      close.className = "btn ghost";
      close.textContent = t("res.look");
      close.addEventListener("click", () => this.closeModal());
      const row = document.createElement("div");
      row.className = "row";
      row.append(again, close);
      sheet.append(row);
    });
  }

  /**
   * The end of a round inside a match: what it scored, where everyone stands,
   * and the handover to the next one.
   *
   * The standings are stated with the caveat attached, because a comparison
   * after an odd number of rounds is not a comparison -- one player has hidden
   * once more than the other, and saying who is "ahead" then is nonsense.
   */
  showMatchResult(score) {
    const s = this.state, m = this.match;
    const found = s.hider.committed;
    const used = s.hider.travelMinutes();
    this.openModal((sheet) => {
      sheet.innerHTML =
        `<h2>${esc(t("res.matchTitle", {
           seeker: m.seekerName, hider: m.hiderName, name: found.name }))}</h2>` +
        `<p>${[found.district, found.municipality].filter(Boolean).map(esc).join(" · ")}` +
        (used != null
          ? esc(t("res.matchSpent", {
              used: formatDuration(used), window: formatDuration(s.hiding.minutes) }))
          : "") + `</p>` +
        this.scoreRow(score) +
        `<div class="standings">` +
        m.names.map((n, i) =>
          `<div class="srow${m.leader === n ? " lead" : ""}">` +
          `<span class="who">${esc(n)}<span style="color:var(--dim);font-weight:400"> · ` +
          `${esc(t("res.rounds", { n: m.hidesEach[i] }))}</span></span>` +
          `<b>${formatDuration(m.totals[i])}</b></div>`).join("") +
        `<div class="note">` +
        esc(m.level
          ? (m.leader ? t("res.ahead", { name: m.leader }) : t("res.level"))
          : t("res.unfair", { name: m.nextHiderName })) +
        `</div></div>` +
        `<p>${esc(t("res.nextStarts", { n: m.round + 1, name: found.name }))}</p>`;
      const next = document.createElement("button");
      next.className = "btn";
      next.textContent = t("res.next", { name: m.nextHiderName, n: m.round + 1 });
      next.addEventListener("click", () => { this.closeModal(); this.on.nextRound(); });
      const close = document.createElement("button");
      close.className = "btn ghost";
      close.textContent = t("res.look");
      close.addEventListener("click", () => this.closeModal());
      const row = document.createElement("div");
      row.className = "row";
      row.append(next, close);
      sheet.append(row);
    });
  }
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
