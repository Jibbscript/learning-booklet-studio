import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  applyCommand,
  createRunState,
  resumeRunState,
} from "../../packages/workflow-engine/index.mjs";
import {
  createFileStore,
  validateAcceptedChild,
} from "../../packages/mcp-server/store.mjs";

const STORE_MODULE_URL = pathToFileURL(
  path.resolve("packages/mcp-server/store.mjs"),
).href;
const ENGINE_MODULE_URL = pathToFileURL(
  path.resolve("packages/workflow-engine/index.mjs"),
).href;
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

function interruptedParent(runId, threadId = `${runId}-thread`) {
  const initial = createRunState({ runId, threadId, intent: {} });
  return applyCommand(initial, {
    type: "input.request",
    expectedStateVersion: initial.stateVersion,
    idempotencyKey: `${runId}-request-topic`,
    payload: {
      request: {
        type: "intent",
        fields: ["topic"],
        prompt: "Choose the topic.",
      },
    },
  }).state;
}

function acceptedChild(
  parent,
  {
    runId,
    commandId,
    fingerprint,
    patch = { topic: `topic-for-${runId}` },
  },
) {
  const interruptIds = (parent.interrupts ?? [])
    .filter(({ status }) => status === "open")
    .map(({ id }) => id);
  const resume = interruptIds.map((interruptId) => ({
    interruptId,
    value: { patch },
  }));
  const child = resumeRunState(parent, {
    runId,
    threadId: parent.threadId,
    resume,
  });
  const inheritedPermissions = { ...(child.permissions ?? {}) };
  delete inheritedPermissions.projectionCreate;
  delete inheritedPermissions.projectionResume;
  child.permissions = {
    ...inheritedPermissions,
    projectionResume: {
      acceptedBy: "workflow_submit_decision",
      parentRunId: parent.runId,
      childRunId: runId,
      interruptIds,
      commandId,
      fingerprint,
      acceptedAt: child.createdAt,
    },
  };
  return child;
}

function prepareStore(t, prefix) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  return { stateDir, store: createFileStore({ stateDir }) };
}

const CONTENDER_SOURCE = `
  import { existsSync } from "node:fs";
  import { createFileStore } from ${JSON.stringify(STORE_MODULE_URL)};
  import { resumeRunState } from ${JSON.stringify(ENGINE_MODULE_URL)};

  const [stateDir, parentRunId, commandId, fingerprint, candidateRunId, gate] =
    process.argv.slice(1);
  process.stdout.write("READY\\n");
  while (!existsSync(gate)) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const store = createFileStore({ stateDir });
  const parent = store.load(parentRunId);
  const interruptIds = parent.interrupts
    .filter(({ status }) => status === "open")
    .map(({ id }) => id);
  const child = resumeRunState(parent, {
    runId: candidateRunId,
    threadId: parent.threadId,
    resume: interruptIds.map((interruptId) => ({
      interruptId,
      value: { patch: { topic: "topic-" + commandId } },
    })),
  });
  child.permissions = {
    ...(child.permissions || {}),
    projectionResume: {
      acceptedBy: "workflow_submit_decision",
      parentRunId,
      childRunId: candidateRunId,
      interruptIds,
      commandId,
      fingerprint,
      acceptedAt: child.createdAt,
    },
  };
  try {
    const result = store.acceptAcceptedChild(parent, {
      commandId,
      fingerprint,
      childState: child,
    });
    process.stdout.write(JSON.stringify({
      status: "accepted",
      runId: result.state.runId,
      reservationCreated: result.reservationCreated,
      childCreated: result.childCreated,
    }) + "\\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: "error", message: error.message }) + "\\n");
  }
`;

function contender({
  stateDir,
  parentRunId,
  commandId,
  fingerprint,
  candidateRunId,
  gate,
}) {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      CONTENDER_SOURCE,
      stateDir,
      parentRunId,
      commandId,
      fingerprint,
      candidateRunId,
      gate,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes("READY\n")) readyResolve();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`Contender exited with ${code ?? signal}: ${stderr}`));
        return;
      }
      const line = stdout
        .split("\n")
        .map((entry) => entry.trim())
        .filter((entry) => entry.startsWith("{"))
        .at(-1);
      if (!line) {
        reject(new Error(`Contender returned no result: ${stdout}\n${stderr}`));
        return;
      }
      resolve(JSON.parse(line));
    });
  });
  return { ready, done };
}

