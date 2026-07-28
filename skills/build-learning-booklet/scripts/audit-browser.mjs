#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const VIEWPORTS = [
  { name: "narrow", width: 320, height: 800 },
  { name: "medium", width: 768, height: 900 },
  { name: "wide", width: 1440, height: 1000 },
];

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: audit-browser.mjs --file <index.html> [--browser <chromium|firefox|webkit|all>] [--report <report.json>]");
  process.exit(2);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) usage(`Invalid argument near ${key ?? "end"}`);
    result[key.slice(2)] = value;
  }
  return result;
}

async function loadPlaywright() {
  for (const packageName of ["playwright", "@playwright/test"]) {
    try {
      const imported = await import(packageName);
      if (imported.chromium) return { packageName, api: imported };
      if (imported.default?.chromium) return { packageName, api: imported.default };
    } catch {
      // Try the next supported package name.
    }
  }
  return null;
}

function result(id, passed, summary, details = []) {
  return { id, status: passed ? "pass" : "fail", summary, details };
}

function notRunBrowser(name, reason) {
  return {
    browser: name,
    status: "not_run",
    checks: [],
    reason,
  };
}

async function launchBrowser(browserName, launcher) {
  try {
    return { browser: await launcher.launch({ headless: true }), runtime: "playwright-bundled" };
  } catch (defaultError) {
    if (browserName !== "chromium") return { error: defaultError };
    const candidates = [
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ].filter(Boolean);
    for (const executablePath of candidates) {
      try {
        await access(executablePath);
        const browser = await launcher.launch({ headless: true, executablePath });
        return { browser, runtime: executablePath };
      } catch {
        // Continue to the next explicitly resolved local browser.
      }
    }
    return { error: defaultError };
  }
}

async function keyboardAudit(page) {
  const expected = await page.evaluate(() => {
    const selector = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";
    const controls = [...document.querySelectorAll(selector)].filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    });
    return [...new Set(controls.map((element, index) => {
      const radioGroup = element instanceof HTMLInputElement && element.type === "radio" && element.name
        ? `radio:${element.name}`
        : `control:${index}`;
      element.dataset.auditFocusId = radioGroup;
      return radioGroup;
    }))];
  });

  await page.evaluate(() => {
    document.documentElement.dataset.auditScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    window.scrollTo(0, 0);
  });
  const reached = new Set();
  const invisibleFocus = [];
  const obscuredFocus = [];
  for (let index = 0; index < expected.length + 4; index += 1) {
    await page.keyboard.press("Tab");
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.scrollIntoView({ block: "center", inline: "nearest" });
      }
    });
    await page.waitForTimeout(10);
    const observation = await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active === document.body) return null;
      const style = getComputedStyle(active);
      const rect = active.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const top = document.elementFromPoint(x, y);
      const hasIndicator = (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
      const unobscured = Boolean(top && (top === active || active.contains(top) || top.contains(active)));
      return {
        id: active.dataset.auditFocusId ?? null,
        descriptor: `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ""}`,
        hasIndicator,
        unobscured,
      };
    });
    if (!observation) continue;
    if (observation.id) reached.add(observation.id);
    if (!observation.hasIndicator) invisibleFocus.push(observation.descriptor);
    if (!observation.unobscured) obscuredFocus.push(observation.descriptor);
    if (reached.size === expected.length) break;
  }
  await page.evaluate(() => {
    document.body.removeAttribute("tabindex");
    document.documentElement.style.scrollBehavior = document.documentElement.dataset.auditScrollBehavior ?? "";
    delete document.documentElement.dataset.auditScrollBehavior;
  });
  return {
    expected,
    reached: [...reached],
    missing: expected.filter((id) => !reached.has(id)),
    invisibleFocus: [...new Set(invisibleFocus)],
    obscuredFocus: [...new Set(obscuredFocus)],
  };
}

