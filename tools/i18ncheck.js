// The dictionary against the code, both ways.
//
// Missing text is the failure mode this whole file exists for, and it is a
// quiet one: `t()` falls back to the other language and then to the key
// itself, so a typo ships as an English sentence in a Czech round, or as
// `res.matchTitle` sitting in a result sheet. Neither throws, and neither
// shows up in a test that drives the UI by clicking buttons.
//
// So: every key one language has, the other must have. Every key the code
// asks for must exist. Every key the dictionary holds must be asked for
// somewhere -- that last one is what catches a string left behind after the
// screen it belonged to was rewritten.
//
// Keys built at run time (`t(`poi.${cat}.one`)`) are matched as patterns, so
// a template in the code covers every key it could produce.

import { readFileSync, readdirSync } from "node:fs";
import { dictionary } from "../js/i18n.js";

const files = [
  ...readdirSync("js").filter((f) => f.endsWith(".js")).map((f) => `js/${f}`),
  "index.html",
];

const literal = new Set();
const patterns = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  // t("key") and t('key')
  for (const m of src.matchAll(/\bt\(\s*["']([\w.\-]+)["']/g)) literal.add(m[1]);
  // data-i18n="key", data-i18n-html="key", data-i18n-ph="key"
  for (const m of src.matchAll(/data-i18n(?:-html|-ph)?="([\w.\-]+)"/g)) literal.add(m[1]);
  // t(`prefix.${expr}.suffix`) -- every key the template could produce.
  // Split on the interpolations first and escape only what is left, or the
  // escaping turns "${cat}" into a literal and the pattern matches nothing.
  for (const m of src.matchAll(/\bt\(\s*`([^`]+)`/g)) {
    const body = m[1];
    if (!body.includes("${")) { literal.add(body); continue; }
    const escaped = body.split(/\$\{[^}]*\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\w.-]+");
    patterns.push(new RegExp("^" + escaped + "$"));
  }
}

const used = (key) => literal.has(key) || patterns.some((re) => re.test(key));

const cs = Object.keys(dictionary.cs);
const en = Object.keys(dictionary.en);
const problems = [];

for (const k of cs) if (!(k in dictionary.en)) problems.push(`only in cs: ${k}`);
for (const k of en) if (!(k in dictionary.cs)) problems.push(`only in en: ${k}`);
for (const k of literal) if (!(k in dictionary.cs)) problems.push(`used, not translated: ${k}`);
for (const k of cs) if (!used(k)) problems.push(`translated, never used: ${k}`);

// A value the other language forgot is the same bug one level down: "{name}"
// left unfilled prints the braces at the player.
//
// Only values -- `{name}` -- are compared, never the `{name:a|b|c}` choosers.
// Those legitimately differ: Czech agrees "the same one" with the gender of
// the noun and English does not, so `{g:...}` appears on one side only, by
// design rather than by omission.
const valueSlots = (s) => new Set(
  [...s.matchAll(/\{(\w+)(?::([^}]*))?\}/g)].filter((m) => m[2] == null).map((m) => m[1]));
for (const k of cs) {
  if (!(k in dictionary.en)) continue;
  const a = valueSlots(dictionary.cs[k]);
  const b = valueSlots(dictionary.en[k]);
  for (const name of a) if (!b.has(name)) problems.push(`{${name}} missing from en: ${k}`);
  for (const name of b) if (!a.has(name)) problems.push(`{${name}} missing from cs: ${k}`);
}

console.log(`${cs.length} keys, ${literal.size} literal uses, ${patterns.length} patterns`);
if (problems.length) {
  for (const p of problems) console.log("FAIL: " + p);
  console.log(`RESULT: FAIL (${problems.length})`);
  process.exit(1);
}
console.log("RESULT: PASS");
