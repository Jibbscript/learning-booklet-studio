#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
PACKAGE_VERSION=$(node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(manifest.version);
' "$REPOSITORY_ROOT/package.json")
ARCHIVE_PATH=${1:-"$REPOSITORY_ROOT/dist/release/learning-booklet-studio-$PACKAGE_VERSION.tar.gz"}
MARKETPLACE_ROOT="$REPOSITORY_ROOT/test-results/native-macos-intel/marketplace"

if [ ! -f "$ARCHIVE_PATH" ]; then
  echo "Release archive not found: $ARCHIVE_PATH" >&2
  exit 1
fi

if [ -e "$MARKETPLACE_ROOT" ]; then
  echo "Marketplace destination already exists; remove it deliberately before creating a clean installation." >&2
  exit 1
fi

ARCHIVE_SHA=$(shasum -a 256 "$ARCHIVE_PATH" | awk '{ print $1 }')
ARCHIVE_ROOT=$(tar -tzf "$ARCHIVE_PATH" | awk -F / 'NF { print $1; exit }')
if [ -z "$ARCHIVE_ROOT" ]; then
  echo "Release archive has no top-level directory." >&2
  exit 1
fi

mkdir -p "$MARKETPLACE_ROOT/plugins"
tar -xzf "$ARCHIVE_PATH" -C "$MARKETPLACE_ROOT/plugins"
if [ "$ARCHIVE_ROOT" != "learning-booklet-studio" ]; then
  mv "$MARKETPLACE_ROOT/plugins/$ARCHIVE_ROOT" "$MARKETPLACE_ROOT/plugins/learning-booklet-studio"
fi
mkdir -p "$MARKETPLACE_ROOT/.agents/plugins"

node - "$MARKETPLACE_ROOT/.agents/plugins/marketplace.json" <<'NODE'
const fs = require("node:fs");
const outputPath = process.argv[2];
const manifest = {
  name: "learning-booklet-native-intel",
  interface: {
    displayName: "Learning Booklet Studio Native Intel Verification",
  },
  plugins: [
    {
      name: "learning-booklet-studio",
      source: { source: "local", path: "./plugins/learning-booklet-studio" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    },
  ],
};
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

echo "Prepared exact-candidate marketplace: $MARKETPLACE_ROOT"
echo "Candidate archive SHA-256: $ARCHIVE_SHA"
echo "Next, register the marketplace and install only after checking the printed digest."
