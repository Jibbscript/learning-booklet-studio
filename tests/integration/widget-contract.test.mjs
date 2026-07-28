import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  normalizeRun,
  reconcileRunSnapshot,
} from "../../packages/widget/src/run-state.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("widget uses only the declared MCP Apps host bridge", () => {
  const host = read("packages/widget/src/mcp-host.js");
  const app = read("packages/widget/src/App.jsx");
  const source = `${host}\n${app}`;

  assert.match(host, /@modelcontextprotocol\/ext-apps\/app-with-deps/);
  assert.match(host, /new App\(/);
  assert.match(host, /callServerTool\(/);
  assert.match(host, /sendMessage\(/);
  assert.match(host, /requestDisplayMode\(/);
  assert.match(app, /callTool\("workflow_get"/);
  assert.match(app, /callTool\("workflow_submit_decision"/);
  assert.match(app, /model-visible follow-up/);

  for (const prohibited of [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/,
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
    /child_process/,
    /\bexecFile?\s*\(/,
  ]) {
    assert.doesNotMatch(source, prohibited);
  }
});

test("widget declares the complete ordered workflow and three design directions", () => {
  const demo = read("packages/widget/src/demo-data.js");
  const app = read("packages/widget/src/App.jsx");
  const phaseIds = [...demo.matchAll(/\{ id: "(I0|P\d+)"/g)].map((match) => match[1]);
  const designIds = [...app.matchAll(/id: "(design-[123])"/g)].map((match) => match[1]);

  assert.deepEqual(phaseIds, ["I0", "P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]);
  assert.deepEqual(designIds, ["design-1", "design-2", "design-3"]);
  assert.match(app, /aria-label="Workflow phases"/);
  assert.match(app, /aria-current=\{currentPhase === phase\.id \? "step"/);
});

test("widget source includes keyboard, focus, responsive, print, and reduced-motion contracts", () => {
  const app = read("packages/widget/src/App.jsx");
  const styles = read("packages/widget/src/styles.css");
  const html = read("packages/widget/index.html");

  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  assert.match(app, /className="skip-link"/);
  assert.match(app, /role="status"/);
  assert.match(app, /aria-expanded=\{isExpanded\}/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(styles, /@media\s+print/);
  assert.match(styles, /@media\s*\(max-width:/);
});

test("built MCP widget is one self-contained HTML resource", (t) => {
  const builtPath = path.join(root, "packages/widget/dist/mcp/widget.html");
  if (!existsSync(builtPath)) {
    t.skip("build artifact is absent; run npm run build:widget before packaging verification");
    return;
  }

  const html = readFileSync(builtPath, "utf8");
  const size = statSync(builtPath).size;
  assert.ok(size > 100_000, "built widget should contain the bundled application");
  assert.ok(size < 4 * 1024 * 1024, `built widget exceeds the 4 MiB MVP budget (${size} bytes)`);
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/i);
  assert.doesNotMatch(html, /<link[^>]+rel=["']stylesheet["']/i);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /(?:src|href)=["']\.?\/assets\//i);
  assert.match(html, /data:image\/jpeg;base64,/);
  assert.match(html, /Learning Booklet Studio/);
});

test("widget dependency and build inputs are versioned and local", () => {
  const packageJson = JSON.parse(read("packages/widget/package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const config = read("packages/widget/vite.config.mjs");
  const preparer = read("packages/widget/scripts/prepare-mcp-widget.mjs");

  assert.ok(packageJson.dependencies["@modelcontextprotocol/ext-apps"]);
  assert.equal(lock.packages["node_modules/@modelcontextprotocol/ext-apps"].version, "1.7.4");
  assert.match(config, /assetsInlineLimit:\s*100_000_000/);
  assert.match(preparer, /data:\$\{mime\};base64/);
  assert.match(preparer, /<style>\$\{css\}<\/style>/);
  assert.match(preparer, /<script type="module">/);
});

test("live projection normalization never fills absent state from the demo run", () => {
  const normalized = normalizeRun({
    protocol: "codex-skill-ui/1",
    runId: "truthful-partial",
    stateVersion: 3,
    status: "blocked_external",
    currentPhase: "P8",
    phases: [{ id: "P8", status: "stale", attempt: 2 }],
  });

  assert.equal(normalized.topic, "Run state unavailable");
  assert.equal(normalized.subtitle, "No learner summary was published for this run.");
  assert.equal(normalized.currentWork, null);
  assert.equal(normalized.design.selectedName, null);
  assert.deepEqual(normalized.design.options, []);
  assert.deepEqual(normalized.journal, []);
  assert.deepEqual(normalized.evidence, []);
  assert.equal(normalized.phases.find(({ id }) => id === "P8").attempt, 2);
});

test("revision reconciliation ignores stale and duplicate delivery before applying a newer remount snapshot", () => {
  const snapshot = (stateVersion) => ({
    runId: "reconnect-run",
    stateVersion,
    status: "active",
    currentPhase: "P4",
    phases: [],
    design: {},
  });
  let current = normalizeRun(snapshot(11));
  let renderCount = 1;

  for (const incoming of [snapshot(10), snapshot(11), snapshot(12)]) {
    const result = reconcileRunSnapshot(current, incoming);
    if (result.kind === "applied") {
      current = result.run;
      renderCount += 1;
    }
  }

  assert.equal(renderCount, 2, "only initial revision 11 and remount revision 12 render");
  assert.equal(current.stateVersion, 12);
  assert.equal(reconcileRunSnapshot(current, { ...snapshot(13), runId: "other-run" }).kind, "different_run");
  assert.equal(reconcileRunSnapshot(current, {}).kind, "invalid");
});

test("reconciliation accepts only a verified terminal-parent to same-thread child transition", () => {
  const parentPayload = {
    runId: "terminal-parent",
    threadId: "thread-verified",
    parentRunId: null,
    resume: [],
    openInterruptIds: ["decision:9"],
    stateVersion: 9,
    executionStatus: "interrupt",
    terminalOutcome: "interrupt",
    pendingDecision: { id: "decision:9", type: "design_selection" },
    status: "awaiting_user",
    currentPhase: "I0",
    phases: [],
    design: {},
  };
  const childPayload = {
    runId: "resumed-child",
    threadId: "thread-verified",
    parentRunId: "terminal-parent",
    resume: [{ interruptId: "decision:9" }],
    openInterruptIds: [],
    stateVersion: 4,
    executionStatus: "running",
    terminalOutcome: null,
    pendingDecision: null,
    status: "active",
    currentPhase: "I0",
    phases: [],
    design: {},
  };
  const parent = normalizeRun(parentPayload);
  const transition = reconcileRunSnapshot(parent, childPayload);
  assert.equal(transition.kind, "child_transition");
  assert.equal(transition.parentRunId, "terminal-parent");
  assert.equal(transition.run.runId, "resumed-child");

  for (const invalidChild of [
    { ...childPayload, threadId: "other-thread" },
    { ...childPayload, parentRunId: "other-parent" },
    { ...childPayload, resume: [] },
    { ...childPayload, resume: [{ interruptId: "decision:9" }, { interruptId: "decision:9" }] },
    { ...childPayload, resume: [{ interruptId: "decision:other" }] },
  ]) {
    assert.equal(reconcileRunSnapshot(parent, invalidChild).kind, "different_run");
  }

  let child = transition.run;
  assert.equal(
    reconcileRunSnapshot(child, { ...parentPayload, stateVersion: 99 }).kind,
    "different_run",
    "a late parent delivery cannot replace the accepted child",
  );
  const newerChild = reconcileRunSnapshot(child, { ...childPayload, stateVersion: 5 });
  assert.equal(newerChild.kind, "applied");
  child = newerChild.run;
  assert.equal(child.stateVersion, 5);
});

test("widget automatically reconciles on mount, remount, and reconnect and exposes safe actionable errors", () => {
  const app = read("packages/widget/src/App.jsx");
  const host = read("packages/widget/src/mcp-host.js");

  assert.match(app, /reconcileRef\.current\?\.\("mount"\)/);
  assert.match(app, /addEventListener\("pageshow", reconcileAfterResume\)/);
  assert.match(app, /addEventListener\("online", reconcileAfterOnline\)/);
  assert.match(app, /callTool\("workflow_get"/);
  assert.match(host, /async reconnect\(reason = "reconnect"\)/);
  assert.match(app, /LBS-HOST-CONNECT-001/);
  assert.match(app, /LBS-RECONCILE-002/);
  assert.match(app, /role="alert"/);
  assert.match(app, /Retry reconciliation/);
  assert.doesNotMatch(app, /error\.message|error\.stack/);
});