async function exerciseControls(page, fileUrl) {
  await page.goto(fileUrl, { waitUntil: "load" });
  const totalButtons = await page.locator("button:not([disabled])").count();
  const failures = [];
  let executed = 0;
  for (let index = 0; index < totalButtons; index += 1) {
    await page.goto(fileUrl, { waitUntil: "load" });
    const button = page.locator("button:not([disabled])").nth(index);
    if (!await button.isVisible()) continue;
    try {
      await button.click({ timeout: 3000 });
      await page.waitForTimeout(25);
      executed += 1;
    } catch (error) {
      failures.push(`button ${index + 1}: ${error.message}`);
    }
  }

  await page.goto(fileUrl, { waitUntil: "load" });
  const rangeCount = await page.locator("input[type=range]:not([disabled])").count();
  for (let index = 0; index < rangeCount; index += 1) {
    try {
      const control = page.locator("input[type=range]:not([disabled])").nth(index);
      await control.focus();
      await page.keyboard.press("ArrowRight");
      executed += 1;
    } catch (error) {
      failures.push(`range ${index + 1}: ${error.message}`);
    }
  }
  return { totalButtons, rangeCount, executed, failures };
}

async function runBrowser(browserName, launcher, fileUrl) {
  const launched = await launchBrowser(browserName, launcher);
  if (!launched.browser) return notRunBrowser(browserName, `Browser runtime unavailable: ${launched.error.message}`);
  const { browser, runtime } = launched;

  const checks = [];
  const consoleErrors = [];
  const pageErrors = [];
  const networkRequests = [];
  let currentContext = "initial";
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (/^https?:/i.test(url)) {
        networkRequests.push({ url, method: route.request().method(), context: currentContext });
        await route.abort("blockedbyclient");
      } else {
        await route.continue();
      }
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push({ text: message.text(), context: currentContext });
    });
    page.on("pageerror", (error) => pageErrors.push({ text: error.message, context: currentContext }));

    const viewportFindings = [];
    for (const viewport of VIEWPORTS) {
      currentContext = `viewport:${viewport.name}`;
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(fileUrl, { waitUntil: "load" });
      const finding = await page.evaluate(() => {
        const missingFragments = [...document.querySelectorAll("a[href^='#']")]
          .map((anchor) => anchor.getAttribute("href"))
          .filter((href) => href && href.length > 1 && !document.getElementById(decodeURIComponent(href.slice(1))));
        const main = document.querySelector("main");
        return {
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          missingFragments,
          mainVisible: Boolean(main && main.getBoundingClientRect().width > 0 && main.getBoundingClientRect().height > 0),
        };
      });
      viewportFindings.push({ ...viewport, ...finding });
    }
    checks.push(result(
      "responsive.viewports",
      viewportFindings.every(({ horizontalOverflow, mainVisible }) => horizontalOverflow <= 1 && mainVisible),
      "The main document renders without unintended page overflow at 320, 768, and 1440 CSS pixels.",
      viewportFindings,
    ));
    checks.push(result(
      "navigation.internal_links",
      viewportFindings.every(({ missingFragments }) => missingFragments.length === 0),
      "Internal fragment links resolve in the rendered document.",
      viewportFindings.flatMap(({ name, missingFragments }) => missingFragments.map((href) => `${name}:${href}`)),
    ));

    currentContext = "keyboard";
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(fileUrl, { waitUntil: "load" });
    const keyboard = await keyboardAudit(page);
    checks.push(result(
      "keyboard.reachability",
      keyboard.expected.length > 0 && keyboard.missing.length === 0,
      "Rendered interactive controls are reachable through sequential keyboard navigation.",
      keyboard,
    ));
    checks.push(result(
      "keyboard.focus_indicator",
      keyboard.invisibleFocus.length === 0,
      "Keyboard-focused controls expose a computed outline or box-shadow indicator.",
      keyboard.invisibleFocus,
    ));
    checks.push(result(
      "keyboard.focus_visibility",
      keyboard.obscuredFocus.length === 0,
      "Keyboard-focused controls are not obscured at their center point.",
      keyboard.obscuredFocus,
    ));

    currentContext = "controls";
    const controls = await exerciseControls(page, fileUrl);
    checks.push(result(
      "behavior.controls",
      controls.executed > 0 && controls.failures.length === 0,
      "Visible buttons and range controls complete a basic execution smoke test.",
      controls,
    ));

    currentContext = "reduced-motion";
    await page.emulateMedia({ media: "screen", reducedMotion: "reduce" });
    await page.goto(fileUrl, { waitUntil: "load" });
    const activeMotion = await page.evaluate(() => document.getAnimations()
      .filter((animation) => animation.playState === "running")
      .map((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return { duration: timing?.duration ?? null, iterations: timing?.iterations ?? null };
      })
      .filter(({ duration }) => typeof duration === "number" && duration > 1));
    checks.push(result("motion.reduced", activeMotion.length === 0, "Reduced-motion mode has no substantive running animation after load.", activeMotion));

    currentContext = "print";
    await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
    await page.goto(fileUrl, { waitUntil: "load" });
    const printMainVisible = await page.locator("main").isVisible();
    checks.push(result("presentation.print", printMainVisible, "Primary content remains visible in print media mode."));

    currentContext = "offline-reload";
    await page.emulateMedia({ media: "screen", reducedMotion: "reduce" });
    await page.goto(fileUrl, { waitUntil: "load" });
    await context.setOffline(true);
    let offlineReload = true;
    let offlineReason = null;
    try {
      await page.reload({ waitUntil: "load" });
      offlineReload = await page.locator("main").isVisible();
    } catch (error) {
      offlineReload = false;
      offlineReason = error.message;
    }
    await context.setOffline(false);
    checks.push(result("portability.offline_reload", offlineReload, "The file reloads with browser networking disabled.", offlineReason ? [offlineReason] : []));

    checks.push(result("privacy.no_runtime_requests", networkRequests.length === 0, "No HTTP(S) request was emitted during the executed browser audit.", networkRequests));
    checks.push(result("runtime.console", consoleErrors.length === 0 && pageErrors.length === 0, "No console error or uncaught page error occurred.", { consoleErrors, pageErrors }));

    await context.close();
  } catch (error) {
    checks.push(result("browser.audit_execution", false, "The browser audit encountered an operational failure after launch.", [error.message]));
  } finally {
    await browser.close();
  }

  return {
    browser: browserName,
    runtime,
    status: checks.every(({ status }) => status === "pass") ? "pass" : "fail",
    checks,
  };
}

