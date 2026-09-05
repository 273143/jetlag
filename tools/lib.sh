# Shared harness for the headless browser tools.
#
# Every run gets a throwaway Chromium profile. That is not hygiene theatre:
# with a shared profile the module cache served stale JavaScript, and a test
# run once passed against code that had been deleted.

serve() {
  PORT=${PORT:-8731}
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  SERVER=$!
  # Kept inside the project: the Chromium snap is confined and cannot write
  # to a hidden directory sitting directly in $HOME.
  mkdir -p .cache
  PROFILE=$(mktemp -d "$PWD/.cache/chrome-XXXXXX")
  trap 'kill $SERVER 2>/dev/null; rm -rf "$PROFILE"' EXIT
  for _ in $(seq 25); do
    curl -sf "http://127.0.0.1:$PORT/" >/dev/null && return 0
    sleep 0.3
  done
  echo "server did not come up on $PORT" >&2
  return 1
}

# Whichever name Chromium goes by here. The Ubuntu snap calls itself
# chromium-browser and Arch and the Chrome packages do not, so hardcoding one
# means the tests silently do not run on the other -- and a test suite that
# does not run looks exactly like a test suite that passes nothing.
CHROME=${CHROME:-}
if [ -z "$CHROME" ]; then
  for c in chromium-browser chromium google-chrome-stable google-chrome; do
    command -v "$c" >/dev/null 2>&1 && { CHROME=$c; break; }
  done
fi
if [ -z "$CHROME" ]; then
  echo "no chromium found -- install one, or set CHROME=/path/to/it" >&2
  exit 1
fi

browse() {   # browse <url-path> [extra chromium args...]
  local path="$1"; shift
  "$CHROME" --headless --no-sandbox --disable-gpu \
    --user-data-dir="$PROFILE" --disk-cache-size=1 --hide-scrollbars \
    "$@" "http://127.0.0.1:$PORT/$path" 2>&1
}

# Strip the tags off the <pre>/<div> the test pages write their report into.
report() { sed -n "/<$1 id=\"out\">/,/<\/$1>/p" | sed 's/<[^>]*>//g'; }
