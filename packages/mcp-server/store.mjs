import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { validateEventLog } from "../workflow-engine/index.mjs";

const SAFE_RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ACCEPTANCE_SCHEMA = "learning-booklet-studio/decision-acceptance/v1";
const ACCEPTANCE_FILE = "accepted-child.json";
const RECEIPT_KEYS = [
  "acceptedAt",
  "acceptedBy",
  "childRunId",
  "commandId",
  "fingerprint",
  "interruptIds",
  "parentRunId",
];

export function defaultStateDirectory() {
  if (process.env.LEARNING_BOOKLET_STATE_DIR) {
    return path.resolve(process.env.LEARNING_BOOKLET_STATE_DIR);
  }
  const codexRoot = process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");
  return path.join(codexRoot, "state", "plugins", "learning-booklet-studio");
}

function assertRunId(runId) {
  if (!SAFE_RUN_ID.test(runId || "")) {
    throw new Error("runId must contain only letters, numbers, dots, underscores, and hyphens.");
  }
}

function stableValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function sameValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function assertNonemptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function uniqueStringIds(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  const ids = values.map((value, index) => {
    assertNonemptyString(value, `${label}[${index}]`);
    return value;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} must contain unique ids.`);
  }
  return [...ids].sort();
}

function openInterruptIds(parent) {
  const declared = (parent.interrupts ?? [])
    .filter((entry) => entry?.status === "open")
    .map((entry) => entry?.id);
  if (
    declared.length > 0 &&
    parent.pendingDecision?.id &&
    !declared.includes(parent.pendingDecision.id)
  ) {
    throw new Error(`Workflow ${parent.runId} pending decision is not one of its open interrupts.`);
  }
  if (declared.length === 0 && parent.pendingDecision?.id) {
    declared.push(parent.pendingDecision.id);
  }
  return uniqueStringIds(declared, `Workflow ${parent.runId} open interrupt ids`);
}

function parseJsonFile(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unreadable or invalid JSON: ${error.message}`);
  }
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = openSync(directory, "r");
    fsyncSync(descriptor);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EPERM"].includes(error.code)) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function publishCompleteFile(target, contents) {
  const directory = path.dirname(target);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.candidate-${process.pid}-${randomUUID()}`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    try {
      linkSync(temporary, target);
      fsyncDirectory(directory);
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return false;
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function canonicalSnapshot(state) {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function canonicalEvents(state) {
  const events = state.events ?? [];
  return events.length > 0
    ? `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
    : "";
}

function parseEventLog(contents, label) {
  const lines = contents.split("\n").filter((line) => line.trim());
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${label} line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
}

function assertEventLogMatches(file, state) {
  const actual = parseEventLog(readFileSync(file, "utf8"), `Event log for ${state.runId}`);
  if (!sameValue(actual, state.events ?? [])) {
    throw new Error(`Event log for ${state.runId} does not match its canonical snapshot.`);
  }
}

function assertInitialChildMatchesReservation(current, initial) {
  const initialEvents = initial.events ?? [];
  const currentEvents = current.events ?? [];
  if (
    current.runId !== initial.runId ||
    current.threadId !== initial.threadId ||
    current.parentRunId !== initial.parentRunId ||
    !sameValue(current.resume, initial.resume) ||
    !sameValue(current.permissions?.projectionResume, initial.permissions?.projectionResume) ||
    currentEvents.length < initialEvents.length ||
    !sameValue(currentEvents.slice(0, initialEvents.length), initialEvents)
  ) {
    throw new Error(`Materialized child ${initial.runId} conflicts with its acceptance reservation.`);
  }
}

