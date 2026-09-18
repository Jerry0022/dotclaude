/**
 * @module mcp-server/lib/card-input
 * @version 0.1.0
 * @description Lenient coercion + structural validation of the completion-card
 *   payload — the shapes the MCP tool's zod schema enforces, written once
 *   without a dependency so the `--render-card` CLI fallback can enforce them
 *   too (#396).
 *
 *   The MCP path rejects a malformed payload before the handler runs. The CLI
 *   path is reached exactly when the MCP server is down — the agent then has
 *   no tool schema in context and writes payload.json from memory. The
 *   obvious guess for `changes` is a string array, one line per change; the
 *   renderer read `c.area` / `c.description` off each string, got undefined,
 *   and printed three bullets of `*  → ` — the one block the user reads after
 *   a turn, empty, with exit code 0.
 *
 *   Two layers, in this order:
 *     1. coerce  — a string entry where an object is expected becomes that
 *        object when the text carries an obvious separator (`area → text`,
 *        `area — text`, `area: text`); without one the whole string becomes
 *        the description so the text at least shows. Applied to BOTH entry
 *        points via normalizeCardParams: harmless on the MCP path (zod has
 *        already rejected strings there) and the readable fallback on the CLI.
 *     2. validate — whatever is still off-shape after coercion is an error
 *        with a path and a message, never a silent empty render. The CLI exits
 *        2 with the issues on stderr; the hook text already tells the agent to
 *        fall back to the tool when the node call fails.
 *
 *   No zod on purpose: index.cli.test.js pins that the entry file pulls no
 *   third-party module before the CLI branch — that property is what makes it
 *   a fallback for a session whose MCP server never came up.
 */

/** Separators that split a one-line change into `area` and `description`, first match wins. */
const CHANGE_SEPARATORS = [" → ", " — ", " -> ", ": "];

/**
 * Split `text` at the first separator that appears. Returns `[head, tail]`
 * or null when none is present.
 */
function splitOnce(text) {
  let best = null;
  for (const sep of CHANGE_SEPARATORS) {
    const i = text.indexOf(sep);
    if (i > 0 && (best === null || i < best.index)) best = { index: i, sep };
  }
  if (!best) return null;
  return [text.slice(0, best.index).trim(), text.slice(best.index + best.sep.length).trim()];
}

/** `"Card → shows text"` → `{ area: "Card", description: "shows text" }`; no separator → area "". */
export function coerceChange(entry) {
  if (typeof entry !== "string") return entry;
  const text = entry.trim();
  const parts = splitOnce(text);
  return parts ? { area: parts[0], description: parts[1] } : { area: "", description: text };
}

/** `"npm test → 1460 grün"` → `{ method, result }`; no separator → the text is the method, result "". */
export function coerceTest(entry) {
  if (typeof entry !== "string") return entry;
  const text = entry.trim();
  const parts = splitOnce(text);
  return parts ? { method: parts[0], result: parts[1] } : { method: text, result: "" };
}

/** `"requirement — evidence"` → `{ requirement, evidence }`; no separator → requirement only. */
export function coerceValidation(entry) {
  if (typeof entry !== "string") return entry;
  const text = entry.trim();
  const parts = splitOnce(text);
  return parts ? { requirement: parts[0], evidence: parts[1] } : { requirement: text };
}

/**
 * Coerce every array field whose entries the schema wants as objects. Mutates
 * and returns `params`. Non-array values are left for `validateCardInput`.
 */
export function coerceCardInput(params) {
  if (!params || typeof params !== "object") return params;
  if (Array.isArray(params.changes)) params.changes = params.changes.map(coerceChange);
  if (Array.isArray(params.tests)) params.tests = params.tests.map(coerceTest);
  if (Array.isArray(params.validation)) params.validation = params.validation.map(coerceValidation);
  return params;
}

// ---------------------------------------------------------------------------
// Validation — mirrors the tool's zod input schema, one rule per field.
// ---------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string";

/** Push an issue for each entry of `arr` that fails `check(entry)`. */
function eachEntry(issues, path, arr, check) {
  if (arr === undefined || arr === null) return;
  if (!Array.isArray(arr)) { issues.push({ path, message: "must be an array" }); return; }
  arr.forEach((entry, i) => {
    const msg = check(entry);
    if (msg) issues.push({ path: `${path}[${i}]`, message: msg });
  });
}

const VALIDATION_STATUS = ["met", "partial", "unmet"];
const PENDING_KINDS = ["agent", "task", "workflow"];
const CONCEPT_PHASES = ["waiting", "iterating", "implementing"];

/**
 * Structural validation of an already-normalized + coerced payload. Returns
 * `{ ok, issues }` where each issue is `{ path, message }`. Fields the schema
 * marks optional are validated only when present; unknown top-level keys are
 * ignored (the MCP path strips them, the renderer never reads them).
 */
