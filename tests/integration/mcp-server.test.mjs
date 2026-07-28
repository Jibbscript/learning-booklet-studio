import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  createWorkflowServer,
  PROTOCOL,
  WIDGET_URI,
} from "../../packages/mcp-server/server.mjs";
import { createFileStore } from "../../packages/mcp-server/store.mjs";
import { compactRun } from "../../packages/mcp-server/presentation.mjs";
import { applyCommand, createRunState, validateEventLog } from "../../packages/workflow-engine/index.mjs";

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  );

async function harness(t) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "learning-booklet-mcp-"));
  const connection = await connectAtStateDirectory(stateDir);
  t.after(async () => {
    await connection.close();
    rmSync(stateDir, { recursive: true, force: true });
  });
  return connection;
}

async function connectAtStateDirectory(stateDir) {
  const store = createFileStore({ stateDir });
  const server = createWorkflowServer({ store });
  const client = new Client(
    { name: "learning-booklet-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  let closed = false;
  return {
    client,
    store,
    async close() {
      if (closed) return;
      closed = true;
      await client.close();
      await server.close();
    },
  };
}

async function createGoldenRun(client, runId = "stringzilla-mcp") {
  const manifest = fixture("stringzilla-intent.json");
  return client.callTool({
    name: "workflow_create",
    arguments: {
      commandId: `create-${runId}`,
      runId,
      mode: manifest.mode,
      intent: Object.fromEntries(
        Object.entries(manifest.fields).map(([field, entry]) => [field, entry]),
      ),
      designRequired: true,
    },
  });
}

test("MCP surface advertises the bounded projection tools and truthful annotations", async (t) => {
  const { client } = await harness(t);
  const listed = await client.listTools();
  const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
  assert.deepEqual(
    [...byName.keys()].sort(),
    [
      "workflow_cancel_request",
      "workflow_create",
      "workflow_events",
      "workflow_get",
      "workflow_publish",
      "workflow_render",
      "workflow_submit_decision",
    ],
  );
  assert.equal(byName.get("workflow_get").annotations.readOnlyHint, true);
  assert.equal(byName.get("workflow_render").annotations.readOnlyHint, true);
  assert.equal(byName.get("workflow_cancel_request").annotations.destructiveHint, true);
  assert.equal(byName.get("workflow_publish").annotations.openWorldHint, false);
  assert.ok(byName.get("workflow_render").outputSchema);
  assert.deepEqual(byName.get("workflow_events")._meta.ui.visibility, ["app"]);
});

test("create and get are durable, sanitized, and idempotent", async (t) => {
  const { client, store } = await harness(t);
  const first = await createGoldenRun(client);
  const retry = await createGoldenRun(client);
  assert.equal(first.structuredContent.protocol, PROTOCOL);
  assert.equal(first.structuredContent.run.runId, "stringzilla-mcp");
  assert.equal(retry.structuredContent.run.stateVersion, first.structuredContent.run.stateVersion);
  assert.equal(store.list().length, 1);

  const got = await client.callTool({
    name: "workflow_get",
    arguments: { runId: "stringzilla-mcp" },
  });
  assert.equal(got.structuredContent.run.topic, fixture("stringzilla-intent.json").fields.topic.value);
  assert.equal(JSON.stringify(got.structuredContent).includes("/Users/"), false);
});

test("publish and app decision use revision checks and idempotency", async (t) => {
  const { client } = await harness(t);
  const created = await createGoldenRun(client);
  const backward = await client.callTool({
    name: "workflow_publish",
    arguments: {
      runId: "stringzilla-mcp",
      command: {
        type: "intent.patch",
        expectedStateVersion: created.structuredContent.run.stateVersion,
        idempotencyKey: "backward-time",
        payload: { patch: { timeProbe: true }, meta: { now: "2000-01-01T00:00:00.000Z" } },
      },
    },
  });
  assert.equal(backward.isError, true);
  assert.match(backward.content[0].text, /timestamps cannot move backward/i);
  const future = await client.callTool({
    name: "workflow_publish",
    arguments: {
      runId: "stringzilla-mcp",
      command: {
        type: "intent.patch",
        expectedStateVersion: created.structuredContent.run.stateVersion,
        idempotencyKey: "future-time",
        payload: { patch: { timeProbe: true }, meta: { now: "2099-01-01T00:00:00.000Z" } },
      },
    },
  });
  assert.equal(future.isError, true);
  assert.match(future.content[0].text, /in the future/i);
  const options = fixture("stringzilla-design-options.json").options;
  const proposed = await client.callTool({
    name: "workflow_publish",
    arguments: {
      runId: "stringzilla-mcp",
      command: {
        type: "design.propose",
        expectedStateVersion: created.structuredContent.run.stateVersion,
        idempotencyKey: "propose-designs",
        payload: { options },
      },
    },
  });
  assert.equal(proposed.structuredContent.run.design.options.length, 3);

  const decisionArgs = {
    runId: "stringzilla-mcp",
    commandId: "select-memory-lab",
    expectedStateVersion: proposed.structuredContent.run.stateVersion,
    command: {
      type: "design.select",
      payload: {
        selection: { method: "user-selected", selectedOptionId: "memory-lab" },
        selectedBy: "user",
      },
    },
  };
  const selected = await client.callTool({ name: "workflow_submit_decision", arguments: decisionArgs });
  const retry = await client.callTool({ name: "workflow_submit_decision", arguments: decisionArgs });
  assert.equal(selected.structuredContent.run.design.selectedOptionId, "memory-lab");
  assert.equal(retry.structuredContent.run.stateVersion, selected.structuredContent.run.stateVersion);
});

test("raw snapshot publishing preserves canonical identity, history, and permissions", async (t) => {
  const { client, store } = await harness(t);
  await createGoldenRun(client, "publish-integrity");
  const initial = store.load("publish-integrity");

  const sameVersion = structuredClone(initial);
  delete sameVersion.permissions.projectionCreate;
  const converged = await client.callTool({
    name: "workflow_publish",
    arguments: { runId: initial.runId, snapshot: sameVersion },
  });
  assert.equal(converged.isError, undefined);
  assert.deepEqual(store.load(initial.runId).permissions.projectionCreate, initial.permissions.projectionCreate);

  const progressed = applyCommand(initial, {
    type: "intent.patch",
    expectedStateVersion: initial.stateVersion,
    idempotencyKey: "publish-integrity-progress",
    payload: {
      origin: "inferred",
      confidence: 1,
      patch: { integrityProbe: "canonical progress" },
    },
  }).state;
  delete progressed.permissions.projectionCreate;
  const rejectedAdvance = await client.callTool({
    name: "workflow_publish",
    arguments: { runId: initial.runId, snapshot: progressed },
  });
  assert.equal(rejectedAdvance.isError, true);
  assert.match(rejectedAdvance.content[0].text, /raw snapshots cannot advance/i);
  const accepted = await client.callTool({
    name: "workflow_publish",
    arguments: {
      runId: initial.runId,
      command: {
        type: "intent.patch",
        expectedStateVersion: initial.stateVersion,
        idempotencyKey: "publish-integrity-progress",
        payload: {
          origin: "inferred",
          confidence: 1,
          patch: { integrityProbe: "canonical progress" },
        },
      },
    },
  });
  assert.equal(accepted.isError, undefined);

  for (const [label, mutate, pattern] of [
    ["threadId", (draft) => { draft.threadId = "forged-thread"; draft.events[0].payload.threadId = "forged-thread"; }, /canonical run identity field threadId/i],
    ["parentRunId", (draft) => { draft.parentRunId = "forged-parent"; draft.events[0].payload.parentRunId = "forged-parent"; }, /canonical run identity field parentRunId/i],
    ["resume", (draft) => { draft.resume = [{ interruptId: "forged", value: {} }]; draft.events[0].payload.resume = structuredClone(draft.resume); }, /canonical run identity field resume/i],
    ["mode", (draft) => { draft.mode = "plan_only"; draft.events[0].payload.mode = "plan_only"; }, /canonical run identity field mode/i],
    ["event id", (draft) => { draft.events[0].id = "forged:1"; }, /invalid canonical id/i],
    ["event runId", (draft) => { draft.events[0].runId = "forged-event-run"; }, /has runId forged-event-run/i],
    ["creation payload", (draft) => { draft.events[0].payload.threadId = "forged-event-thread"; }, /payload threadId/i],
    ["historical payload", (draft) => { draft.events[1].payload = { section: "forged-history" }; }, /cannot rewrite canonical event history/i],
    ["permission expansion", (draft) => { draft.permissions.network = true; }, /cannot introduce, remove, or change workflow permissions/i],
  ]) {
    const draft = applyCommand(store.load(initial.runId), {
      type: "intent.patch",
      expectedStateVersion: store.load(initial.runId).stateVersion,
      idempotencyKey: `integrity-${label}`,
      payload: { origin: "inferred", confidence: 1, patch: { [`probe_${label}`]: true } },
    }).state;
    delete draft.permissions.projectionCreate;
    mutate(draft);
    const rejected = await client.callTool({
      name: "workflow_publish",
      arguments: { runId: initial.runId, snapshot: draft },
    });
    assert.equal(rejected.isError, true, label);
    assert.match(rejected.content[0].text, pattern, label);
  }

  const forgedReceipt = applyCommand(store.load(initial.runId), {
    type: "intent.patch",
    expectedStateVersion: store.load(initial.runId).stateVersion,
    idempotencyKey: "forge-create-receipt",
    payload: { origin: "inferred", confidence: 1, patch: { receiptProbe: true } },
  }).state;
  forgedReceipt.permissions.projectionCreate.commandId = "forged";
  const rejectedReceipt = await client.callTool({
    name: "workflow_publish",
    arguments: { runId: initial.runId, snapshot: forgedReceipt },
  });
  assert.equal(rejectedReceipt.isError, true);
  assert.match(rejectedReceipt.content[0].text, /projectionCreate is server-owned/i);

  const unknown = createRunState({ runId: "unknown-publish", now: "2026-07-22T00:00:00.000Z" });
  const rejectedUnknown = await client.callTool({
    name: "workflow_publish",
    arguments: { runId: unknown.runId, snapshot: unknown },
  });
  assert.equal(rejectedUnknown.isError, true);
  assert.match(rejectedUnknown.content[0].text, /cannot create a run/i);

  const forgedTerminal = structuredClone(store.load(initial.runId));
  const terminalAt = new Date(Date.parse(forgedTerminal.updatedAt) + 1_000).toISOString();
  const terminalSeq = forgedTerminal.events.length + 1;
  forgedTerminal.events.push({
    id: `${forgedTerminal.runId}:${terminalSeq}`,
    seq: terminalSeq,
    stateVersion: terminalSeq,
    type: "run.finished",
    runId: forgedTerminal.runId,
    occurredAt: terminalAt,
    payload: { outcome: "success", finalRevision: terminalSeq, workflowStatus: "completed" },
  });
  forgedTerminal.stateVersion = terminalSeq;
  forgedTerminal.eventCursor = terminalSeq;
  forgedTerminal.updatedAt = terminalAt;
  forgedTerminal.finishedAt = terminalAt;
  forgedTerminal.executionStatus = "success";
  forgedTerminal.terminalOutcome = "success";
  forgedTerminal.status = "completed";
  delete forgedTerminal.permissions.projectionCreate;
  assert.equal(validateEventLog(forgedTerminal).valid, true, "the forged snapshot is structurally valid");
  const rejectedTerminal = await client.callTool({
    name: "workflow_publish",
    arguments: { runId: initial.runId, snapshot: forgedTerminal },
  });
  assert.equal(rejectedTerminal.isError, true);
  assert.match(rejectedTerminal.content[0].text, /raw snapshots cannot advance/i);

  const permissionRoot = createRunState({
    runId: "permission-root",
    permissions: { network: false, shell: false, filesystem: false },
    now: "2026-07-22T00:00:00.000Z",
  });
  store.save(permissionRoot);
  for (const [label, mutate] of [
    ["change", (permissions) => { permissions.network = true; }],
    ["delete", (permissions) => { delete permissions.shell; }],
    ["introduce", (permissions) => { permissions.process = true; }],
  ]) {
    const draft = applyCommand(permissionRoot, {
      type: "intent.patch",
      expectedStateVersion: permissionRoot.stateVersion,
      idempotencyKey: `permission-${label}`,
      payload: { origin: "inferred", confidence: 1, patch: { permissionProbe: label } },
    }).state;
    mutate(draft.permissions);
    const rejected = await client.callTool({
      name: "workflow_publish",
      arguments: { runId: permissionRoot.runId, snapshot: draft },
    });
    assert.equal(rejected.isError, true, label);
    assert.match(rejected.content[0].text, /cannot introduce, remove, or change workflow permissions/i);
  }
});

test("a terminal decision resumes exactly one durable same-thread child and parent lookup recovers it", async (t) => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "learning-booklet-resume-mcp-"));
  let connection = await connectAtStateDirectory(stateDir);
  t.after(async () => {
    await connection?.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  const created = await createGoldenRun(connection.client, "terminal-parent");
  const proposed = await connection.client.callTool({
    name: "workflow_publish",
    arguments: {
      runId: "terminal-parent",
      command: {
        type: "design.propose",
        expectedStateVersion: created.structuredContent.run.stateVersion,
        idempotencyKey: "terminal-propose-designs",
        payload: { options: fixture("stringzilla-design-options.json").options },
      },
    },
  });
  const interrupted = await connection.client.callTool({
    name: "workflow_publish",
    arguments: {
      runId: "terminal-parent",
      command: {
        type: "input.request",
        expectedStateVersion: proposed.structuredContent.run.stateVersion,
        idempotencyKey: "terminal-design-request",
        payload: {
          request: {
            type: "design_selection",
            fields: [],
            prompt: "Choose one of the three design systems.",
          },
        },
      },
    },
  });
  const parentProjection = interrupted.structuredContent.run;
  assert.equal(parentProjection.executionStatus, "interrupt");
  assert.equal(parentProjection.terminalOutcome, "interrupt");
  assert.ok(parentProjection.finishedAt);
  assert.equal(parentProjection.parentRunId, null);
  assert.deepEqual(parentProjection.openInterruptIds, [parentProjection.pendingDecision.id]);

  const decisionArgs = {
    runId: "terminal-parent",
    commandId: "terminal-select-memory-lab",
    expectedStateVersion: parentProjection.stateVersion,
    command: {
      type: "design.select",
      payload: {
        selection: { method: "user-selected", selectedOptionId: "memory-lab" },
        selectedBy: "user",
      },
    },
  };
  const selected = await connection.client.callTool({
    name: "workflow_submit_decision",
    arguments: decisionArgs,
  });
  const childProjection = selected.structuredContent.run;
  assert.notEqual(childProjection.runId, "terminal-parent");
  assert.equal(childProjection.parentRunId, "terminal-parent");
  assert.equal(childProjection.threadId, parentProjection.threadId);
  assert.ok(childProjection.createdAt >= parentProjection.updatedAt);
  assert.equal(childProjection.executionStatus, "running");
  assert.equal(childProjection.terminalOutcome, null);
  assert.deepEqual(childProjection.resume, [{ interruptId: parentProjection.pendingDecision.id }]);
  assert.equal(Object.hasOwn(childProjection.resume[0], "value"), false, "resume values stay out of model-visible projection");
  const projectedStartedEvent = childProjection.recentEvents.find(({ type }) => type === "run.created");
  assert.deepEqual(projectedStartedEvent.payload.resume, [{ interruptId: parentProjection.pendingDecision.id }]);
  assert.equal(childProjection.design.selectedOptionId, "memory-lab");

  const childEvents = await connection.client.callTool({
    name: "workflow_events",
    arguments: { runId: childProjection.runId, afterSeq: 0, limit: 10 },
  });
  assert.deepEqual(childEvents.structuredContent.events[0].payload.resume, [
    { interruptId: parentProjection.pendingDecision.id },
  ]);

  const immutableParent = connection.store.load("terminal-parent");
  const canonicalChild = connection.store.load(childProjection.runId);
  assert.equal(immutableParent.terminalOutcome, "interrupt");
  assert.equal(immutableParent.pendingDecision.id, parentProjection.pendingDecision.id);
  assert.equal(immutableParent.design.selection, null);
  assert.equal(canonicalChild.permissions.projectionCreate, undefined);
  assert.equal(canonicalChild.permissions.projectionResume.parentRunId, "terminal-parent");
  assert.equal(connection.store.loadAcceptedChild("terminal-parent").runId, childProjection.runId);

  const receipt = structuredClone(canonicalChild.permissions.projectionResume);
  const receiptlessCurrent = structuredClone(canonicalChild);
  delete receiptlessCurrent.permissions.projectionResume;
  const reconciled = await connection.client.callTool({
    name: "workflow_publish",
    arguments: { runId: childProjection.runId, snapshot: receiptlessCurrent },
  });
  assert.deepEqual(
    connection.store.load(childProjection.runId).permissions.projectionResume,
    receipt,
    "same-version reconciliation must preserve the server-owned resume receipt",
  );
  assert.equal(reconciled.structuredContent.run.stateVersion, canonicalChild.stateVersion);

  const published = await connection.client.callTool({
    name: "workflow_publish",
    arguments: {
      runId: childProjection.runId,
      command: {
        type: "intent.patch",
        expectedStateVersion: canonicalChild.stateVersion,
        idempotencyKey: "progress-resumed-child",
        payload: {
          origin: "inferred",
          confidence: 1,
          patch: { nativeRestartProbe: "preserve accepted-child identity across publish and restart" },
        },
      },
    },
  });
  assert.equal(published.isError, undefined);
  const progressed = structuredClone(connection.store.load(childProjection.runId));
  delete progressed.permissions.projectionResume;

  const changedResume = structuredClone(progressed);
  changedResume.resume[0].value.selection.selectedOptionId = "trace-dossier";
  const changedResumeResult = await connection.client.callTool({
    name: "workflow_publish",
    arguments: { runId: childProjection.runId, snapshot: changedResume },
  });
  assert.equal(changedResumeResult.isError, true);
  assert.match(changedResumeResult.content[0].text, /(?:canonical run identity field resume|payload resume)/i);

  const forgedReceipt = structuredClone(progressed);
  forgedReceipt.permissions.projectionResume = { ...receipt, commandId: "forged-command" };
  const forgedReceiptResult = await connection.client.callTool({
    name: "workflow_publish",
    arguments: { runId: childProjection.runId, snapshot: forgedReceipt },
  });
  assert.equal(forgedReceiptResult.isError, true);
  assert.match(forgedReceiptResult.content[0].text, /projectionResume is server-owned/i);

  const retry = await connection.client.callTool({
    name: "workflow_submit_decision",
    arguments: decisionArgs,
  });
  assert.equal(retry.structuredContent.run.runId, childProjection.runId);
  assert.equal(
    connection.store.list().filter(({ parentRunId }) => parentRunId === "terminal-parent").length,
    1,
  );

  await connection.close();
  connection = await connectAtStateDirectory(stateDir);
  const recovered = await connection.client.callTool({
    name: "workflow_get",
    arguments: { runId: "terminal-parent" },
  });
  assert.equal(recovered.structuredContent.run.runId, childProjection.runId);
  assert.equal(recovered.structuredContent.run.parentRunId, "terminal-parent");

  const retryAfterRestart = await connection.client.callTool({
    name: "workflow_submit_decision",
    arguments: decisionArgs,
  });
  assert.equal(retryAfterRestart.structuredContent.run.runId, childProjection.runId);
  assert.equal(
    connection.store.list().filter(({ parentRunId }) => parentRunId === "terminal-parent").length,
    1,
    "duplicate submission and restart must not create another child",
  );
});

test("events are cursor-bounded and cancellation remains a request", async (t) => {
  const { client } = await harness(t);
  const created = await createGoldenRun(client, "cancel-probe");
  const cancelled = await client.callTool({
    name: "workflow_cancel_request",
    arguments: {
      runId: "cancel-probe",
      commandId: "cancel-request-1",
      expectedStateVersion: created.structuredContent.run.stateVersion,
      reason: "Stop after the current safe boundary.",
    },
  });
  assert.equal(cancelled.structuredContent.run.pendingDecision.type, "cancel_request");
  assert.notEqual(cancelled.structuredContent.run.status, "completed");
  assert.match(cancelled.content[0].text, /no claim.+stopped/i);

  const page = await client.callTool({
    name: "workflow_events",
    arguments: { runId: "cancel-probe", afterSeq: 0, limit: 1 },
  });
  assert.equal(page.structuredContent.events.length, 1);
  assert.equal(page.structuredContent.hasMore, true);
  assert.equal(page.structuredContent.nextSeq, 1);
});

test("versioned MCP App resource is self-contained and denies network domains", async (t) => {
  const { client } = await harness(t);
  await createGoldenRun(client, "render-probe");
  const resources = await client.listResources();
  const resource = resources.resources.find((entry) => entry.uri === WIDGET_URI);
  assert.ok(resource);
  assert.deepEqual(resource._meta.ui.csp.connectDomains, []);
  assert.deepEqual(resource._meta.ui.csp.resourceDomains, []);

  const read = await client.readResource({ uri: WIDGET_URI });
  const content = read.contents[0];
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  assert.match(content.text, /Learning Booklet Studio/);
  assert.doesNotMatch(content.text, /<script[^>]+src=/i);
  assert.doesNotMatch(content.text, /<link[^>]+rel=["']stylesheet["']/i);
  assert.doesNotMatch(content.text, /(?:src|href)=["']\/assets\//i);

  const rendered = await client.callTool({
    name: "workflow_render",
    arguments: { runId: "render-probe" },
  });
  assert.equal(rendered.structuredContent.run.runId, "render-probe");
});

test("projection exposes repair, degraded, native, residual-risk, and release evidence without inventing passes", () => {
  const hash = (character) => `sha256:${character.repeat(64)}`;
  const state = createRunState({
    runId: "truth-projection",
    mode: "plan_then_build",
    residualRisks: ["Safari may require a separate manual layout pass."],
    limitations: [path.join(path.parse(process.cwd()).root, "Users", "alice", "private", "native-notes.txt")],
    now: "2026-07-22T10:00:00.000Z",
  });
  state.status = "blocked_external";
  state.currentLayer = "build";
  state.currentPhase = "P8";
  state.phases.P8.status = "stale";
  state.phases.P8.attempt = 2;
  state.artifacts.production = {
    id: "production",
    kind: "production",
    phaseId: "P7",
    hash: hash("a"),
    revision: 1,
    stale: false,
    staleReason: null,
    data: "<!doctype html><html><body>Booklet</body></html>",
    files: [{ path: "index.html", mimeType: "text/html" }],
    metadata: { selfContained: true, networkRequired: false, externalRuntimeResources: [] },
  };
  state.artifacts.verification = {
    id: "verification",
    kind: "verification",
    phaseId: "P8",
    hash: hash("b"),
    revision: 2,
    stale: false,
    staleReason: null,
    data: {},
    files: [],
    metadata: {},
  };
  state.artifactIndex.production = "production";
  state.artifactIndex.verification = "verification";
  state.evidence["p7-offline"] = {
    id: "p7-offline",
    phaseId: "P7",
    gateId: "implementation.controls_work",
    status: "pass",
    executed: true,
    critical: true,
    stale: false,
    staleReason: null,
    artifactId: "production",
    artifactKind: "production",
    artifactHash: hash("a"),
    recordedAt: "2026-07-22T10:01:00.000Z",
  };
  state.evidence["p8-failed"] = {
    id: "p8-failed",
    phaseId: "P8",
    gateId: "verification.critical_checks_executed",
    status: "fail",
    executed: true,
    critical: true,
    stale: true,
    staleReason: "repair_rerun",
    artifactId: "verification",
    artifactKind: "verification",
    artifactHash: hash("b"),
    recordedAt: "2026-07-22T10:02:00.000Z",
    details: { earliestResponsiblePhase: "P7", failedCheck: "quiz feedback" },
  };
  state.evidence["p8-current"] = {
    id: "p8-current",
    phaseId: "P8",
    gateId: "verification.critical_checks_executed",
    status: "pass",
    executed: true,
    critical: true,
    stale: false,
    staleReason: null,
    artifactId: "verification",
    artifactKind: "verification",
    artifactHash: hash("b"),
    recordedAt: "2026-07-22T10:04:00.000Z",
  };
  state.evidence["native-intel"] = {
    id: "native-intel",
    phaseId: "P8",
    gateId: "verification.unavailable_marked_not_run",
    status: "not_run",
    executed: false,
    critical: true,
    stale: false,
    staleReason: null,
    recordedAt: "2026-07-22T10:05:00.000Z",
    details: { architecture: "x86_64", reason: "native journey not yet observed" },
  };
  state.events.push(
    {
      id: "truth-projection:2", seq: 2, stateVersion: 2, type: "gate.evaluated", runId: state.runId,
      occurredAt: "2026-07-22T10:02:00.000Z",
      payload: { phaseId: "P8", gateId: "verification.critical_checks_executed", status: "fail", reasons: ["fail:p8-failed"], evidenceIds: ["p8-failed"] },
    },
    {
      id: "truth-projection:3", seq: 3, stateVersion: 3, type: "phase.invalidated", runId: state.runId,
      occurredAt: "2026-07-22T10:03:00.000Z",
      payload: { phaseId: "P7", reason: "quiz_feedback_incorrect", sourceKind: "production", staleEvidenceIds: ["p8-failed"] },
    },
    {
      id: "truth-projection:4", seq: 4, stateVersion: 4, type: "phase.started", runId: state.runId,
      occurredAt: "2026-07-22T10:03:30.000Z", payload: { phaseId: "P8", attempt: 2 },
    },
  );
  state.eventCursor = 4;
  state.stateVersion = 4;
  state.updatedAt = "2026-07-22T10:05:00.000Z";

  const projection = compactRun(state);
  assert.equal(projection.threadId, "truth-projection");
  assert.equal(projection.parentRunId, null);
  assert.deepEqual(projection.resume, []);
  assert.equal(projection.executionStatus, "running");
  assert.equal(projection.terminalOutcome, null);
  assert.equal(projection.orchestration.degraded, true);
  assert.equal(projection.offlineArtifact.status, "recorded");
  assert.deepEqual(projection.offlineArtifact.currentPassingEvidenceIds, ["p7-offline"]);
  assert.equal(projection.repair.failedGateAttempts.length, 1);
  assert.equal(projection.repair.failedGateAttempts[0].causalPhase, "P8");
  assert.equal(projection.repair.failedGateAttempts[0].repairAttempt, 2);
  assert.equal(projection.repair.failedGateAttempts[0].currentPass.evidenceId, "p8-current");
  assert.equal(projection.nativeGates.find(({ architecture }) => architecture === "native-macos-intel").status, "recorded");
  assert.equal(projection.nativeGates.find(({ architecture }) => architecture === "native-macos-intel").notRunCount, 1);
  assert.equal(projection.nativeGates.find(({ architecture }) => architecture === "native-macos-apple-silicon").status, "missing");
  assert.equal(projection.release.decision, "fail");
  assert.ok(projection.release.notRunChecks.some(({ id }) => id === "native-intel"));
  assert.deepEqual(projection.residualRisks, ["Safari may require a separate manual layout pass."]);
  assert.deepEqual(projection.limitations, ["[workspace-relative path redacted]"]);
  assert.equal(projection.evidence.find(({ id }) => id === "native-intel").status, "not_run");
});
