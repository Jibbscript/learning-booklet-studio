import { createHash } from "node:crypto";

function normalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalize(value[key])]),
  );
}

export function stableStringify(value) {
  return JSON.stringify(normalize(value));
}

export function hashValue(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : stableStringify(value);
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

export function sameValue(a, b) {
  return stableStringify(a) === stableStringify(b);
}

export function clone(value) {
  return structuredClone(value);
}