export function validateCardInput(params) {
  const issues = [];
  if (!isObj(params)) return { ok: false, issues: [{ path: "", message: "payload must be a JSON object" }] };

  if (!isStr(params.variant)) issues.push({ path: "variant", message: "must be a string" });
  if (!isStr(params.summary)) issues.push({ path: "summary", message: "must be a string" });
  if (params.lang !== undefined && params.lang !== "de" && params.lang !== "en") issues.push({ path: "lang", message: 'must be "de" or "en"' });

  eachEntry(issues, "changes", params.changes, (c) =>
    !isObj(c) ? "must be { area, description } (or a string 'area → description')"
    : !isStr(c.area) ? "area must be a string"
    : !isStr(c.description) ? "description must be a string"
    : null);

  eachEntry(issues, "tests", params.tests, (t) =>
    !isObj(t) ? "must be { method, result } (or a string 'method → result')"
    : !isStr(t.method) ? "method must be a string"
    : !isStr(t.result) ? "result must be a string"
    : null);

  eachEntry(issues, "validation", params.validation, (v) =>
    !isObj(v) ? "must be { requirement, status?, evidence? }"
    : !isStr(v.requirement) ? "requirement must be a string"
    : v.status !== undefined && !VALIDATION_STATUS.includes(v.status) ? `status must be one of ${VALIDATION_STATUS.join("|")}`
    : v.evidence !== undefined && !isStr(v.evidence) ? "evidence must be a string"
    : null);

  eachEntry(issues, "userTest", params.userTest, (u) => (isStr(u) ? null : "must be a string"));
  eachEntry(issues, "open", params.open, (o) => (isStr(o) ? null : "must be a string"));

  eachEntry(issues, "userFinalTest", params.userFinalTest, (u) =>
    isStr(u) ? null
    : !isObj(u) ? "must be a string or { action, afterDeployment? }"
    : !isStr(u.action) ? "action must be a string"
    : u.afterDeployment !== undefined && typeof u.afterDeployment !== "boolean" ? "afterDeployment must be a boolean"
    : null);

  eachEntry(issues, "pending", params.pending, (p) =>
    isStr(p) ? null
    : !isObj(p) ? "must be a string or { name, kind?, doing? }"
    : !isStr(p.name) ? "name must be a string"
    : p.kind !== undefined && !PENDING_KINDS.includes(p.kind) ? `kind must be one of ${PENDING_KINDS.join("|")}`
    : p.doing !== undefined && !isStr(p.doing) ? "doing must be a string"
    : null);

  eachEntry(issues, "deployGate", params.deployGate, (d) =>
    isStr(d) ? null
    : !isObj(d) ? "must be a string or { artifact, kind?, action? }"
    : !isStr(d.artifact) ? "artifact must be a string"
    : null);

  for (const key of ["state", "cta", "delivery", "promotion"]) {
    if (params[key] !== undefined && params[key] !== null && !isObj(params[key])) issues.push({ path: key, message: "must be an object" });
  }
  if (params.concept !== undefined && params.concept !== null) {
    const c = params.concept;
    if (isStr(c)) { if (!CONCEPT_PHASES.includes(c)) issues.push({ path: "concept", message: `must be one of ${CONCEPT_PHASES.join("|")} or { phase?, url? }` }); }
    else if (!isObj(c)) issues.push({ path: "concept", message: "must be a phase string or an object" });
    else if (c.phase !== undefined && !CONCEPT_PHASES.includes(c.phase)) issues.push({ path: "concept.phase", message: `must be one of ${CONCEPT_PHASES.join("|")}` });
  }
  if (isObj(params.state) && params.state.pr !== undefined && params.state.pr !== null) {
    const pr = params.state.pr;
    if (!isObj(pr) || typeof pr.number !== "number" || !isStr(pr.title)) issues.push({ path: "state.pr", message: "must be { number: number, title: string }" });
  }

  return { ok: issues.length === 0, issues };
}

/** One stderr-ready line per issue. */
export function formatIssues(issues) {
  return issues.map((i) => `  - ${i.path || "(payload)"}: ${i.message}`).join("\n");
}

/**
 * The field reference the Stop-gate hook prints for the offline path, so an
 * agent without the tool schema in context does not have to guess shapes
 * (#396). Kept here, next to the rules, so the two cannot drift apart.
 */
export const CARD_FIELD_REFERENCE =
  'Shapes: changes: [{ area, description }] · tests: [{ method, result }] · ' +
  'validation: [{ requirement, status: met|partial|unmet, evidence }] · ' +
  'userFinalTest: [string | { action, afterDeployment }] · open: [string] · ' +
  'pending: [{ name, kind: agent|task|workflow, doing }] · state / cta / delivery: objects.';
