#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_BUNDLE=${1:-/Applications/ChatGPT.app}
INFO_PLIST="$APP_BUNDLE/Contents/Info.plist"

if [ ! -f "$INFO_PLIST" ]; then
  echo "ChatGPT Info.plist was not found at the supplied app bundle." >&2
  exit 1
fi

EXECUTABLE_NAME=$(plutil -extract CFBundleExecutable raw "$INFO_PLIST")
EXECUTABLE_PATH="$APP_BUNDLE/Contents/MacOS/$EXECUTABLE_NAME"
if [ ! -f "$EXECUTABLE_PATH" ]; then
  echo "ChatGPT main executable was not found." >&2
  exit 1
fi

HOST_ARCH=$(uname -m)
case "$HOST_ARCH" in
  x86_64|arm64) ;;
  *) echo "Unsupported macOS host architecture: $HOST_ARCH" >&2; exit 1 ;;
esac

MACOS_VERSION=$(sw_vers -productVersion)
MACOS_BUILD=$(sw_vers -buildVersion)
MODEL_NAME=$(system_profiler SPHardwareDataType -detailLevel mini 2>/dev/null | awk -F ': ' '/Model Name:/ { print $2; exit }')
MODEL_IDENTIFIER=$(system_profiler SPHardwareDataType -detailLevel mini 2>/dev/null | awk -F ': ' '/Model Identifier:/ { print $2; exit }')
PROCESSOR=$(system_profiler SPHardwareDataType -detailLevel mini 2>/dev/null | awk -F ': ' '/Processor Name:|Chip:/ { print $2; exit }')
MEMORY_TEXT=$(system_profiler SPHardwareDataType -detailLevel mini 2>/dev/null | awk -F ': ' '/Memory:/ { print $2; exit }')
APP_VERSION=$(plutil -extract CFBundleShortVersionString raw "$INFO_PLIST")
APP_BUILD=$(plutil -extract CFBundleVersion raw "$INFO_PLIST")
BUNDLE_ID=$(plutil -extract CFBundleIdentifier raw "$INFO_PLIST")
REQUIRES_NATIVE=$(plutil -extract LSRequiresNativeExecution raw "$INFO_PLIST" 2>/dev/null || printf 'false')
EXECUTABLE_ARCHS=$(lipo -archs "$EXECUTABLE_PATH")
EXECUTABLE_SHA=$(shasum -a 256 "$EXECUTABLE_PATH" | awk '{ print $1 }')
CODE_DIRECTORY_HASH=$(codesign -d --verbose=4 "$APP_BUNDLE" 2>&1 | awk -F= '/^CDHash=/ { print $2; exit }')

CURRENT_UID=$(id -u)
JOB_LABEL=$(launchctl print "gui/$CURRENT_UID" 2>/dev/null | awk '$3 ~ /^application\.com\.openai\.codex\./ { print $3; exit }')
RUNNING_PID=""
if [ -n "$JOB_LABEL" ]; then
  JOB_RECORD=$(launchctl print "gui/$CURRENT_UID/$JOB_LABEL" 2>/dev/null || true)
  RUNNING_PID=$(printf '%s\n' "$JOB_RECORD" | awk -F '= ' '/^[[:space:]]*pid = / { print $2; exit }')
fi
if ! printf '%s' "$RUNNING_PID" | grep -Eq '^[0-9]+$'; then
  RUNNING_PID=$(osascript -e 'tell application "System Events" to get unix id of first process whose bundle identifier is "com.openai.codex"' 2>/dev/null || true)
fi

PROCESS_RECORD=""
PROCESS_PROBE_ATTEMPTED=false
if printf '%s' "$RUNNING_PID" | grep -Eq '^[0-9]+$'; then
  PROCESS_PROBE_ATTEMPTED=true
  PROBE_DIRECTORY=$(mktemp -d "${TMPDIR:-/tmp}/lbs-process-arch.XXXXXX")
  trap 'rm -rf "$PROBE_DIRECTORY"' EXIT HUP INT TERM
  if cc -std=c11 -Wall -Wextra -Werror "$SCRIPT_DIR/process-architecture.c" -o "$PROBE_DIRECTORY/process-architecture" >/dev/null 2>&1; then
    PROCESS_RECORD=$("$PROBE_DIRECTORY/process-architecture" "$RUNNING_PID" 2>/dev/null || true)
  fi
fi

OBSERVED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

node - \
  "$HOST_ARCH" "$MACOS_VERSION" "$MACOS_BUILD" "$MODEL_NAME" \
  "$MODEL_IDENTIFIER" "$PROCESSOR" "$MEMORY_TEXT" "$BUNDLE_ID" "$APP_VERSION" \
  "$APP_BUILD" "$REQUIRES_NATIVE" "$EXECUTABLE_ARCHS" \
  "$EXECUTABLE_SHA" "$CODE_DIRECTORY_HASH" "$EXECUTABLE_PATH" \
  "$RUNNING_PID" "$PROCESS_RECORD" "$PROCESS_PROBE_ATTEMPTED" "$OBSERVED_AT" <<'NODE'
