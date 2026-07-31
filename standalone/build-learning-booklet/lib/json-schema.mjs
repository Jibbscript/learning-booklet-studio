function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function typeMatches(value, type) {
  return type === "null" ? value === null
    : type === "array" ? Array.isArray(value)
    : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
    : type === "integer" ? Number.isInteger(value)
    : type === "number" ? typeof value === "number" && Number.isFinite(value)
    : typeof value === type;
}
function pointer(root, fragment) {
  return fragment.split("/").slice(1).reduce((value, token) => value?.[token.replaceAll("~1", "/").replaceAll("~0", "~")], root);
}

export function validateArtifact(artifact, schema, relatedSchemas = []) {
  const roots = new Map([schema, ...relatedSchemas].filter(Boolean).map((item) => [item.$id, item]));
  const errors = [];
  function visit(value, rule, instancePath = "", root = schema) {
    if (rule === true) return;
    if (rule === false) { errors.push({ instancePath, keyword: "false schema", message: "must not be present" }); return; }
    if (!rule || typeof rule !== "object") return;
    if (rule.$ref) {
      const [identifier, fragment = ""] = rule.$ref.split("#");
      const targetRoot = identifier ? roots.get(identifier) : root;
      const target = targetRoot && (fragment ? pointer(targetRoot, fragment) : targetRoot);
      if (!target) errors.push({ instancePath, keyword: "$ref", message: `cannot resolve ${rule.$ref}` });
      else visit(value, target, instancePath, targetRoot);
      return;
    }
    if (rule.type) {
      const types = Array.isArray(rule.type) ? rule.type : [rule.type];
      if (!types.some((type) => typeMatches(value, type))) { errors.push({ instancePath, keyword: "type", message: `must be ${types.join(" or ")}` }); return; }
    }
    if (rule.const !== undefined && !same(value, rule.const)) errors.push({ instancePath, keyword: "const", message: "must equal the constant" });
    if (rule.enum && !rule.enum.some((item) => same(value, item))) errors.push({ instancePath, keyword: "enum", message: "must equal an allowed value" });
    if (typeof value === "string") {
      if (rule.minLength !== undefined && value.length < rule.minLength) errors.push({ instancePath, keyword: "minLength", message: `must have at least ${rule.minLength} characters` });
      if (rule.pattern && !new RegExp(rule.pattern, "u").test(value)) errors.push({ instancePath, keyword: "pattern", message: `must match ${rule.pattern}` });
      if (rule.format === "date-time" && (!Number.isFinite(Date.parse(value)) || !/^\d{4}-\d\d-\d\dT/.test(value))) errors.push({ instancePath, keyword: "format", message: "must be a date-time" });
      if (rule.format === "uri") { try { new URL(value); } catch { errors.push({ instancePath, keyword: "format", message: "must be a URI" }); } }
    }
    if (typeof value === "number") {
      if (rule.minimum !== undefined && value < rule.minimum) errors.push({ instancePath, keyword: "minimum", message: `must be >= ${rule.minimum}` });
      if (rule.maximum !== undefined && value > rule.maximum) errors.push({ instancePath, keyword: "maximum", message: `must be <= ${rule.maximum}` });
    }
    if (Array.isArray(value)) {
      if (rule.minItems !== undefined && value.length < rule.minItems) errors.push({ instancePath, keyword: "minItems", message: `must have at least ${rule.minItems} items` });
      if (rule.maxItems !== undefined && value.length > rule.maxItems) errors.push({ instancePath, keyword: "maxItems", message: `must have at most ${rule.maxItems} items` });
      if (rule.uniqueItems && new Set(value.map(JSON.stringify)).size !== value.length) errors.push({ instancePath, keyword: "uniqueItems", message: "must contain unique items" });
      if (rule.items) value.forEach((item, index) => visit(item, rule.items, `${instancePath}/${index}`, root));
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) errors.push({ instancePath, keyword: "required", message: `must have required property ${key}` });
      const patterns = Object.entries(rule.patternProperties ?? {});
      for (const [key, item] of Object.entries(value)) {
        const childPath = `${instancePath}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        if (rule.properties?.[key]) visit(item, rule.properties[key], childPath, root);
        else {
          const matching = patterns.filter(([pattern]) => new RegExp(pattern, "u").test(key));
          if (matching.length) matching.forEach(([, child]) => visit(item, child, childPath, root));
          else if (rule.additionalProperties === false) errors.push({ instancePath, keyword: "additionalProperties", message: `must not have property ${key}` });
          else if (rule.additionalProperties && typeof rule.additionalProperties === "object") visit(item, rule.additionalProperties, childPath, root);
        }
      }
    }
    for (const child of rule.allOf ?? []) visit(value, child, instancePath, root);
    if (rule.oneOf) {
      const matches = rule.oneOf.filter((child) => { const before = errors.length; visit(value, child, instancePath, root); const valid = errors.length === before; errors.splice(before); return valid; }).length;
      if (matches !== 1) errors.push({ instancePath, keyword: "oneOf", message: "must match exactly one schema" });
    }
    if (rule.if) {
      const before = errors.length; visit(value, rule.if, instancePath, root); const matches = errors.length === before; errors.splice(before);
      if (matches && rule.then) visit(value, rule.then, instancePath, root);
    }
  }
  visit(artifact, schema);
  return { valid: errors.length === 0, errors };
}
