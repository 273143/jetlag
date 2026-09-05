#!/usr/bin/env bash
# UI test: drives the real interface through a whole run by clicking buttons.
set -u
cd "$(dirname "$0")/.."
. tools/lib.sh
PORT=8733
serve || exit 1
fail=0
run() {   # run <label> <page>
  echo "--- $1 ---"
  OUT=$(browse "$2" --window-size=1400,1200 --virtual-time-budget=90000 --dump-dom)
  echo "$OUT" | report div
  # Case-sensitive: Chromium prefixes real console errors this way, and a
  # loose match would hit the test page's own error-handling source.
  echo "$OUT" | grep -E "Uncaught [A-Za-z]*Error" | head -10
  echo "$OUT" | grep -q "<title>PASS</title>" || fail=1
}

for MAP in south-moravia brno; do
  run "$MAP" "tools/uitest.html?map=$MAP"
done
# The pure-deduction game: same run, no deck. Brno, because that is where the
# curses and the card counter are most visible.
run "no cards / brno" "tools/uitest.html?map=brno&cards=0"
# And once in English, so the other half of js/i18n.js is exercised in the
# real UI rather than only by the key check.
run "english / brno" "tools/uitest.html?map=brno&lang=en"
# The pass-and-play match: two people, one device, and a round that has to
# start where the last one finished.
for MAP in south-moravia brno; do
  run "two players / $MAP" "tools/2ptest.html?map=$MAP"
done
# The offline nag in front of the Start button. Skips its own assertions where
# the browser has no working Cache API -- see the note in the page.
run "offline nag" "tools/nagtest.html?map=brno"
# Phone-sized viewports. Everything above runs in a 1400x1200 window, where the
# start card fits and a bug that strands its button below the fold is invisible.
run "phone layout" "tools/phonetest.html"
[ $fail -eq 0 ] && echo "RESULT: PASS" || { echo "RESULT: FAIL"; exit 1; }
