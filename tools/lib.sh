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

browse() {   # browse <url-path> [extra chromium args...]
  local path="$1"; shift
  chromium-browser --headless --no-sandbox --disable-gpu \
    --user-data-dir="$PROFILE" --disk-cache-size=1 --hide-scrollbars \
    "$@" "http://127.0.0.1:$PORT/$path" 2>&1
}

# Strip the tags off the <pre>/<div> the test pages write their report into.
report() { sed -n "/<$1 id=\"out\">/,/<\/$1>/p" | sed 's/<[^>]*>//g'; }