const options = parseArgs(process.argv.slice(2));
if (!options.file) usage("--file is required");
const browserOption = options.browser ?? "chromium";
if (!["chromium", "firefox", "webkit", "all"].includes(browserOption)) usage(`Unsupported browser: ${browserOption}`);

const file = path.resolve(options.file);
let source;
try {
  source = await readFile(file, "utf8");
} catch (error) {
  console.error(`${JSON.stringify({ status: "not_run", file, reason: error.message }, null, 2)}\n`);
  process.exit(2);
}

const loaded = await loadPlaywright();
if (!loaded) {
  const report = {
    status: "not_run",
    kind: "browser_audit",
    file,
    artifactHash: `sha256:${createHash("sha256").update(source).digest("hex")}`,
    checkedAt: new Date().toISOString(),
    reason: "Playwright is not installed; browser, keyboard, responsive, console, and offline execution checks were not run.",
    browsers: [],
  };
  if (options.report) {
    const reportPath = path.resolve(options.report);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.error(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(2);
}

const browserNames = browserOption === "all" ? ["chromium", "firefox", "webkit"] : [browserOption];
const browserResults = [];
const fileUrl = pathToFileURL(file).href;
for (const browserName of browserNames) {
  browserResults.push(await runBrowser(browserName, loaded.api[browserName], fileUrl));
}

const executed = browserResults.filter(({ status }) => status !== "not_run");
const unavailable = browserResults.filter(({ status }) => status === "not_run");
const status = executed.length === 0
  ? "not_run"
  : executed.some(({ status: browserStatus }) => browserStatus === "fail")
    ? "fail"
    : unavailable.length > 0
      ? "partial"
      : "pass";
const report = {
  status,
  kind: "browser_audit",
  runner: loaded.packageName,
  file,
  artifactHash: `sha256:${createHash("sha256").update(source).digest("hex")}`,
  checkedAt: new Date().toISOString(),
  viewports: VIEWPORTS,
  browsers: browserResults,
  limitations: [
    "This smoke audit does not prove factual correctness, instructional effectiveness, complete WCAG conformance, screen-reader behavior, or behavior in unexecuted browsers.",
    "Manual expert, learner, contrast, zoom, and assistive-technology inspections must be recorded separately when required.",
  ],
};
if (options.report) {
  const reportPath = path.resolve(options.report);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(status === "pass" ? 0 : status === "not_run" ? 2 : 1);
