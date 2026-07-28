#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: capture-chatgpt-window.sh <output.png>" >&2
  exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUTPUT=$1
case "$OUTPUT" in
  *.png) ;;
  *) echo "The output path must end in .png." >&2; exit 2 ;;
esac
OUTPUT_PARENT=$(dirname -- "$OUTPUT")
if [ ! -d "$OUTPUT_PARENT" ]; then
  echo "The output parent directory does not exist." >&2
  exit 2
fi

CURRENT_UID=$(id -u)
JOB_LABEL=$(launchctl print "gui/$CURRENT_UID" 2>/dev/null | awk '$3 ~ /^application\.com\.openai\.codex\./ { print $3; exit }')
CHATGPT_PID=""
if [ -n "$JOB_LABEL" ]; then
  JOB_RECORD=$(launchctl print "gui/$CURRENT_UID/$JOB_LABEL" 2>/dev/null || true)
  CHATGPT_PID=$(printf '%s\n' "$JOB_RECORD" | awk -F '= ' '/^[[:space:]]*pid = / { print $2; exit }')
fi
if ! printf '%s' "$CHATGPT_PID" | grep -Eq '^[0-9]+$'; then
  CHATGPT_PID=$(osascript -e 'tell application "System Events" to get unix id of first process whose bundle identifier is "com.openai.codex"' 2>/dev/null || true)
fi
if ! printf '%s' "$CHATGPT_PID" | grep -Eq '^[0-9]+$'; then
  echo "A running ChatGPT process was not found." >&2
  exit 1
fi

PROBE_DIRECTORY=$(mktemp -d "${TMPDIR:-/tmp}/lbs-window-id.XXXXXX")
trap 'rm -rf "$PROBE_DIRECTORY"' EXIT HUP INT TERM
cc -std=c11 -Wall -Wextra -Werror \
  -framework CoreGraphics -framework CoreFoundation \
  "$SCRIPT_DIR/front-window-id.c" -o "$PROBE_DIRECTORY/front-window-id"
WINDOW_ID=$($PROBE_DIRECTORY/front-window-id "$CHATGPT_PID")

screencapture -x -l "$WINDOW_ID" "$OUTPUT"
if [ ! -s "$OUTPUT" ]; then
  echo "Screen capture failed; confirm Screen Recording permission for the executing host." >&2
  exit 1
fi

echo "observedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "chatgptPid=$CHATGPT_PID"
echo "windowId=$WINDOW_ID"
echo "sha256=$(shasum -a 256 "$OUTPUT" | awk '{ print $1 }')"
