#!/usr/bin/env node

import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import axe from "axe-core";
import { chromium } from "playwright";
import { toolResult } from "../../packages/mcp-server/presentation.mjs";
import { runNativeFailureRepairFixture } from "../../packages/workflow-engine/native-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const widgetPath = path.join(root, "packages", "widget", "dist", "mcp", "widget.html");
const fixturePath = path.join(root, "tests", "fixtures", "stringzilla-design-options.json");
const evidenceDirectory = path.join(root, "test-results", "e2e");
const viewportCases = [
  { width: 320, height: 900 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
];
const phaseIds = ["I0", "P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"];

function unresolvedProjection(designFixture) {
  return {
    protocol: "codex-skill-ui/1",
    runId: "run-widget-e2e-unresolved",
    topic: "String Search: From Scalar to SIMD",
    subtitle: "A native-host-ready design decision with authoritative unresolved state.",
    mode: "plan_then_build",
    status: "awaiting_user",
    currentLayer: "intent",
    currentPhase: "I0",
    stateVersion: 7,
    phases: phaseIds.map((id) => ({
      id,
      status: id === "I0" ? "awaiting_user" : "not_started",
    })),
    design: {
      ...designFixture,
      selectedOptionId: null,
      selectedName: null,
      selectionMethod: null,
      finalVisualDirection: null,
    },
  };
}

function resolvedProjection(unresolved) {
  const selected = unresolved.design.options[0];
  return {
    ...unresolved,
    runId: "run-widget-e2e-resolved",
    status: "active",
    currentLayer: "project",
    currentPhase: "P0",
    stateVersion: 8,
    phases: phaseIds.map((id) => ({
      id,
      status: id === "I0" ? "passed" : id === "P0" ? "active" : "not_started",
    })),
    design: {
      ...unresolved.design,
      selection: {
        method: "user-selected",
        selectedOptionId: selected.id,
      },
      selectedOptionId: selected.id,
      selectedName: selected.name,
      selectionMethod: "user-selected",
      finalVisualDirection: selected.visualDirection,
      system: Object.entries(selected.visualDirection),
    },
  };
}

function completedProjection() {
  const fixture = runNativeFailureRepairFixture({ now: "2026-07-22T12:00:00.000Z" });
  const state = structuredClone(fixture.state);
  const finalVisualDirection = {
    ...state.design.finalVisualDirection,
    colorRoles: {
      canvas: "#fff9ee",
      ink: "#14213d",
      route: "#2563eb",
    },
    structuredDiagnostics: {
      emptyObject: {},
      emptyArray: [],
      deep: { one: { two: { three: { four: "not rendered" } } } },
      large: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`role${index + 1}`, `value${index + 1}`])),
    },
  };
  state.design.finalVisualDirection = finalVisualDirection;
  return toolResult(state, "Rendered completed workflow fixture.").structuredContent.run;
}

async function startWidgetServer() {
  const html = readFileSync(widgetPath);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/favicon.ico") {
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
      return;
    }
    if (pathname !== "/" && pathname !== "/widget.html") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": html.length,
      "content-type": "text/html; charset=utf-8",
    });
    response.end(html);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object", "local widget server did not expose an address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function attachRuntimeGuards(context, origin, evidence) {
  context.on("request", (request) => {
    const url = request.url();
    if (/^https?:/i.test(url)) evidence.runtimeRequests.push(url);
  });
  context.on("requestfailed", (request) => {
    evidence.requestFailures.push({
      url: request.url(),
      failure: request.failure()?.errorText || "unknown request failure",
    });
  });
  return context.route("**/*", async (route) => {
    const url = route.request().url();
    if (/^https?:/i.test(url) && new URL(url).origin !== origin) {
      evidence.externalRequests.push(url);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

function attachPageGuards(page, evidence) {
  page.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
}

async function openProjection(context, origin, projection, viewport, evidence) {
  const page = await context.newPage();
  attachPageGuards(page, evidence);
  await page.setViewportSize(viewport);
  await page.addInitScript((toolOutput) => {
    window.openai = { ...(window.openai || {}), toolOutput };
  }, projection);
  await page.goto(`${origin}/widget.html`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1 }).waitFor();
  return page;
}

async function tabTo(page, target, maximumTabs = 100) {
  for (let tabCount = 1; tabCount <= maximumTabs; tabCount += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return tabCount;
  }
  throw new Error(`keyboard navigation did not reach the requested control within ${maximumTabs} Tab presses`);
}

async function assertVisibleKeyboardFocus(target) {
  const focus = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      active: element === document.activeElement,
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  assert.equal(focus.active, true, "keyboard target must own document focus");
  assert.equal(focus.focusVisible, true, "keyboard target must match :focus-visible");
  assert.notEqual(focus.outlineStyle, "none", "keyboard target must have a visible outline style");
  assert.ok(Number.parseFloat(focus.outlineWidth) >= 2, "keyboard target outline must be visibly thick");
  return focus;
}

async function auditAccessibility(page) {
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(async () => window.axe.run(document, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
    },
  }));
  return result.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target),
    }));
}