const [
  architecture,
  macOSVersion,
  macOSBuild,
  modelName,
  modelIdentifier,
  processor,
  memoryText,
  bundleIdentifier,
  version,
  build,
  requiresNativeExecution,
  executableArchitectures,
  mainExecutableSha256,
  codeDirectoryHash,
  expectedExecutablePath,
  observedRunningPid,
  processRecordText,
  processProbeAttempted,
  observedAt,
] = process.argv.slice(2);

const architectures = executableArchitectures.split(/\s+/).filter(Boolean);
const mainExecutableArchitecture = architectures.length > 1 ? "universal" : architectures[0];
const runningPid = /^\d+$/.test(observedRunningPid) ? Number(observedRunningPid) : null;
let processRecord = null;
try {
  processRecord = processRecordText ? JSON.parse(processRecordText) : null;
} catch {
  processRecord = null;
}
const runningProgram = processRecord?.executablePath ?? null;
const runningProcessArchitecture = processRecord?.architecture ?? null;
const runningProcessArchitectureMethod = processRecord?.method ?? null;
const translated = architecture === "arm64" && runningProcessArchitecture === "x86_64";
const runningProcessArchitectureStatus = !runningPid
  ? "not_run"
  : !processRecord
    ? "partial"
    : runningProgram !== expectedExecutablePath
      ? "fail"
      : runningProcessArchitecture !== architecture || translated
        ? "fail"
        : "pass";
const gate = architecture === "x86_64"
  ? "native-macos-intel"
  : "native-macos-apple-silicon";
const memoryMatch = memoryText.match(/^(\d+)\s*GB$/i);

const output = {
  schemaVersion: 1,
  gate,
  status: "partial",
  architecture,
  translated,
  macOS: { version: macOSVersion, build: macOSBuild },
  hardware: {
    modelName,
    modelIdentifier,
    processor,
    ...(memoryMatch ? { memoryGB: Number(memoryMatch[1]) } : {}),
  },
  chatgptDesktop: {
    bundleIdentifier,
    version,
    build,
    surface: "Codex",
    mainExecutableArchitecture,
    mainExecutableSha256,
    codeDirectoryHash: codeDirectoryHash || null,
    requiresNativeExecution: ["true", "1", "yes"].includes(requiresNativeExecution.toLowerCase()),
    runningProgram,
    runningPid,
    runningProcessArchitecture,
    runningProcessArchitectureMethod,
    runningProcessArchitectureStatus,
  },
  plugin: {
    version: null,
    archiveSha256: null,
    contentDigest: null,
    installed: false,
    marketplace: null,
  },
  modelObserved: null,
  runId: null,
  artifactSha256: null,
  journeyIdentities: {
    explicitDiscovery: null,
    implicitDiscovery: null,
    interrupted: null,
    resumed: null,
    restarted: null,
  },
  keyboardSelection: null,
  checks: [
    {
      id: "MAC-001",
      status: runningProcessArchitectureStatus,
      executed: runningProcessArchitectureStatus !== "not_run",
      summary: runningProcessArchitectureStatus === "pass"
        ? `The live ChatGPT PID reports ${runningProcessArchitecture} through proc_pidinfo(PROC_PIDARCHINFO), matching the ${architecture} host.`
        : "The host and bundle were inspected, but a matching live-process CPU type was not proved.",
      evidenceRefs: ["capture-host.sh standard output"],
    },
    {
      id: "MAC-002",
      status: "partial",
      executed: true,
      summary: "Host and ChatGPT identity are recorded; candidate, model, and native journey identities remain open.",
      evidenceRefs: ["capture-host.sh standard output"],
    },
    {
      id: "MAC-003",
      status: "not_run",
      executed: false,
      summary: "Exact-candidate installation and fresh-task discovery have not been executed by this capture.",
      evidenceRefs: [],
    },
    {
      id: "MAC-004",
      status: "not_run",
      executed: false,
      summary: "The representative interrupt, remediation, and completion journey has not been executed by this capture.",
      evidenceRefs: [],
    },
    {
      id: "MAC-005",
      status: "not_run",
      executed: false,
      summary: "Inline widget, keyboard, accessibility, degraded-state, and reconciliation checks have not been executed by this capture.",
      evidenceRefs: [],
    },
    {
      id: "MAC-006",
      status: "partial",
      executed: true,
      summary: "A secret-safe environment record exists; journey attachments and final validation remain open.",
      evidenceRefs: ["capture-host.sh standard output"],
    },
  ],
  attachments: [],
  observedAt,
  tester: "capture-host.sh read-only discovery",
  limitations: [
    "This capture does not install or invoke the plugin.",
    ...(processRecord ? [] : [
      processProbeAttempted === "true"
        ? "A running ChatGPT PID was found, but the live proc_pidinfo architecture probe did not complete."
        : "No running ChatGPT PID was observed.",
    ]),
  ],
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
NODE