export function validateAcceptedChild(parent, child) {
  if (!parent || typeof parent !== "object") throw new Error("Accepted-child validation requires a parent.");
  if (!child || typeof child !== "object") throw new Error("Accepted-child validation requires a child.");
  assertRunId(parent.runId);
  assertRunId(child.runId);
  const childLog = validateEventLog(child);
  if (!childLog.valid) {
    throw new Error(`Accepted child ${child.runId} has an invalid canonical event log: ${childLog.errors.join("; ")}`);
  }
  assertNonemptyString(parent.threadId, "Parent threadId");
  if (parent.terminalOutcome !== "interrupt" || !parent.pendingDecision) {
    throw new Error(`Workflow ${parent.runId} is not a terminal run with an open decision.`);
  }
  if (child.runId === parent.runId) {
    throw new Error(`Accepted child ${child.runId} creates a direct lineage cycle.`);
  }
  if (child.parentRunId !== parent.runId) {
    throw new Error(`Accepted child ${child.runId} has the wrong parentRunId.`);
  }
  if (child.threadId !== parent.threadId) {
    throw new Error(`Accepted child ${child.runId} is not on the parent thread.`);
  }

  const receipt = child.permissions?.projectionResume;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error(`Accepted child ${child.runId} has no valid projectionResume receipt.`);
  }
  const missingReceiptKeys = RECEIPT_KEYS.filter((key) => !Object.hasOwn(receipt, key));
  if (missingReceiptKeys.length > 0) {
    throw new Error(`Accepted child ${child.runId} receipt is missing ${missingReceiptKeys.join(", ")}.`);
  }
  const unexpectedReceiptKeys = Object.keys(receipt).filter((key) => !RECEIPT_KEYS.includes(key));
  if (unexpectedReceiptKeys.length > 0) {
    throw new Error(
      `Accepted child ${child.runId} receipt has unsupported fields: ${unexpectedReceiptKeys.join(", ")}.`,
    );
  }
  if (receipt.acceptedBy !== "workflow_submit_decision") {
    throw new Error(`Accepted child ${child.runId} receipt has an invalid acceptedBy value.`);
  }
  if (receipt.parentRunId !== parent.runId || receipt.childRunId !== child.runId) {
    throw new Error(`Accepted child ${child.runId} receipt does not match its parent and child ids.`);
  }
  assertNonemptyString(receipt.commandId, "Accepted-child receipt commandId");
  assertNonemptyString(receipt.fingerprint, "Accepted-child receipt fingerprint");
  if (!/^[a-f0-9]{64}$/.test(receipt.fingerprint)) {
    throw new Error(`Accepted child ${child.runId} receipt fingerprint must be a lowercase SHA-256 digest.`);
  }
  assertNonemptyString(receipt.acceptedAt, "Accepted-child receipt acceptedAt");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.acceptedAt) ||
    Number.isNaN(Date.parse(receipt.acceptedAt)) ||
    new Date(receipt.acceptedAt).toISOString() !== receipt.acceptedAt ||
    receipt.acceptedAt !== child.createdAt
  ) {
    throw new Error(`Accepted child ${child.runId} receipt acceptedAt does not match child creation.`);
  }
  if (receipt.acceptedAt < parent.updatedAt) {
    throw new Error(`Accepted child ${child.runId} was created before its parent was last updated.`);
  }

  if (!Array.isArray(child.resume) || child.resume.length === 0) {
    throw new Error(`Accepted child ${child.runId} has no resume entries.`);
  }
  const resumeIds = uniqueStringIds(
    child.resume.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`Accepted child ${child.runId} resume[${index}] must be an object.`);
      }
      if (!Object.hasOwn(entry, "value")) {
        throw new Error(`Accepted child ${child.runId} resume[${index}] has no value.`);
      }
      return entry.interruptId;
    }),
    `Accepted child ${child.runId} resume interrupt ids`,
  );
  const receiptIds = uniqueStringIds(
    receipt.interruptIds,
    `Accepted child ${child.runId} receipt interrupt ids`,
  );
  const parentIds = openInterruptIds(parent);
  if (!sameValue(receiptIds, resumeIds) || !sameValue(receiptIds, parentIds)) {
    throw new Error(
      `Accepted child ${child.runId} receipt, resume, and parent open interrupt ids do not match.`,
    );
  }

  if (!Array.isArray(child.events) || child.events.length === 0) {
    throw new Error(`Accepted child ${child.runId} has no event log.`);
  }
  const first = child.events[0];
  if (
    first?.type !== "run.created" ||
    first.runId !== child.runId ||
    first.id !== `${child.runId}:1` ||
    first.seq !== 1 ||
    first.stateVersion !== 1
  ) {
    throw new Error(`Accepted child ${child.runId} does not begin with its canonical run.created event.`);
  }
  if (
    first.occurredAt !== child.createdAt ||
    first.payload?.schemaVersion !== child.schemaVersion ||
    first.payload?.mode !== child.mode ||
    first.payload?.threadId !== child.threadId ||
    first.payload?.parentRunId !== child.parentRunId ||
    !sameValue(first.payload?.resume, child.resume)
  ) {
    throw new Error(`Accepted child ${child.runId} run.created linkage does not match top-level state.`);
  }
  if (child.events.slice(1).some((event) => event?.type === "run.created")) {
    throw new Error(`Accepted child ${child.runId} has multiple run.created events.`);
  }
  return child;
}

