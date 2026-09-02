#!/usr/bin/env bash
# Serve the game and print the address. No build step, no dependencies.
set -eu
cd "$(dirname "$0")"
PORT=${PORT:-8080}
echo "Hide + Seek running at http://localhost:$PORT/  (ctrl-c to stop)"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
