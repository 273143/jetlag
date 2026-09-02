#!/usr/bin/env bash
# Screenshot a page, for eyeballing the UI without a display.
#   tools/shot.sh 'index.html?seed=42&go=1' [outfile.png]
set -u
cd "$(dirname "$0")/.."
. tools/lib.sh
PORT=8732
serve || exit 1
OUT=${2:-$PWD/.shots/shot.png}
mkdir -p "$(dirname "$OUT")"
browse "${1:-index.html}" --window-size=1500,950 --virtual-time-budget=25000 \
  --screenshot="$OUT" | grep -iE "uncaught|SyntaxError|TypeError" | head -5
echo "wrote $OUT"
