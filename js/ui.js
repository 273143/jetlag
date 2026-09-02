// Rendering and input. Holds no game rules; it reads state and calls game.js.

import { CATEGORIES } from "./questions.js";
import { RULES } from "./rules.js";
import { formatDuration, formatClock } from "./geo.js";
import { makePhoto } from "./map.js";
import { askBlocker, travelBlocker, repeatMultiplier, finalScore, seeker, board, directRide, nextHop } from "./game.js";

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
      ? `Round ${match.round} · ${match.seekerName} seeking ${match.hiderName} · ` +
        `${formatDuration(state.hiding.minutes)} head start`
      : `${state.world.name} · ${state.difficulty} hider · ` +
        `${formatDuration(state.hiding.minutes)} head start · seed ${state.seed}`;
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
    for (const [id, name] of [["ask", "Ask"], ["log", "Answers"]]) {
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
    for (const c of CATEGORIES) {
      const b = document.createElement("button");
      b.textContent = c.name;
      b.dataset.cat = c.id;
      b.addEventListener("click", () => { this.cat = c.id; this.refresh(); });
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
      `You are at <b>${esc(me.name)}</b>` +
      (lines.length ? ` <span class="lines">${lines.map((l) => `<i>${esc(l)}</i>`).join("")}</span>` : "") +
      `<br>${[me.district, me.municipality, `${Math.round(me.ele)} m`].filter(Boolean).map(esc).join(" · ")}` +
      ` · local time ${formatClock(RULES.startClock + s.clock)}`;
    if (board(s)) {
      const b = document.createElement("button");
      b.className = "departures";
      b.textContent = "Departures";
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
      out.push(`Thermometer running: travel ${s.pendingThermo.km} km from ${esc(from.name)} to read it.`);
    }
    if (e.jammedDoors > 0) out.push(`The Jammed Door: ${e.jammedDoors} more station(s) to force open.`);
    if (e.slowLegs > 0) out.push(`The Gambler's Feet: next ${e.slowLegs} journey(s) 50% longer.`);
    if (e.longWay > 0) out.push(`The Right Turn: next journey 40% longer.`);
    if (e.forcedReturn != null) out.push(`The U-Turn: go back to ${esc(s.world.byId.get(e.forcedReturn).name)}.`);
    if (e.mustVisit != null) out.push(`Travel agent: visit ${esc(s.world.byId.get(e.mustVisit).name)} before asking again.`);
    if (e.noRepeatAsk) out.push(`The Urban Explorer: never two questions from one station.`);
    if (e.blockedCategory) out.push(`Spotty Memory: no ${e.blockedCategory.cat} questions for ${e.blockedCategory.questions} more.`);
    if (e.chalice > 0) out.push(`The Overflowing Chalice: hider draws extra ${e.chalice} more time(s).`);
    if (s.bannedQuestions.size) out.push(`The Drained Brain: ${s.bannedQuestions.size} question(s) wiped for good.`);
    $("effects").innerHTML = out.map((t) => `<div class="effect">${t}</div>`).join("");
  }

  renderQuestions() {
    const s = this.state;
    const box = $("questions");
    box.innerHTML = "";
    for (const b of $("cats").children) b.setAttribute("aria-selected", String(b.dataset.cat === this.cat));

    const meta = CATEGORIES.find((c) => c.id === this.cat);
    const blurb = document.createElement("div");
    blurb.className = "qblurb";
    const { draw, keep } = RULES.draw[this.cat];
    blurb.textContent = `${meta.blurb} Costs you ${RULES.askMinutes[this.cat]} min; the hider draws ${draw}, keeps ${keep}.`;
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
        (times ? `<span class="rep">&times;${times + 1} cost</span>` : "") +
        `<span class="cost">${RULES.askMinutes[q.cat]}m</span>`;
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
          `<summary>${list.length} possible answer${list.length === 1 ? "" : "s"}</summary>` +
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
      const t = `<span class="t">${formatDuration(e.clock)}</span>`;
      if (e.who === "curse") {
        div.innerHTML = `${t}<b>${esc(e.text.split(" — ")[0])}</b>` +
          `<span class="fx">${esc(e.text.split(" — ")[1] ?? "")} ${esc(e.effect ?? "")}</span>`;
      } else {
        div.innerHTML = t + esc(e.text) +
          (e.context ? `<span class="ctx">(${esc(e.context)})</span>` : "") +
          (e.cut > 0 ? `<span class="cut">${e.cut} station(s) ruled out</span>` : "");
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

  /** Popup shown when a station on the map is clicked. */
  stationPopup(station) {
    const s = this.state;
    const minutes = s.travel.minutes[station.id];
    const blocker = travelBlocker(s, station.id);
    const alive = s.candidates.some((c) => c.id === station.id);
    const el = document.createElement("div");
    const lines = s.world.lineNames(station.lines ?? []);
    el.innerHTML =
      `<b>${esc(station.name)}</b>` +
      (lines.length ? `<div class="lines">${lines.map((l) => `<i>${esc(l)}</i>`).join("")}</div>` : "") +
      `<div class="meta">${[station.district, `${Math.round(station.ele)} m`].filter(Boolean).map(esc).join(" · ")}` +
      ` · ${alive ? "still possible" : s.checked.has(station.id) ? "searched" : "ruled out"}</div>`;
    const btn = document.createElement("button");
    btn.className = "travel";
    const direct = station.id === s.seekerId ? null : directRide(s, station.id);
    // Somewhere no single line reaches is still somewhere you can set off
    // for: the button becomes the first leg, and the popup says how much of
    // the journey that is.
    const hopId = blocker && !direct ? nextHop(s, station.id) : null;
    const hop = hopId != null && hopId !== station.id ? s.world.byId.get(hopId) : null;
    const hopRide = hop ? directRide(s, hop.id) : null;

    btn.textContent = station.id === s.seekerId
      // You can be standing on a live candidate again after the hider plays
      // Move; searching where you stand costs the search time, not a journey.
      ? `Search here — ${formatDuration(RULES.searchMinutes)}`
      : direct
        ? `${direct.entry.walk ? "Walk" : `Ride ${direct.entry.ref}`} here — ${formatDuration(direct.cost.minutes)}`
        : hop && hopRide
          ? `First leg: ${hopRide.entry.walk ? "walk" : hopRide.entry.ref} to ${hop.name} — ${formatDuration(hopRide.cost.minutes)}`
          : isFinite(minutes)
            ? `Travel here — ${formatDuration(minutes)}`
            : "Unreachable";
    if (hop && hopRide) {
      el.querySelector(".meta").insertAdjacentHTML("afterend",
        `<div class="meta">${formatDuration(minutes)} away in ` +
        `${(s.travel.legs?.(station.id) ?? []).length} leg(s)</div>`);
      btn.disabled = false;
      btn.addEventListener("click", () => this.on.travel(hop));
    } else {
      if (blocker) { btn.disabled = true; btn.title = blocker; }
      btn.addEventListener("click", () => this.on.travel(station));
    }
    el.append(btn);
    return el;
  }

  /**
   * The departure board at the seeker's stop.
   *
   * One panel per line and direction: where it is heading, when the next
   * three leave, and every stop it serves from here with the time on board
   * and the clock time you would arrive. Choosing a stop is choosing a
   * journey, so it asks to confirm before the clock moves.
   */
  showBoard() {
    const s = this.state;
    const entries = board(s);
    if (!entries) return;
    const me = seeker(s);
    const clockAt = (m) => formatClock(RULES.startClock + m);

    this.openModal((sheet) => {
      sheet.innerHTML =
        `<h2>Departures — ${esc(me.name)}</h2>` +
        `<p class="sheetnote">${clockAt(s.clock)}. One ride, one line: to reach ` +
        `anywhere else, get off at an interchange and board again.</p>`;

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
        sec.innerHTML = e.walk
          ? `<summary><span class="mode walk">on foot</span> ${e.stops.length} stop(s) you can walk to` +
            (live ? `<b>${live} still possible</b>` : "") + `</summary>`
          : `<summary><span class="mode ${e.mode}">${esc(e.mode)} ${esc(e.ref)}</span>` +
            `<span class="tw">towards ${esc(e.towards)}</span>` +
            `<span class="next">${e.departures.map(clockAt).join(" · ")}</span>` +
            (e.reversed ? `<i>return working</i>` : "") +
            (live ? `<b>${live} still possible</b>` : "") + `</summary>`;

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
          row.addEventListener("click", () => {
            this.confirmRide(e, stop, st, cost);
          });
          list.append(row);
        }
        sec.append(list);
        sec.open = worth || entries.length <= 4;
        sheet.append(sec);
      }

      const close = document.createElement("button");
      close.className = "btn";
      close.textContent = "Stay here";
      close.addEventListener("click", () => this.closeModal());
      sheet.append(close);
    });
  }

  /** Confirm one ride before it costs anything. */
  confirmRide(entry, stop, station, cost) {
    const s = this.state;
    const clockAt = (m) => formatClock(RULES.startClock + m);
    this.openModal((sheet) => {
      sheet.innerHTML =
        `<h2>${esc(station.name)}</h2>` +
        `<div class="ticket">` +
        (entry.walk
          ? `<div><b>On foot</b> from ${esc(seeker(s).name)}</div>`
          : `<div><b>${esc(entry.mode)} ${esc(entry.ref)}</b> towards ${esc(entry.towards)}</div>` +
            `<div>Departs ${clockAt(entry.departures[0])}` +
            (cost.wait > 0 ? ` — ${formatDuration(cost.wait)} waiting` : " — straight on") + `</div>`) +
        `<div>${formatDuration(cost.onboard)} on board</div>` +
        `<div class="total">Arrive ${clockAt(s.clock + cost.minutes)} — costs you ${formatDuration(cost.minutes)}</div>` +
        `</div>`;
      const go = document.createElement("button");
      go.className = "btn go";
      go.textContent = "Confirm journey";
      go.addEventListener("click", () => { this.closeModal(); this.on.travel(station); });
      const back = document.createElement("button");
      back.className = "btn";
      back.textContent = "Back to the board";
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
      `<h2 class="curse">The Hidden Hangman</h2>
       <p>Guess the five-letter word. Every wrong letter costs you 8 minutes.
          So far: <b>${c.wrong}</b> wrong, <b>${c.wrong * c.minutesPerMiss} min</b> lost.</p>
       <div class="word">${shown}</div>`);
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
      `<h2 class="curse">The Endless Tumble</h2>
       <p>Roll the die down the hill until it lands on a 5 or a 6.
          Every throw costs you 5 minutes. So far: <b>${c.rolls.length}</b> throws,
          <b>${c.rolls.length * c.minutesPerRoll} min</b> lost.</p>
       <div class="dice">${last ? "⚀⚁⚂⚃⚄⚅"[last - 1] : "·"}</div>`);
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = c.rolls.length ? "Throw again" : "Throw the die";
    b.addEventListener("click", () => this.step(null));
    sheet.append(b);
  }

  renderLabyrinth(sheet, c) {
    const { w, h, cells } = c.maze;
    sheet.insertAdjacentHTML("beforeend",
      `<h2 class="curse">The Labyrinth</h2>
       <p>Walk from the top-left to the bottom-right with the arrow keys.
          Every step costs you 2 minutes. So far: <b>${c.steps}</b> steps,
          <b>${c.steps * c.minutesPerStep} min</b> lost.</p>`);
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

  /** The three numbers a round ends on, shared by both result sheets. */
  scoreRow({ elapsed, bonus, total }) {
    return `<div class="row" style="gap:22px;margin-bottom:16px">
           <div><b style="font-size:26px;font-family:var(--mono)">${formatDuration(elapsed)}</b>
                <div style="color:var(--dim);font-size:11px">on the clock</div></div>
           <div><b style="font-size:26px;font-family:var(--mono)">+${bonus}m</b>
                <div style="color:var(--dim);font-size:11px">time-bonus cards held</div></div>
           <div><b style="font-size:26px;font-family:var(--mono);color:var(--candidate)">${formatDuration(total)}</b>
                <div style="color:var(--dim);font-size:11px">the hider's score</div></div>
         </div>`;
  }

  showResult() {
    if (this.shownResult) return;
    this.shownResult = true;
    const s = this.state;
    const score = finalScore(s);
    if (this.match) return this.showMatchResult(score);
    this.openModal((sheet) => {
      sheet.innerHTML =
        `<h2>Found them at ${esc(s.hider.committed.name)}</h2>
         <p>${esc(s.hider.committed.district ?? "")} · ${esc(s.hider.committed.municipality ?? "")}</p>` +
        this.scoreRow(score) +
        `<p>You asked ${[...s.asked.values()].reduce((a, b) => a + b, 0)} question(s)
            and searched ${s.checked.size} station(s).</p>`;
      const again = document.createElement("button");
      again.className = "btn";
      again.textContent = "New run";
      again.addEventListener("click", () => location.reload());
      const close = document.createElement("button");
      close.className = "btn ghost";
      close.textContent = "Look at the map";
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
        `<h2>${esc(m.seekerName)} found ${esc(m.hiderName)} at ${esc(found.name)}</h2>
         <p>${[found.district, found.municipality].filter(Boolean).map(esc).join(" · ")}` +
        (used != null
          ? ` — ${formatDuration(used)} of a ${formatDuration(s.hiding.minutes)} head start spent getting there.`
          : "") + `</p>` +
        this.scoreRow(score) +
        `<div class="standings">` +
        m.names.map((n, i) => {
          const hides = m.hidesEach[i];
          return `<div class="srow${m.leader === n ? " lead" : ""}">` +
            `<span class="who">${esc(n)}<span style="color:var(--dim);font-weight:400"> · ` +
            `${hides} round${hides === 1 ? "" : "s"} hidden</span></span>` +
            `<b>${formatDuration(m.totals[i])}</b></div>`;
        }).join("") +
        `<div class="note">` +
        (m.level
          ? m.leader ? `${esc(m.leader)} is ahead on time hidden.` : "Level on time hidden."
          : `${esc(m.nextHiderName)} has yet to hide this time round — play the next one to make it a fair comparison.`) +
        `</div></div>` +
        `<p>Round ${m.round + 1} starts here, at ${esc(found.name)}: whoever is found is
            found somewhere, and that is where the next one begins.</p>`;
      const next = document.createElement("button");
      next.className = "btn";
      next.textContent = `Pass to ${m.nextHiderName} — round ${m.round + 1}`;
      next.addEventListener("click", () => { this.closeModal(); this.on.nextRound(); });
      const close = document.createElement("button");
      close.className = "btn ghost";
      close.textContent = "Look at the map";
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