test("atomic reservation lets one OS process win and rejects a different decision", async (t) => {
  const { stateDir, store } = prepareStore(t, "learning-booklet-accept-race-");
  const parent = interruptedParent("race-parent");
  store.save(parent);
  const gate = path.join(stateDir, "start-contenders");
  const first = contender({
    stateDir,
    parentRunId: parent.runId,
    commandId: "decision-a",
    fingerprint: DIGEST_A,
    candidateRunId: "candidate-a",
    gate,
  });
  const second = contender({
    stateDir,
    parentRunId: parent.runId,
    commandId: "decision-b",
    fingerprint: DIGEST_B,
    candidateRunId: "candidate-b",
    gate,
  });
  await Promise.all([first.ready, second.ready]);
  writeFileSync(gate, "go\n", "utf8");
  const results = await Promise.all([first.done, second.done]);

  assert.equal(results.filter(({ status }) => status === "accepted").length, 1);
  assert.equal(results.filter(({ status }) => status === "error").length, 1);
  assert.match(
    results.find(({ status }) => status === "error").message,
    /already accepted a different decision/i,
  );

  const winner = results.find(({ status }) => status === "accepted");
  const accepted = store.loadAcceptedChild(parent.runId);
  assert.equal(accepted.runId, winner.runId);
  assert.equal(
    store.list().filter(({ parentRunId }) => parentRunId === parent.runId).length,
    1,
  );
  const eventFile = path.join(stateDir, "runs", accepted.runId, "events.ndjson");
  const eventLines = readFileSync(eventFile, "utf8").trim().split("\n");
  assert.equal(eventLines.length, accepted.events.length, "materialization must not duplicate events");
});

test("identical OS-process retries converge without duplicate materialization", async (t) => {
  const { stateDir, store } = prepareStore(t, "learning-booklet-accept-converge-");
  const parent = interruptedParent("converge-parent");
  store.save(parent);
  const gate = path.join(stateDir, "start-identical-contenders");
  const contenders = ["candidate-one", "candidate-two"].map((candidateRunId) => contender({
    stateDir,
    parentRunId: parent.runId,
    commandId: "identical-command",
    fingerprint: DIGEST_A,
    candidateRunId,
    gate,
  }));
  await Promise.all(contenders.map(({ ready }) => ready));
  writeFileSync(gate, "go\n", "utf8");
  const results = await Promise.all(contenders.map(({ done }) => done));

  assert.deepEqual(results.map(({ status }) => status), ["accepted", "accepted"]);
  assert.equal(new Set(results.map(({ runId }) => runId)).size, 1);
  assert.equal(results.filter(({ reservationCreated }) => reservationCreated).length, 1);
  assert.equal(results.filter(({ childCreated }) => childCreated).length, 1);
  const accepted = store.loadAcceptedChild(parent.runId);
  const eventFile = path.join(stateDir, "runs", accepted.runId, "events.ndjson");
  const eventLines = readFileSync(eventFile, "utf8").trim().split("\n");
  assert.equal(eventLines.length, accepted.events.length);
  assert.equal(
    store.list().filter(({ parentRunId }) => parentRunId === parent.runId).length,
    1,
  );
});

test("an identical retry recovers a reserved child after a simulated crash", (t) => {
  const { stateDir, store } = prepareStore(t, "learning-booklet-accept-recovery-");
  const parent = interruptedParent("recovery-parent");
  store.save(parent);
  const firstCandidate = acceptedChild(parent, {
    runId: "reserved-winner",
    commandId: "same-command",
    fingerprint: DIGEST_A,
  });
  const reservation = store.reserveAcceptedChild(parent, {
    commandId: "same-command",
    fingerprint: DIGEST_A,
    childState: firstCandidate,
  });
  assert.equal(reservation.created, true);
  assert.equal(store.load(firstCandidate.runId), null, "reservation alone simulates the crash boundary");

  const restarted = createFileStore({ stateDir });
  const losingCandidate = acceptedChild(parent, {
    runId: "retry-random-candidate",
    commandId: "same-command",
    fingerprint: DIGEST_A,
  });
  const recovered = restarted.acceptAcceptedChild(parent, {
    commandId: "same-command",
    fingerprint: DIGEST_A,
    childState: losingCandidate,
  });
  assert.equal(recovered.reservationCreated, false);
  assert.equal(recovered.childCreated, true);
  assert.equal(recovered.state.runId, "reserved-winner");
  assert.equal(restarted.load("retry-random-candidate"), null);
  assert.equal(restarted.loadAcceptedChild(parent.runId).runId, "reserved-winner");

  const conflictingCandidate = acceptedChild(parent, {
    runId: "conflicting-retry",
    commandId: "changed-command",
    fingerprint: DIGEST_B,
  });
  assert.throws(
    () => restarted.acceptAcceptedChild(parent, {
      commandId: "changed-command",
      fingerprint: DIGEST_B,
      childState: conflictingCandidate,
    }),
    /already accepted a different decision/i,
  );
});

