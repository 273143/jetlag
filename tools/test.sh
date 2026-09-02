#!/usr/bin/env bash
# Engine self-test: plays automated runs and checks the game's invariants.
set -u
cd "$(dirname "$0")/.."
. tools/lib.sh
PORT=8731
serve || exit 1
OUT=$(browse "tools/selftest.html" --virtual-time-budget=120000 --dump-dom)
echo "$OUT" | report pre
# Case-sensitive: Chromium prefixes real console errors this way, and a
# loose match would hit the test page's own error-handling source.
echo "$OUT" | grep -E "Uncaught [A-Za-z]*Error" | head -10
echo "$OUT" | grep -q "<title>PASS</title>" && echo "RESULT: PASS" || { echo "RESULT: FAIL"; exit 1; }
