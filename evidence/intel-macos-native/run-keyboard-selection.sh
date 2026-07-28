#!/bin/sh
set -eu

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: run-keyboard-selection.sh <target accessible name fragment> <enter|space> [max tabs]" >&2
  exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=$1
ACTIVATION=$2
MAX_TABS=${3:-80}

case "$ACTIVATION" in
  enter|space) ;;
  *) echo "Activation must be enter or space." >&2; exit 2 ;;
esac

case "$MAX_TABS" in
  ''|*[!0-9]*) echo "max tabs must be a positive integer." >&2; exit 2 ;;
esac
if [ "$MAX_TABS" -lt 1 ]; then
  echo "max tabs must be a positive integer." >&2
  exit 2
fi

echo "startedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "inputPolicy=Tab,Shift+Tab,Space,Enter"
echo "pointerOrAXPressAllowed=false"
osascript "$SCRIPT_DIR/keyboard-select.applescript" "$TARGET" "$ACTIVATION" "$MAX_TABS"
echo "finishedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