test("latest accepted descendant traverses two generations while immediate lookup stays immediate", (t) => {
  const { store } = prepareStore(t, "learning-booklet-accept-lineage-");
  const root = interruptedParent("lineage-root", "lineage-thread");
  store.save(root);
  const first = acceptedChild(root, {
    runId: "lineage-child",
    commandId: "first-command",
    fingerprint: DIGEST_A,
  });
  store.acceptAcceptedChild(root, {
    commandId: "first-command",
    fingerprint: DIGEST_A,
    childState: first,
  });

  const secondParent = applyCommand(first, {
    type: "input.request",
    expectedStateVersion: first.stateVersion,
    idempotencyKey: "request-duration",
    payload: {
      request: {
        type: "intent",
        fields: ["learning_duration"],
        prompt: "Choose the learning duration.",
      },
    },
  }).state;
  store.save(secondParent);
  const second = acceptedChild(secondParent, {
    runId: "lineage-grandchild",
    commandId: "second-command",
    fingerprint: DIGEST_B,
    patch: { learning_duration: "45 minutes" },
  });
  store.acceptAcceptedChild(secondParent, {
    commandId: "second-command",
    fingerprint: DIGEST_B,
    childState: second,
  });

  assert.equal(store.loadAcceptedChild(root.runId).runId, "lineage-child");
  assert.equal(
    store.loadLatestAcceptedDescendant(root.runId).runId,
    "lineage-grandchild",
  );
  assert.equal(
    store.loadLatestAcceptedDescendant("lineage-child").runId,
    "lineage-grandchild",
  );
});

test("accepted-child validation and lineage lookup fail closed on corruption", async (t) => {
  await t.test("receipt ids and run.created linkage are validated", () => {
    const parent = interruptedParent("validation-parent");
    const child = acceptedChild(parent, {
      runId: "validation-child",
      commandId: "validation-command",
      fingerprint: DIGEST_C,
    });
    const duplicateReceipt = structuredClone(child);
    duplicateReceipt.permissions.projectionResume.interruptIds.push(
      duplicateReceipt.permissions.projectionResume.interruptIds[0],
    );
    assert.throws(
      () => validateAcceptedChild(parent, duplicateReceipt),
      /unique ids/i,
    );

    const wrongCreatedLink = structuredClone(child);
    wrongCreatedLink.events[0].payload.parentRunId = "another-parent";
    assert.throws(
      () => validateAcceptedChild(parent, wrongCreatedLink),
      /(?:run.created linkage|run.created payload parentRunId)/i,
    );

    const noncanonicalTime = structuredClone(child);
    noncanonicalTime.createdAt = "9";
    noncanonicalTime.permissions.projectionResume.acceptedAt = "9";
    noncanonicalTime.events[0].occurredAt = "9";
    assert.throws(
      () => validateAcceptedChild(parent, noncanonicalTime),
      /invalid canonical event log/i,
    );
  });

  await t.test("multiple legacy accepted children are rejected", () => {
    const { store } = prepareStore(t, "learning-booklet-accept-multiple-");
    const parent = interruptedParent("multiple-parent");
    store.save(parent);
    for (const suffix of ["one", "two"]) {
      store.save(acceptedChild(parent, {
        runId: `multiple-child-${suffix}`,
        commandId: `multiple-command-${suffix}`,
        fingerprint: suffix === "one" ? DIGEST_A : DIGEST_B,
      }));
    }
    assert.throws(
      () => store.loadAcceptedChild(parent.runId),
      /more than one accepted decision child/i,
    );
  });

  await t.test("cyclic legacy lineage is rejected", () => {
    const { store } = prepareStore(t, "learning-booklet-accept-cycle-");
    const createdAt = "2026-07-23T00:00:00.000Z";
    function cyclicState({ runId, parentRunId, resumeId, openId }) {
      const resume = [{ interruptId: resumeId, value: { accepted: true } }];
      return {
        schemaVersion: "1.0.0",
        mode: "plan_then_build",
        runId,
        threadId: "cycle-thread",
        parentRunId,
        resume,
        createdAt,
        updatedAt: createdAt,
        stateVersion: 2,
        eventCursor: 2,
        status: "awaiting_user",
        executionStatus: "interrupt",
        terminalOutcome: "interrupt",
        finishedAt: createdAt,
        pendingDecision: { id: openId, type: "cycle" },
        interrupts: [{ id: openId, status: "open" }],
        permissions: {
          projectionResume: {
            acceptedBy: "workflow_submit_decision",
            parentRunId,
            childRunId: runId,
            interruptIds: [resumeId],
            commandId: `command-${runId}`,
            fingerprint: DIGEST_C,
            acceptedAt: createdAt,
          },
        },
        events: [
          {
            id: `${runId}:1`,
            seq: 1,
            stateVersion: 1,
            type: "run.created",
            runId,
            occurredAt: createdAt,
            payload: {
              schemaVersion: "1.0.0",
              mode: "plan_then_build",
              threadId: "cycle-thread",
              parentRunId,
              resume,
            },
          },
          {
            id: `${runId}:2`,
            seq: 2,
            stateVersion: 2,
            type: "run.finished",
            runId,
            occurredAt: createdAt,
            payload: { outcome: "interrupt", finalRevision: 2, evidenceIds: [] },
          },
        ],
      };
    }
    store.save(cyclicState({
      runId: "cycle-a",
      parentRunId: "cycle-b",
      resumeId: "interrupt-b",
      openId: "interrupt-a",
    }));
    store.save(cyclicState({
      runId: "cycle-b",
      parentRunId: "cycle-a",
      resumeId: "interrupt-a",
      openId: "interrupt-b",
    }));
    assert.throws(
      () => store.loadLatestAcceptedDescendant("cycle-a"),
      /cyclic accepted-child lineage/i,
    );
  });
});