async function auditOverflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const phaseRail = document.querySelector(".phase-rail");
    return {
      viewportWidth: root.clientWidth,
      documentScrollWidth: Math.max(root.scrollWidth, body.scrollWidth),
      pageOverflows: Math.max(root.scrollWidth, body.scrollWidth) > root.clientWidth + 1,
      phaseRailOwnsOverflow: Boolean(phaseRail && phaseRail.scrollWidth > phaseRail.clientWidth),
    };
  });
}

test("built widget passes unresolved-decision, keyboard, responsive, accessibility, and offline-runtime checks", { timeout: 120_000 }, async (t) => {
  assert.equal(existsSync(widgetPath), true, "built MCP widget is missing; run the widget build first");
  const designFixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.equal(designFixture.options.length, 3, "fixture must contain exactly three design options");
  assert.equal(designFixture.options.filter((option) => option.recommended).length, 1, "fixture must contain exactly one recommendation");

  mkdirSync(evidenceDirectory, { recursive: true });
  const unresolved = unresolvedProjection(designFixture);
  const resolved = resolvedProjection(unresolved);
  const server = await startWidgetServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const evidence = {
    widget: path.relative(root, widgetPath),
    projection: {
      optionCount: unresolved.design.options.length,
      recommendationCount: unresolved.design.options.filter((option) => option.recommended).length,
      selectedOptionId: null,
    },
    keyboard: {},
    selectedState: {},
    completedState: { viewports: [] },
    errorBoundary: {},
    viewports: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    runtimeRequests: [],
    externalRequests: [],
  };

  try {
    await attachRuntimeGuards(context, server.origin, evidence);

    const keyboardPage = await openProjection(
      context,
      server.origin,
      unresolved,
      { width: 1440, height: 1000 },
      evidence,
    );
    const decisionPanel = keyboardPage.getByRole("region", { name: "Choose the learning experience" });
    assert.equal(await decisionPanel.getByRole("listitem").count(), 3, "unresolved widget must render exactly three design choices");
    assert.equal(await decisionPanel.locator(".is-recommended").count(), 1, "unresolved widget must render exactly one recommended choice");
    assert.equal(
      await decisionPanel.getByText("Recommended · nonbinding", { exact: true }).count(),
      1,
      "recommendation must remain nonbinding and unique",
    );

    await keyboardPage.keyboard.press("Tab");
    const skipLink = keyboardPage.getByRole("link", { name: "Skip to workflow" });
    evidence.keyboard.skipLinkFocus = await assertVisibleKeyboardFocus(skipLink);

    await keyboardPage.keyboard.press("Shift+Tab");
    const memoryLabButton = decisionPanel.getByRole("button", { name: "Select Memory Lab" });
    evidence.keyboard.tabsToDesignChoice = await tabTo(keyboardPage, memoryLabButton);
    evidence.keyboard.designChoiceFocus = await assertVisibleKeyboardFocus(memoryLabButton);
    await keyboardPage.keyboard.press("Enter");
    await keyboardPage.getByRole("status").filter({ hasText: "Standalone preview: Memory Lab selection simulated." }).waitFor();
    evidence.keyboard.activation = "pass";
    await keyboardPage.close();

    const selectedPage = await openProjection(
      context,
      server.origin,
      resolved,
      { width: 1440, height: 1000 },
      evidence,
    );
    await selectedPage.locator(".selected-pill").filter({ hasText: "Memory Lab" }).waitFor();
    const workshop = selectedPage.getByRole("button", { name: "Workshop" });
    assert.equal(await workshop.getAttribute("aria-current"), "page", "active workspace navigation must expose its selected state");
    assert.equal(
      await selectedPage.getByRole("button", { name: /^P0, Scope charter,/ }).getAttribute("aria-current"),
      "step",
      "current workflow phase must expose its selected state",
    );

    const desktopPreview = selectedPage.getByRole("button", { name: "desktop preview" });
    const tabletPreview = selectedPage.getByRole("button", { name: "tablet preview" });
    assert.equal(await desktopPreview.getAttribute("aria-pressed"), "true");
    assert.equal(await tabletPreview.getAttribute("aria-pressed"), "false");
    evidence.selectedState.tabsToTabletPreview = await tabTo(selectedPage, tabletPreview);
    evidence.selectedState.tabletFocus = await assertVisibleKeyboardFocus(tabletPreview);
    await selectedPage.keyboard.press("Space");
    assert.equal(await desktopPreview.getAttribute("aria-pressed"), "false");
    assert.equal(await tabletPreview.getAttribute("aria-pressed"), "true");

    const secondDesignDot = selectedPage.getByRole("button", { name: "Show Verification Observatory" });
    evidence.selectedState.tabsToSecondDesign = await tabTo(selectedPage, secondDesignDot);
    evidence.selectedState.carouselFocus = await assertVisibleKeyboardFocus(secondDesignDot);
    await selectedPage.keyboard.press("Enter");
    assert.equal(await secondDesignDot.getAttribute("aria-current"), "true");
    assert.equal(
      await selectedPage.getByRole("button", { name: "Show Learning Foundry" }).getAttribute("aria-current"),
      null,
    );
    evidence.selectedState.activation = "pass";
    await selectedPage.screenshot({
      path: path.join(evidenceDirectory, "widget-selected-1440x1000.png"),
      fullPage: false,
    });
    await selectedPage.close();

    for (const viewport of viewportCases) {
      const page = await openProjection(context, server.origin, unresolved, viewport, evidence);
      const overflow = await auditOverflow(page);
      const axeSeriousOrCritical = await auditAccessibility(page);
      const designButtons = await page.getByRole("button", { name: /^Select / }).evaluateAll((buttons) =>
        buttons.map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            name: button.textContent.trim().replace(/\s+/g, " "),
            left: rect.left,
            right: rect.right,
          };
        }));
      assert.equal(overflow.pageOverflows, false, `${viewport.width}px layout must not create page-level horizontal overflow`);
      for (const button of designButtons) {
        assert.ok(button.left >= -1, `${button.name} must not be clipped past the left viewport edge at ${viewport.width}px`);
        assert.ok(button.right <= viewport.width + 1, `${button.name} must not be clipped past the right viewport edge at ${viewport.width}px`);
      }
      assert.deepEqual(
        axeSeriousOrCritical,
        [],
        `${viewport.width}px layout has serious or critical axe findings: ${JSON.stringify(axeSeriousOrCritical)}`,
      );
      await page.screenshot({
        path: path.join(evidenceDirectory, `widget-unresolved-${viewport.width}x${viewport.height}.png`),
        fullPage: false,
      });
      evidence.viewports.push({
        ...viewport,
        ...overflow,
        visibleDesignButtons: designButtons.length,
        axeSeriousOrCritical,
      });
      await page.close();
    }

    const completed = completedProjection();
    assert.equal(completed.status, "completed", "production projection fixture must be terminal");
    assert.equal(completed.currentPhase, "P10", "production projection fixture must reach P10");
    for (const viewport of viewportCases) {
      const page = await openProjection(context, server.origin, completed, viewport, evidence);
      await page.getByText("Release pass", { exact: true }).waitFor();
      const structuredColorRoles = page.getByText(
        "canvas: #fff9ee · ink: #14213d · route: #2563eb",
        { exact: true },
      );
      await structuredColorRoles.waitFor();
      await page.getByText(/\[nested value omitted\]/).waitFor();
      await page.getByText(/\… \(\+4 more\)/).waitFor();
      const overflow = await auditOverflow(page);
      const axeSeriousOrCritical = await auditAccessibility(page);
      assert.equal(overflow.pageOverflows, false, `${viewport.width}px completed layout must not create page-level horizontal overflow`);
      assert.deepEqual(
        axeSeriousOrCritical,
        [],
        `${viewport.width}px completed layout has serious or critical axe findings: ${JSON.stringify(axeSeriousOrCritical)}`,
      );
      await page.screenshot({
        path: path.join(evidenceDirectory, `widget-completed-${viewport.width}x${viewport.height}.png`),
        fullPage: false,
      });
      evidence.completedState.viewports.push({
        ...viewport,
        ...overflow,
        axeSeriousOrCritical,
        structuredDesignValue: await structuredColorRoles.innerText(),
      });
      await page.close();
    }

    const boundaryPage = await context.newPage();
    const boundaryConsoleErrors = [];
    const boundaryPageErrors = [];
    boundaryPage.on("console", (message) => {
      if (message.type() === "error") boundaryConsoleErrors.push(message.text());
    });
    boundaryPage.on("pageerror", (error) => boundaryPageErrors.push(error.message));
    const invalidProjection = {
      ...resolved,
      currentWork: {
        title: "Invalid test projection",
        description: { unexpected: "object child" },
        attempt: 1,
        nextAction: { kind: "continue", label: "Continue", detail: "Test recovery." },
        actions: [["Continue", "Test recovery."]],
        locked: [],
      },
    };
    await boundaryPage.setViewportSize({ width: 768, height: 900 });
    await boundaryPage.addInitScript((toolOutput) => {
      window.openai = { ...(window.openai || {}), toolOutput };
    }, invalidProjection);
    await boundaryPage.goto(`${server.origin}/widget.html?standalone`, { waitUntil: "networkidle" });
    const renderAlert = boundaryPage.getByRole("alert");
    await renderAlert.getByRole("heading", { name: "The workflow view could not render" }).waitFor();
    const retryButton = renderAlert.getByRole("button", { name: "Try rendering again" });
    assert.equal(
      await retryButton.evaluate((element) => element === document.activeElement),
      true,
      "render recovery action must receive focus",
    );
    await boundaryPage.evaluate((toolOutput) => {
      window.openai = { ...(window.openai || {}), toolOutput };
    }, resolved);
    await retryButton.click();
    await boundaryPage.locator(".selected-pill").filter({ hasText: "Memory Lab" }).waitFor();
    assert.equal(await renderAlert.count(), 0, "retry must remount the workflow after the host snapshot is corrected");
    assert.ok(
      boundaryConsoleErrors.some((message) => message.includes("Learning Booklet Studio failed to render")),
      "error boundary must retain an explicit diagnostic message",
    );
    assert.deepEqual(boundaryPageErrors, [], "caught render errors must not escape as uncaught page errors");
    evidence.errorBoundary = {
      alert: "pass",
      focusedRecoveryAction: "pass",
      correctedSnapshotRemount: "pass",
      diagnosticConsoleErrors: boundaryConsoleErrors.length,
      uncaughtPageErrors: boundaryPageErrors.length,
    };
    await boundaryPage.close();

    assert.deepEqual(evidence.externalRequests, [], "widget must not attempt external runtime requests");
    assert.deepEqual(evidence.requestFailures, [], "widget must not have failed runtime requests");
    assert.deepEqual(evidence.consoleErrors, [], "widget must not emit console errors");
    assert.deepEqual(evidence.pageErrors, [], "widget must not emit uncaught page errors");
    assert.ok(evidence.runtimeRequests.length >= viewportCases.length * 2 + 3, "each browser journey must load the local widget");
    assert.ok(
      evidence.runtimeRequests.every((url) => new URL(url).origin === server.origin),
      "all HTTP runtime requests must remain on the ephemeral local widget origin",
    );

    writeFileSync(
      path.join(evidenceDirectory, "widget-e2e-report.json"),
      `${JSON.stringify({ ...evidence, result: "pass" }, null, 2)}\n`,
      "utf8",
    );
    t.diagnostic(`widget e2e evidence: ${JSON.stringify({
      result: "pass",
      viewports: evidence.viewports.map(({ width, height, pageOverflows, axeSeriousOrCritical }) => ({
        width,
        height,
        pageOverflows,
        seriousOrCriticalAxeFindings: axeSeriousOrCritical.length,
      })),
      keyboardActivation: evidence.keyboard.activation,
      selectedStateActivation: evidence.selectedState.activation,
      externalRuntimeRequests: evidence.externalRequests.length,
      consoleErrors: evidence.consoleErrors.length,
      pageErrors: evidence.pageErrors.length,
    })}`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