export function createFileStore({ stateDir = defaultStateDirectory() } = {}) {
  const runsDir = path.join(stateDir, "runs");
  mkdirSync(runsDir, { recursive: true });

  function pathsFor(runId) {
    assertRunId(runId);
    const runDir = path.join(runsDir, runId);
    return {
      runDir,
      snapshot: path.join(runDir, "run-state.json"),
      events: path.join(runDir, "events.ndjson"),
      acceptance: path.join(runDir, ACCEPTANCE_FILE),
    };
  }

  function load(runId) {
    const files = pathsFor(runId);
    if (!existsSync(files.snapshot)) return null;
    return JSON.parse(readFileSync(files.snapshot, "utf8"));
  }

  function save(state) {
    const files = pathsFor(state.runId);
    mkdirSync(files.runDir, { recursive: true });
    const previous = existsSync(files.snapshot)
      ? JSON.parse(readFileSync(files.snapshot, "utf8"))
      : null;
    const previousCursor = previous?.eventCursor ?? 0;
    const newEvents = (state.events || []).filter((event) => event.seq > previousCursor);
    if (newEvents.length > 0) {
      appendFileSync(files.events, `${newEvents.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
    }
    const temp = `${files.snapshot}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(temp, files.snapshot);
    return state;
  }

  function list() {
    return readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SAFE_RUN_ID.test(entry.name))
      .map((entry) => load(entry.name))
      .filter(Boolean)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  function mutate(runId, mutation) {
    const current = load(runId);
    if (!current) throw new Error(`Unknown run: ${runId}`);
    const result = mutation(current);
    save(result.state);
    return result;
  }

  function acceptanceRecord(parentRunId) {
    const file = pathsFor(parentRunId).acceptance;
    return existsSync(file) ? parseJsonFile(file, `Decision acceptance for ${parentRunId}`) : null;
  }

  function validateReservation(parent, record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Decision acceptance for ${parent.runId} is invalid.`);
    }
    if (record.schemaVersion !== ACCEPTANCE_SCHEMA) {
      throw new Error(`Decision acceptance for ${parent.runId} has an unsupported schema.`);
    }
    if (
      record.parentRunId !== parent.runId ||
      record.threadId !== parent.threadId ||
      record.parentStateVersion !== parent.stateVersion
    ) {
      throw new Error(`Decision acceptance for ${parent.runId} does not match the parent state.`);
    }
    assertRunId(record.childRunId);
    assertNonemptyString(record.commandId, "Decision acceptance commandId");
    assertNonemptyString(record.fingerprint, "Decision acceptance fingerprint");
    assertNonemptyString(record.acceptedAt, "Decision acceptance acceptedAt");
    const child = validateAcceptedChild(parent, record.childState);
    const receipt = child.permissions.projectionResume;
    if (
      record.childRunId !== child.runId ||
      record.acceptedAt !== receipt.acceptedAt ||
      record.commandId !== receipt.commandId ||
      record.fingerprint !== receipt.fingerprint ||
      !sameValue(record.interruptIds, receipt.interruptIds)
    ) {
      throw new Error(`Decision acceptance for ${parent.runId} conflicts with its initial child state.`);
    }
    return record;
  }

  function reservationFrom(parent, { commandId, fingerprint, childState }) {
    assertNonemptyString(commandId, "Decision acceptance commandId");
    assertNonemptyString(fingerprint, "Decision acceptance fingerprint");
    const child = validateAcceptedChild(parent, childState);
    const receipt = child.permissions.projectionResume;
    if (receipt.commandId !== commandId || receipt.fingerprint !== fingerprint) {
      throw new Error("Accepted-child receipt command identity does not match the reservation request.");
    }
    return {
      schemaVersion: ACCEPTANCE_SCHEMA,
      parentRunId: parent.runId,
      parentStateVersion: parent.stateVersion,
      threadId: parent.threadId,
      childRunId: child.runId,
      interruptIds: [...receipt.interruptIds],
      commandId,
      fingerprint,
      acceptedAt: receipt.acceptedAt,
      childState: child,
    };
  }

  function reserveAcceptedChild(parentState, request) {
    const currentParent = load(parentState?.runId);
    if (!currentParent) throw new Error(`Unknown run: ${parentState?.runId}`);
    if (!sameValue(currentParent, parentState)) {
      throw new Error(`Workflow ${parentState.runId} changed before decision acceptance.`);
    }
    const candidate = reservationFrom(currentParent, request);
    const file = pathsFor(currentParent.runId).acceptance;
    const created = publishCompleteFile(file, canonicalSnapshot(candidate));
    const winner = validateReservation(
      currentParent,
      parseJsonFile(file, `Decision acceptance for ${currentParent.runId}`),
    );
    if (winner.commandId !== candidate.commandId || winner.fingerprint !== candidate.fingerprint) {
      throw new Error(`Workflow ${currentParent.runId} already accepted a different decision.`);
    }
    return { record: winner, created };
  }

  function materializeRecord(parent, record) {
    const validated = validateReservation(parent, record);
    const initial = validated.childState;
    const files = pathsFor(initial.runId);
    mkdirSync(files.runDir, { recursive: true });

    const existing = load(initial.runId);
    if (existing) {
      validateAcceptedChild(parent, existing);
      assertInitialChildMatchesReservation(existing, initial);
      if (existsSync(files.events)) {
        assertEventLogMatches(files.events, existing);
      } else {
        publishCompleteFile(files.events, canonicalEvents(existing));
        assertEventLogMatches(files.events, existing);
      }
      return { state: existing, created: false };
    }

    const eventsCreated = publishCompleteFile(files.events, canonicalEvents(initial));
    if (!eventsCreated) {
      const existingEvents = parseEventLog(
        readFileSync(files.events, "utf8"),
        `Event log for ${initial.runId}`,
      );
      if (!sameValue(existingEvents, initial.events ?? [])) {
        throw new Error(`Event log for ${initial.runId} conflicts with its acceptance reservation.`);
      }
    }
    const snapshotCreated = publishCompleteFile(files.snapshot, canonicalSnapshot(initial));
    const materialized = load(initial.runId);
    if (!materialized) {
      throw new Error(`Accepted child ${initial.runId} could not be materialized.`);
    }
    validateAcceptedChild(parent, materialized);
    assertInitialChildMatchesReservation(materialized, initial);
    assertEventLogMatches(files.events, materialized);
    return { state: materialized, created: snapshotCreated };
  }

  function materializeAcceptedChild(parentState, { commandId, fingerprint }) {
    const currentParent = load(parentState?.runId);
    if (!currentParent) throw new Error(`Unknown run: ${parentState?.runId}`);
    if (!sameValue(currentParent, parentState)) {
      throw new Error(`Workflow ${parentState.runId} changed before child materialization.`);
    }
    const record = acceptanceRecord(currentParent.runId);
    if (!record) throw new Error(`Workflow ${currentParent.runId} has no decision acceptance.`);
    const validated = validateReservation(currentParent, record);
    if (validated.commandId !== commandId || validated.fingerprint !== fingerprint) {
      throw new Error(`Workflow ${currentParent.runId} already accepted a different decision.`);
    }
    return materializeRecord(currentParent, validated);
  }

  function acceptAcceptedChild(parentState, request) {
    const reserved = reserveAcceptedChild(parentState, request);
    const materialized = materializeAcceptedChild(parentState, {
      commandId: reserved.record.commandId,
      fingerprint: reserved.record.fingerprint,
    });
    return {
      state: materialized.state,
      reservationCreated: reserved.created,
      childCreated: materialized.created,
    };
  }

  function legacyAcceptedChildren(parent) {
    const candidates = list().filter((state) => {
      const receipt = state.permissions?.projectionResume;
      return receipt !== undefined &&
        (receipt?.parentRunId === parent.runId || state.parentRunId === parent.runId);
    });
    for (const child of candidates) validateAcceptedChild(parent, child);
    return candidates;
  }

  function loadAcceptedChild(parentRunId) {
    assertRunId(parentRunId);
    const parent = load(parentRunId);
    if (!parent) return null;
    const record = acceptanceRecord(parentRunId);
    const reservedChild = record
      ? materializeRecord(parent, validateReservation(parent, record)).state
      : null;
    const children = legacyAcceptedChildren(parent);
    if (children.length > 1) {
      throw new Error(`Workflow ${parentRunId} has more than one accepted decision child.`);
    }
    if (reservedChild && children[0]?.runId !== reservedChild.runId) {
      throw new Error(`Workflow ${parentRunId} has conflicting accepted decision children.`);
    }
    return reservedChild || children[0] || null;
  }

  function loadLatestAcceptedDescendant(runId) {
    assertRunId(runId);
    let current = load(runId);
    if (!current) return null;
    const visited = new Set();
    while (current) {
      if (visited.has(current.runId)) {
        throw new Error(`Workflow ${runId} has a cyclic accepted-child lineage.`);
      }
      visited.add(current.runId);
      const child = loadAcceptedChild(current.runId);
      if (!child) return current;
      if (visited.has(child.runId)) {
        throw new Error(`Workflow ${runId} has a cyclic accepted-child lineage.`);
      }
      current = child;
    }
    return null;
  }

  return {
    stateDir,
    load,
    save,
    list,
    mutate,
    reserveAcceptedChild,
    materializeAcceptedChild,
    acceptAcceptedChild,
    loadAcceptedChild,
    loadLatestAcceptedDescendant,
    validateAcceptedChild,
  };
}
