#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: audit-html.mjs --file <index.html> [--report <report.json>]");
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

function attribute(source, name) {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function openingTags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map((match) => ({ raw: match[0], attributes: match[1] }));
}

function pairedTags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}\\s*>`, "gi"))]
    .map((match) => ({ raw: match[0], attributes: match[1], content: match[2] }));
}

function visibleText(source) {
  return source
    .replaceAll(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replaceAll(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function isEmbeddedResource(value) {
  return /^(?:data:|#|about:blank$)/i.test(String(value).trim());
}

function check(id, passed, summary, details = []) {
  return { id, status: passed ? "pass" : "fail", summary, details };
}

const options = parseArgs(process.argv.slice(2));
if (!options.file) usage("--file is required");

const file = path.resolve(options.file);
let html;
try {
  html = await readFile(file, "utf8");
} catch (error) {
  console.error(`${JSON.stringify({ status: "not_run", file, reason: error.message }, null, 2)}\n`);
  process.exit(2);
}

const checks = [];
const ids = openingTags(html, "[A-Za-z][A-Za-z0-9:-]*")
  .map(({ attributes }) => attribute(attributes, "id"))
  .filter(Boolean);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
const idSet = new Set(ids);

checks.push(check("document.doctype", /^\s*<!doctype\s+html\s*>/i.test(html), "HTML5 doctype is present."));
const htmlTag = openingTags(html, "html")[0];
checks.push(check("document.language", Boolean(htmlTag && attribute(htmlTag.attributes, "lang")?.trim()), "Document language is declared."));
const title = pairedTags(html, "title")[0];
checks.push(check("document.title", Boolean(title && visibleText(title.content)), "A descriptive title is present."));
checks.push(check("document.viewport", /<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(html), "Responsive viewport metadata is present."));

const requiredLandmarks = ["header", "nav", "main", "footer"];
const missingLandmarks = requiredLandmarks.filter((name) => openingTags(html, name).length === 0);
checks.push(check("structure.landmarks", missingLandmarks.length === 0, "Required semantic landmarks are present.", missingLandmarks));

const headings = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map((match) => Number(match[1]));
const h1Count = headings.filter((level) => level === 1).length;
const headingSkips = headings.flatMap((level, index) => index > 0 && level > headings[index - 1] + 1
  ? [`h${headings[index - 1]} to h${level} at heading ${index + 1}`]
  : []);
checks.push(check("structure.headings", h1Count === 1 && headingSkips.length === 0, "Heading hierarchy has one h1 and no skipped levels.", [
  ...(h1Count === 1 ? [] : [`h1 count: ${h1Count}`]),
  ...headingSkips,
]));

checks.push(check("structure.unique_ids", duplicateIds.length === 0, "Element IDs are unique.", duplicateIds));
const fragmentLinks = openingTags(html, "a")
  .map(({ attributes }) => attribute(attributes, "href"))
  .filter((href) => href?.startsWith("#") && href.length > 1)
  .map((href) => decodeURIComponent(href.slice(1)));
const missingFragments = [...new Set(fragmentLinks.filter((fragment) => !idSet.has(fragment)))];
checks.push(check("navigation.fragments", missingFragments.length === 0, "Internal links resolve to existing IDs.", missingFragments));
const skipLinks = openingTags(html, "a").filter(({ attributes }) => {
  const href = attribute(attributes, "href");
  const className = attribute(attributes, "class") ?? "";
  return href?.startsWith("#") && /skip/i.test(className);
});
checks.push(check("navigation.skip_link", skipLinks.length > 0 && skipLinks.every(({ attributes }) => idSet.has(attribute(attributes, "href").slice(1))), "A working skip link is present."));

const unnamedButtons = pairedTags(html, "button").flatMap(({ attributes, content }, index) => {
  const name = attribute(attributes, "aria-label") ?? attribute(attributes, "title") ?? visibleText(content);
  return name ? [] : [`button ${index + 1}`];
});
const unnamedLinks = pairedTags(html, "a").flatMap(({ attributes, content }, index) => {
  if (!attribute(attributes, "href")) return [];
  const name = attribute(attributes, "aria-label") ?? attribute(attributes, "title") ?? visibleText(content);
  return name ? [] : [`link ${index + 1}`];
});
checks.push(check("controls.names", unnamedButtons.length + unnamedLinks.length === 0, "Buttons and links have accessible names.", [...unnamedButtons, ...unnamedLinks]));

const labelFors = new Set(openingTags(html, "label").map(({ attributes }) => attribute(attributes, "for")).filter(Boolean));
const formControls = ["input", "select", "textarea"].flatMap((name) => openingTags(html, name).map((tag) => ({ ...tag, name })));
const unlabeledControls = formControls.flatMap(({ attributes, name }, index) => {
  const type = (attribute(attributes, "type") ?? "").toLowerCase();
  if (name === "input" && ["hidden", "submit", "reset", "button", "image"].includes(type)) return [];
  const id = attribute(attributes, "id");
  const labelled = attribute(attributes, "aria-label") || attribute(attributes, "aria-labelledby") || (id && labelFors.has(id));
  return labelled ? [] : [`${name} ${index + 1}${id ? `#${id}` : ""}`];
});
checks.push(check("controls.labels", unlabeledControls.length === 0, "Form controls have programmatic labels.", unlabeledControls));

const imagesWithoutAlt = openingTags(html, "img").flatMap(({ attributes }, index) => attribute(attributes, "alt") === null ? [`image ${index + 1}`] : []);
checks.push(check("images.alternatives", imagesWithoutAlt.length === 0, "Images declare an alt attribute.", imagesWithoutAlt));

const positiveTabindex = [...html.matchAll(/\btabindex\s*=\s*["']?([1-9]\d*)/gi)].map((match) => match[1]);
checks.push(check("keyboard.tabindex", positiveTabindex.length === 0, "No positive tabindex values alter natural focus order.", positiveTabindex));
const inlineHandlers = [...html.matchAll(/\son[a-z]+\s*=/gi)].map((match) => match[0].trim());
checks.push(check("behavior.no_inline_handlers", inlineHandlers.length === 0, "No inline event-handler attributes are used.", [...new Set(inlineHandlers)]));

const executableJavaScript = pairedTags(html, "script")
  .filter(({ attributes }) => {
    const type = (attribute(attributes, "type") ?? "text/javascript").toLowerCase();
    return type === "module" || /^(?:text|application)\/(?:java|ecma)script$/.test(type);
  })
  .map(({ content }) => content)
  .join("\n");
const unsafePatterns = [
  ["eval", /\beval\s*\(/i],
  ["new Function", /\bnew\s+Function\s*\(/i],
  ["document.write", /\bdocument\s*\.\s*write\s*\(/i],
  ["innerHTML", /\.\s*innerHTML\s*=/i],
  ["insertAdjacentHTML", /\.\s*insertAdjacentHTML\s*\(/i],
];
const unsafeUses = unsafePatterns.filter(([, pattern]) => pattern.test(executableJavaScript)).map(([name]) => name);
checks.push(check("security.dynamic_html", unsafeUses.length === 0, "No unsafe dynamic-code or HTML insertion primitive is present.", unsafeUses));

const runtimeResources = [];
for (const [tagName, attributeName] of [
  ["script", "src"], ["img", "src"], ["iframe", "src"], ["audio", "src"],
  ["video", "src"], ["source", "src"], ["object", "data"], ["embed", "src"], ["link", "href"],
]) {
  for (const tag of openingTags(html, tagName)) {
    const value = attribute(tag.attributes, attributeName);
    if (value && !isEmbeddedResource(value)) runtimeResources.push(`${tagName}[${attributeName}]=${value}`);
  }
}
for (const match of html.matchAll(/\b(?:srcset)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
  runtimeResources.push(`srcset=${match[1] ?? match[2]}`);
}
for (const match of executableJavaScript.matchAll(/\b(?:import|export)\s+(?:(?:[^"'();]+?)\s+from\s*)?["']([^"']+)["']/g)) {
  const value = match[1];
  if (!isEmbeddedResource(value)) runtimeResources.push(`module-import=${value}`);
}
const executableCss = [
  ...pairedTags(html, "style").map(({ content }) => content),
  ...openingTags(html, "[A-Za-z][A-Za-z0-9:-]*")
    .map(({ attributes }) => attribute(attributes, "style"))
    .filter(Boolean),
].join("\n");
for (const match of executableCss.matchAll(/url\(\s*["']?([^"')]+)|@import\s+(?:url\()?\s*["']([^"']+)/gi)) {
  const value = match[1] ?? match[2];
  if (value && !isEmbeddedResource(value)) runtimeResources.push(`css=${value}`);
}
const networkApis = [
  ["fetch", /\bfetch\s*\(/i], ["XMLHttpRequest", /\bXMLHttpRequest\b/i],
  ["WebSocket", /\bWebSocket\s*\(/i], ["EventSource", /\bEventSource\s*\(/i],
  ["sendBeacon", /\bsendBeacon\s*\(/i], ["dynamic import", /\bimport\s*\(/i],
  ["importScripts", /\bimportScripts\s*\(/i], ["Worker", /\b(?:Shared)?Worker\s*\(/i],
  ["service worker", /\bserviceWorker\s*\.\s*register\s*\(/i],
  ["RTCPeerConnection", /\bRTCPeerConnection\s*\(/i],
].filter(([, pattern]) => pattern.test(executableJavaScript)).map(([name]) => name);
const transmittingForms = openingTags(html, "form").flatMap(({ attributes }, index) => {
  const action = attribute(attributes, "action");
  return action && !action.startsWith("#") ? [`form ${index + 1} action=${action}`] : [];
});
checks.push(check("portability.runtime_resources", runtimeResources.length === 0, "No external runtime resource is referenced.", runtimeResources));
checks.push(check("privacy.runtime_network", networkApis.length + transmittingForms.length === 0, "No runtime network API or transmitting form is present.", [...networkApis, ...transmittingForms]));

const prose = visibleText(html);
const unfinishedMarkers = [
  [/\b(?:TODO|FIXME)\b/i, "TODO/FIXME"],
  [/\bimplement\s+later\b/i, "implement later"],
  [/\blorem\s+ipsum\b/i, "lorem ipsum"],
  [/\{\{[^}]+\}\}/, "unresolved moustache variable"],
  [/<(?:insert|replace|enter|add)\b[^>]*>/i, "unresolved angle-bracket instruction"],
].filter(([pattern]) => pattern.test(prose)).map(([, label]) => label);
checks.push(check("content.no_unfinished_markers", unfinishedMarkers.length === 0, "No unfinished-content marker is present.", unfinishedMarkers));

checks.push(check("presentation.focus_rule", /:(?:focus-visible|focus)\b/i.test(html), "A CSS focus style is declared."));
checks.push(check("presentation.reduced_motion", /prefers-reduced-motion\s*:\s*reduce/i.test(html), "Reduced-motion behavior is declared."));
checks.push(check("presentation.print", /@media\s+print/i.test(html), "A print stylesheet is declared."));

const failed = checks.filter(({ status }) => status === "fail");
const report = {
  status: failed.length === 0 ? "pass" : "fail",
  kind: "static_html_audit",
  file,
  artifactHash: `sha256:${createHash("sha256").update(html).digest("hex")}`,
  checkedAt: new Date().toISOString(),
  summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length },
  checks,
  limitations: [
    "Static inspection does not prove runtime behavior, factual correctness, instructional effectiveness, visual contrast, or complete WCAG conformance.",
    "Keyboard, responsive, offline reload, console, and interaction claims require an executed browser audit and, where applicable, manual assistive-technology inspection.",
  ],
};

if (options.report) {
  const reportPath = path.resolve(options.report);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(failed.length === 0 ? 0 : 1);
