#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import {
  applyCommand,
  createRunState,
  resumeRunState,
  stableStringify,
  validateEventLog,
} from "../workflow-engine/index.mjs";
import { compactRun, toolResult } from "./presentation.mjs";
import { createFileStore } from "./store.mjs";

export const PROTOCOL = "codex-skill-ui/1";
export const WIDGET_URI = "ui://learning-booklet-studio/workflow-v1.html";
const MAX_PUBLISH_BYTES = 1024 * 1024;
const MAX_EVENT_PAGE = 200;

const runOutputSchema = z.object({
  protocol: z.literal(PROTOCOL),
  run: z.record(z.string(), z.unknown()),
});

const eventOutputSchema = z.object({
  protocol: z.literal(PROTOCOL),
  run: z.record(z.string(), z.unknown()),
  events: z.array(z.record(z.string(), z.unknown())),
  nextSeq: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

function fingerprint(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function generatedRunId(commandId) {
  const seed = commandId || randomUUID();
  return `run-${fingerprint(seed).slice(0, 16)}`;
}

function requireExactRun(store, runId) {
  const state = runId ? store.load(runId) : store.list()[0];
  if (!state) throw new Error(runId ? `Unknown run: ${runId}` : "No workflow run exists yet.");
  return state;
}

function requireRun(store, runId) {
  const state = runId
    ? store.loadLatestAcceptedDescendant(runId)
    : store.list()[0];
  if (!state) throw new Error(runId ? `Unknown run: ${runId}` : "No workflow run exists yet.");
  return state;
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

const SERVER_OWNED_PERMISSION_KEYS = ["projectionCreate", "projectionResume"];

function preserveServerOwnedPermissions(current, snapshot) {
  const incomingPermissions = { ...(snapshot.permissions || {}) };
  const currentPermissions = { ...(current?.permissions || {}) };
  const ordinaryIncoming = Object.fromEntries(
    Object.entries(incomingPermissions).filter(([key]) => !SERVER_OWNED_PERMISSION_KEYS.includes(key)),
  );
  const ordinaryCurrent = Object.fromEntries(
    Object.entries(currentPermissions).filter(([key]) => !SERVER_OWNED_PERMISSION_KEYS.includes(key)),
  );
  if (fingerprint(ordinaryIncoming) !== fingerprint(ordinaryCurrent)) {
    throw new Error("Published snapshot cannot introduce, remove, or change workflow permissions.");
  }
  for (const key of SERVER_OWNED_PERMISSION_KEYS) {
    const currentReceipt = currentPermissions[key];
    const incomingReceipt = incomingPermissions[key];
    if (!currentReceipt) {
      if (incomingReceipt !== undefined) {
        throw new Error(`${key} is server-owned and cannot be introduced by workflow_publish.`);
      }
      continue;
    }
    if (incomingReceipt !== undefined && fingerprint(incomingReceipt) !== fingerprint(currentReceipt)) {
      throw new Error(`${key} is server-owned and cannot be changed by workflow_publish.`);
    }
    incomingPermissions[key] = currentReceipt;
  }
  return { ...snapshot, permissions: incomingPermissions };
}

function assertCanonicalRunIdentity(current, snapshot) {
  const identityFields = ["schemaVersion", "runId", "threadId", "parentRunId", "resume", "mode", "createdAt"];
  for (const field of identityFields) {
    if (fingerprint(snapshot[field]) !== fingerprint(current[field])) {
      throw new Error(`Published snapshot cannot change canonical run identity field ${field}.`);
    }
  }
}

function assertCanonicalEventPrefix(current, snapshot) {
  if (!Array.isArray(snapshot.events) || snapshot.events.length < current.events.length) {
    throw new Error("Published snapshot cannot remove canonical event history.");
  }
  const incomingPrefix = snapshot.events.slice(0, current.events.length);
  if (fingerprint(incomingPrefix) !== fingerprint(current.events)) {
    throw new Error("Published snapshot cannot rewrite canonical event history.");
  }
}

function assertAcceptedChildReceipt(state) {
  const receipt = state.permissions?.projectionResume;
  if (!receipt) return;
  const resumeIds = (state.resume || []).map(({ interruptId }) => interruptId);
  if (
    receipt.acceptedBy !== "workflow_submit_decision" ||
    receipt.parentRunId !== state.parentRunId ||
    receipt.childRunId !== state.runId ||
    fingerprint(receipt.interruptIds || []) !== fingerprint(resumeIds)
  ) {
    throw new Error("Accepted-child receipt does not match canonical run lineage.");
  }
}

function safeProjectionValue(value, key = "") {
  const normalized = String(key).toLowerCase();
  if (/(secret|token|credential|authorization|sourcebody|rawprompt|chainofthought)/.test(normalized)) {
    return "[redacted]";
  }
  if (normalized === "resume" && Array.isArray(value)) {
    return value.slice(0, 200).map((entry) => ({
      interruptId: safeProjectionValue(entry?.interruptId, "interruptId"),
    }));
  }
  if (typeof value === "string") {
    if (/^(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(value)) return "[workspace-relative path redacted]";
    return value.length > 4_096 ? `${value.slice(0, 4_096)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => safeProjectionValue(entry, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([entryKey]) => !/(sourcebody|rawprompt|chainofthought)/i.test(entryKey))
        .map(([entryKey, entryValue]) => [entryKey, safeProjectionValue(entryValue, entryKey)]),
    );
  }
  return value;
}

function readWidgetHtml() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../widget/widget.html"),
    path.resolve(here, "../widget/dist/mcp/widget.html"),
  ];
  const widgetPath = candidates.find((candidate) => existsSync(candidate));
  if (!widgetPath) {
    throw new Error("The MCP widget has not been built. Run npm run build:widget first.");
  }
  return readFileSync(widgetPath, "utf8");
}

function uiMeta(visibility) {
  return {
    ui: {
      resourceUri: WIDGET_URI,
      visibility,
    },
  };
}

function annotations({ readOnly = false, destructive = false, idempotent = true } = {}) {
  return {
    readOnlyHint: readOnly,
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: false,
  };
}

function successWithRun(state, message, meta) {
  return toolResult(state, message, meta);
}

function createProjection(store, args) {
  const commandId = args.commandId || randomUUID();
  const runId = args.runId || generatedRunId(commandId);
  const creationInput = {
    mode: args.mode,
    intent: args.intent || {},
    designRequired: args.designRequired,
    threadId: args.threadId || runId,
  };
  const creationFingerprint = fingerprint(creationInput);
  const existing = store.load(runId);
  if (existing) {
    const recorded = existing.permissions?.projectionCreate;
    if (recorded?.commandId !== commandId || recorded?.fingerprint !== creationFingerprint) {
      throw new Error(`Run ${runId} already exists with a different creation command.`);
    }
    return existing;
  }
  const state = createRunState({
    runId,
    threadId: args.threadId || runId,
    mode: args.mode,
    intent: args.intent || {},
    designRequired: args.designRequired,
    permissions: {
      projectionCreate: { commandId, fingerprint: creationFingerprint },
    },
  });
  store.save(state);
  return state;
}

function publishSnapshot(store, runId, snapshot) {
  if (byteLength(snapshot) > MAX_PUBLISH_BYTES) {
    throw new Error(`Published snapshot exceeds the ${MAX_PUBLISH_BYTES}-byte limit.`);
  }
  if (snapshot?.runId !== runId) throw new Error("Published snapshot runId does not match the target run.");
  const current = store.load(runId);
  if (!current) {
    throw new Error("workflow_publish cannot create a run; use workflow_create or workflow_submit_decision first.");
  }
  const logValidation = validateEventLog(snapshot);
  if (!logValidation.valid) throw new Error(`Published snapshot has an invalid event log: ${logValidation.errors.join("; ")}`);
  assertCanonicalRunIdentity(current, snapshot);
  assertCanonicalEventPrefix(current, snapshot);
  const publishable = preserveServerOwnedPermissions(current, snapshot);
  assertAcceptedChildReceipt(publishable);
  if (publishable.stateVersion < current.stateVersion) {
    throw new Error(`Published snapshot is stale: revision ${publishable.stateVersion} < ${current.stateVersion}.`);
  }
  if (publishable.stateVersion > current.stateVersion) {
    throw new Error(
      "Raw snapshots cannot advance workflow state; apply one typed workflow_publish command instead.",
    );
  }
  if (publishable.stateVersion === current.stateVersion) {
    if (fingerprint(publishable) !== fingerprint(current)) {
      throw new Error("Published snapshot conflicts with the current revision.");
    }
    return current;
  }
  throw new Error("Published snapshot revision could not be reconciled.");
}

function applyStoredCommand(store, runId, command) {
  const current = requireExactRun(store, runId);
  const requestedTime = command?.payload?.meta?.now;
  if (requestedTime !== undefined) {
    const parsed = Date.parse(requestedTime);
    if (Number.isNaN(parsed) || parsed > Date.now()) {
      throw new Error("Typed workflow command timestamp is invalid or in the future.");
    }
  }
  const result = applyCommand(current, command);
  const logValidation = validateEventLog(result.state);
  if (!logValidation.valid) {
    throw new Error(`Typed workflow command produced an invalid event log: ${logValidation.errors.join("; ")}`);
  }
  store.save(result.state);
  return result;
}

function decisionResumeValue(parent, command) {
  const pendingType = parent.pendingDecision?.type;
  if (command.type === "design.select" && pendingType === "design_selection") {
    return { selection: command.payload.selection };
  }
  if (command.type === "intent.patch" && pendingType === "intent") {
    return { patch: command.payload.patch };
  }
  throw new Error(
    `Command ${command.type} cannot resolve the open ${pendingType || "unknown"} decision.`,
  );
}

function resumeStoredDecision(store, runId, { commandId, expectedStateVersion, command }) {
  const parent = requireExactRun(store, runId);
  const decisionFingerprint = fingerprint({ expectedStateVersion, command });
  const acceptedChild = store.loadAcceptedChild(parent.runId);
  if (acceptedChild) {
    const receipt = acceptedChild.permissions?.projectionResume;
    if (receipt.commandId !== commandId || receipt.fingerprint !== decisionFingerprint) {
      throw new Error(`Workflow ${parent.runId} already accepted a different decision.`);
    }
    return { state: acceptedChild, resumedChild: true, recovered: true };
  }

  if (parent.terminalOutcome !== "interrupt") {
    const result = applyStoredCommand(store, runId, {
      ...command,
      expectedStateVersion,
      idempotencyKey: commandId,
    });
    return { state: result.state, resumedChild: false, recovered: false };
  }

  if (parent.stateVersion !== expectedStateVersion) {
    throw new Error(
      `Expected state version ${expectedStateVersion}; current version is ${parent.stateVersion}.`,
    );
  }
  const interruptId = parent.pendingDecision?.id;
  if (!interruptId) throw new Error(`Workflow ${parent.runId} has no open decision to resume.`);
  let childRunId;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `run-${randomUUID()}`;
    if (!store.load(candidate)) {
      childRunId = candidate;
      break;
    }
  }
  if (!childRunId) throw new Error("Could not allocate a unique child workflow id.");

  const wallClock = new Date().toISOString();
  const acceptedAt = parent.updatedAt > wallClock ? parent.updatedAt : wallClock;
  const child = resumeRunState(parent, {
    runId: childRunId,
    threadId: parent.threadId,
    resume: [{ interruptId, value: decisionResumeValue(parent, command) }],
    now: acceptedAt,
  });
  const inheritedPermissions = { ...(child.permissions || {}) };
  delete inheritedPermissions.projectionCreate;
  delete inheritedPermissions.projectionResume;
  child.permissions = {
    ...inheritedPermissions,
    projectionResume: {
      acceptedBy: "workflow_submit_decision",
      parentRunId: parent.runId,
      childRunId,
      interruptIds: [interruptId],
      commandId,
      fingerprint: decisionFingerprint,
      acceptedAt,
    },
  };
  const accepted = store.acceptAcceptedChild(parent, {
    commandId,
    fingerprint: decisionFingerprint,
    childState: child,
  });
  return {
    state: accepted.state,
    resumedChild: true,
    recovered: !accepted.reservationCreated,
  };
}

export function registerWorkflowSurface(server, { store = createFileStore() } = {}) {
  registerAppResource(
    server,
    "Learning Booklet Studio workflow",
    WIDGET_URI,
    {
      description: "In-place, inspect-and-decide workflow for a verified interactive learning booklet.",
      _meta: {
        ui: {
          csp: {
            connectDomains: [],
            resourceDomains: [],
            frameDomains: [],
          },
          prefersBorder: false,
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readWidgetHtml(),
          _meta: {
            ui: {
              csp: {
                connectDomains: [],
                resourceDomains: [],
                frameDomains: [],
              },
              prefersBorder: false,
            },
            "openai/widgetDescription":
              "A guided Studio Path view of learning-booklet intent, phases, design decisions, evidence, and repair state.",
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "workflow_create",
    {
      title: "Create learning-booklet workflow",
      description:
        "Create an idempotent local workflow projection. This records state only; it does not invoke a skill or begin execution.",
      inputSchema: z
        .object({
          commandId: z.string().min(1).max(128),
          runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/).optional(),
          threadId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/).optional(),
          mode: z.enum(["manifest_only", "plan_only", "plan_then_build"]).default("plan_then_build"),
          intent: z.record(z.string(), z.unknown()).default({}),
          designRequired: z.boolean().default(true),
        })
        .strict(),
      outputSchema: runOutputSchema,
      annotations: annotations(),
      _meta: uiMeta(["model", "app"]),
    },
    async (args) => {
      const state = createProjection(store, args);
      return successWithRun(
        state,
        `Created workflow ${state.runId}. Use the build-learning-booklet skill to execute it; this tool created state only.`,
        { launchMessage: `Resume $build-learning-booklet for run ${state.runId}.` },
      );
    },
  );

  registerAppTool(
    server,
    "workflow_publish",
    {
      title: "Publish workflow projection",
      description:
        "Reconcile an identical current snapshot or apply one typed engine command, then return a sanitized projection for the widget. Raw snapshots cannot advance state.",
      inputSchema: z
        .object({
          runId: z.string().min(1).max(128),
          snapshot: z.record(z.string(), z.unknown()).optional(),
          command: z
            .object({
              type: z.string().min(1),
              payload: z.record(z.string(), z.unknown()).optional(),
              expectedStateVersion: z.number().int().nonnegative().optional(),
              idempotencyKey: z.string().min(1).max(160).optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .superRefine((value, context) => {
          if (Boolean(value.snapshot) === Boolean(value.command)) {
            context.addIssue({ code: "custom", message: "Provide exactly one of snapshot or command." });
          }
        }),
      outputSchema: runOutputSchema,
      annotations: annotations(),
      _meta: uiMeta(["model"]),
    },
    async ({ runId, snapshot, command }) => {
      const state = snapshot
        ? publishSnapshot(store, runId, snapshot)
        : applyStoredCommand(store, runId, command).state;
      return successWithRun(state, `Published workflow ${runId} at state version ${state.stateVersion}.`);
    },
  );

  registerAppTool(
    server,
    "workflow_get",
    {
      title: "Get learning-booklet workflow",
      description: "Read the latest sanitized workflow projection without changing state.",
      inputSchema: z.object({ runId: z.string().min(1).max(128).optional() }).strict(),
      outputSchema: runOutputSchema,
      annotations: annotations({ readOnly: true }),
      _meta: uiMeta(["model", "app"]),
    },
    async ({ runId }) => {
      const state = requireRun(store, runId);
      return successWithRun(state, `Workflow ${state.runId} is at state version ${state.stateVersion}.`);
    },
  );

  registerAppTool(
    server,
    "workflow_events",
    {
      title: "Get workflow events",
      description: "Read a bounded page of sanitized workflow events after a cursor without changing state.",
      inputSchema: z
        .object({
          runId: z.string().min(1).max(128),
          afterSeq: z.number().int().nonnegative().default(0),
          limit: z.number().int().min(1).max(MAX_EVENT_PAGE).default(50),
        })
        .strict(),
      outputSchema: eventOutputSchema,
      annotations: annotations({ readOnly: true }),
      _meta: uiMeta(["app"]),
    },
    async ({ runId, afterSeq, limit }) => {
      const state = requireRun(store, runId);
      const all = state.events.filter((event) => event.seq > afterSeq);
      const page = all.slice(0, limit).map((event) => safeProjectionValue(event));
      const nextSeq = page.at(-1)?.seq ?? afterSeq;
      return {
        structuredContent: {
          protocol: PROTOCOL,
          run: compactRun(state),
          events: page,
          nextSeq,
          hasMore: all.length > page.length,
        },
        content: [{ type: "text", text: `Returned ${page.length} workflow events after sequence ${afterSeq}.` }],
        _meta: { stateVersion: state.stateVersion, eventCursor: state.eventCursor },
      };
    },
  );

  registerAppTool(
    server,
    "workflow_submit_decision",
    {
      title: "Submit workflow decision",
      description:
        "Record one idempotent answer to an open workflow decision. This does not invoke the skill; the widget must separately request agent-mediated continuation.",
      inputSchema: z
        .object({
          runId: z.string().min(1).max(128),
          commandId: z.string().min(1).max(160),
          expectedStateVersion: z.number().int().nonnegative(),
          command: z
            .object({
              type: z.enum(["intent.patch", "design.select"]),
              payload: z.record(z.string(), z.unknown()),
            })
            .strict(),
        })
        .strict(),
      outputSchema: runOutputSchema,
      annotations: annotations(),
      _meta: uiMeta(["app"]),
    },
    async ({ runId, commandId, expectedStateVersion, command }) => {
      const result = resumeStoredDecision(store, runId, {
        commandId,
        expectedStateVersion,
        command,
      });
      const targetRunId = result.state.runId;
      return successWithRun(
        result.state,
        result.resumedChild
          ? `Recorded the decision for workflow ${runId} in same-thread child ${targetRunId}. Ask Codex to resume the build-learning-booklet skill from authoritative state.`
          : `Recorded the decision for workflow ${runId}. Ask Codex to resume the build-learning-booklet skill from authoritative state.`,
        {
          decisionAccepted: true,
          resumedChild: result.resumedChild,
          recoveredExistingChild: result.recovered,
          parentRunId: result.resumedChild ? runId : null,
          childRunId: result.resumedChild ? targetRunId : null,
        },
      );
    },
  );

  registerAppTool(
    server,
    "workflow_render",
    {
      title: "Render learning-booklet workflow",
      description: "Attach the in-place Studio Path widget for a workflow and return a concise sanitized state summary.",
      inputSchema: z.object({ runId: z.string().min(1).max(128).optional() }).strict(),
      outputSchema: runOutputSchema,
      annotations: annotations({ readOnly: true }),
      _meta: uiMeta(["model"]),
    },
    async ({ runId }) => {
      const state = requireRun(store, runId);
      return successWithRun(
        state,
        `Rendered workflow ${state.runId}: ${state.status}, current phase ${state.currentPhase}, state version ${state.stateVersion}.`,
      );
    },
  );

  registerAppTool(
    server,
    "workflow_cancel_request",
    {
      title: "Request workflow cancellation",
      description:
        "Record cancellation intent only. It does not kill a local process or mark the workflow cancelled without later engine acknowledgement.",
      inputSchema: z
        .object({
          runId: z.string().min(1).max(128),
          commandId: z.string().min(1).max(160),
          expectedStateVersion: z.number().int().nonnegative(),
          reason: z.string().max(1_000).optional(),
        })
        .strict(),
      outputSchema: runOutputSchema,
      annotations: annotations({ destructive: true }),
      _meta: uiMeta(["app"]),
    },
    async ({ runId, commandId, expectedStateVersion, reason }) => {
      const result = applyStoredCommand(store, runId, {
        type: "input.request",
        expectedStateVersion,
        idempotencyKey: commandId,
        payload: {
          request: {
            type: "cancel_request",
            fields: [],
            prompt: reason || "User requested workflow cancellation; await agent acknowledgement.",
          },
        },
      });
      return successWithRun(
        result.state,
        `Cancellation was requested for ${runId}; no claim is made that local execution has stopped.`,
        { cancelRequested: true },
      );
    },
  );

  return { server, store };
}

export function createWorkflowServer({ store } = {}) {
  const server = new McpServer(
    { name: "learning-booklet-studio", version: "0.1.3" },
    {
      instructions:
        "Use workflow tools as a projection boundary. The build-learning-booklet skill and local engine remain authoritative; the widget never invokes them directly.",
    },
  );
  registerWorkflowSurface(server, { store: store || createFileStore() });
  return server;
}

export async function main() {
  const server = createWorkflowServer();
  await server.connect(new StdioServerTransport());
  console.error("Learning Booklet Studio MCP server is running on stdio.");
}

const directEntry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === directEntry) {
  main().catch((error) => {
    console.error(`Learning Booklet Studio MCP server failed: ${error.message}`);
    process.exitCode = 1;
  });
}
