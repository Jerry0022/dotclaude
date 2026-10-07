// Deterministic graders for the A/B runner. A grader is a predicate
// (ctx) => boolean, where ctx = { parsed, raw, workdir } (parsed = the
// parseStream() result, raw = the stream-json stdout, workdir = the temp
// project the run used).
//
// Two sources per case:
// - graders/*.md frontmatter (`tool_used`, `regex`, `file_exists`) is
//   compiled into predicates; `arm` is ignored (both A/B variants load the
//   plugin). Unknown types grade as `null` (= not decidable, not a fail).
// - optional graders.js: `module.exports = (g) => ({ name: predicate })`,
//   g = this module's predicate builders.
// LLM-graded checks are NOT implemented; the .md body stays human intent.

"use strict";

const fs = require("fs");
const path = require("path");

const COMPLETION_TOOL_PREFIX = "mcp__plugin_devops_dotclaude-completion__";

function toRegex(p) {
  return p instanceof RegExp ? p : new RegExp(p);
}

function nameMatches(actual, wanted) {
  if (!actual) return false;
  if (wanted instanceof RegExp) return wanted.test(actual);
  // Accept both `fix` and the namespaced `devops:fix`.
  return actual === wanted || actual.endsWith(`:${wanted}`);
}

function inRange(n, { min = 1, max = Infinity } = {}) {
  return n >= min && n <= max;
}

function calls(ctx, includeSubagents) {
  return ctx.parsed.toolCalls.filter((c) => includeSubagents || !c.subagent);
}

const skillInvoked = (name, opts = {}) => (ctx) =>
  inRange(calls(ctx, opts.includeSubagents).filter((c) => c.name === "Skill" && nameMatches((c.input || {}).skill, name)).length, opts);

const skillNotInvoked = (name, opts = {}) => skillInvoked(name, { ...opts, min: 0, max: 0 });

const agentSpawned = (type, opts = {}) => (ctx) =>
  inRange(calls(ctx, opts.includeSubagents).filter((c) => {
    if (c.name !== "Agent" && c.name !== "Task") return false;
    const input = c.input || {};
    if (type != null && !nameMatches(input.subagent_type, type)) return false;
    if (opts.model && input.model !== opts.model) return false;
    return true;
  }).length, opts);

// No devops role agent spawned. Spawns whose input mentions the completion
// card are ignored by default (the Stop hook can delegate the card render).
const noDevopsAgent = ({ ignore = /[Cc]ompletion[ -][Cc]ard/, includeSubagents = false } = {}) => (ctx) =>
  !calls(ctx, includeSubagents).some((c) => {
    if (c.name !== "Agent" && c.name !== "Task") return false;
    const type = (c.input || {}).subagent_type || "";
    if (!type.startsWith("devops:")) return false;
    return !(ignore && ignore.test(JSON.stringify(c.input)));
  });

const toolUsed = (name, opts = {}) => (ctx) => {
  const re = opts.inputMatch ? toRegex(opts.inputMatch) : null;
  return inRange(calls(ctx, opts.includeSubagents).filter((c) =>
    nameMatches(c.name, name) && (!re || re.test(JSON.stringify(c.input)))).length, opts);
};

const textMatches = (re) => (ctx) => toRegex(re).test(ctx.parsed.assistantText.join("\n"));
const finalTextMatches = (re) => (ctx) => toRegex(re).test(ctx.parsed.finalText || "");
const cardRendered = () => (ctx) => ctx.parsed.toolCalls.some((c) => !c.subagent && c.name.startsWith(COMPLETION_TOOL_PREFIX));
const fileExists = (rel) => (ctx) => fs.existsSync(path.join(ctx.workdir, rel));
const fileMatches = (rel, re) => (ctx) => {
  try { return toRegex(re).test(fs.readFileSync(path.join(ctx.workdir, rel), "utf8")); } catch { return false; }
};
const traceMatches = (re) => (ctx) => {
  const rx = toRegex(re);
  return String(ctx.raw || "").split(/\r?\n/).some((line) => rx.test(line));
};

const predicates = {
  skillInvoked, skillNotInvoked, agentSpawned, noDevopsAgent, toolUsed,
  textMatches, finalTextMatches, cardRendered, fileExists, fileMatches, traceMatches,
};

// Compile one graders/*.md frontmatter into a predicate, or null if the
// type is not deterministic here.
function compileMdGrader(spec) {
  const range = {
    min: spec.min == null ? 1 : Number(spec.min),
    max: spec.max == null ? Infinity : Number(spec.max),
  };
  if (spec.type === "tool_used" && spec.tool) {
    return toolUsed(spec.tool, { ...range, inputMatch: spec.input_match || null });
  }
  if (spec.type === "file_exists" && spec.path) return fileExists(spec.path);
  if (spec.type === "regex" && spec.pattern) {
    const t = spec.target;
    if (t === "trace") return traceMatches(spec.pattern);
    if (t && typeof t === "object" && t.source === "file" && t.path) return fileMatches(t.path, spec.pattern);
    if (t === "last_message" || t == null) return finalTextMatches(spec.pattern);
  }
  return null;
}

function loadGraders(caseDef) {
  const graders = [];
  for (const spec of caseDef.mdGraders || []) {
    graders.push({ name: spec.name, source: "md", check: compileMdGrader(spec) });
  }
  if (caseDef.jsGradersFile) {
    const factory = require(caseDef.jsGradersFile);
    const defs = typeof factory === "function" ? factory(predicates) : factory;
    for (const [name, check] of Object.entries(defs || {})) {
      graders.push({ name, source: "js", check: typeof check === "function" ? check : null });
    }
  }
  return graders;
}

// true = pass, false = fail, null = not decidable (unsupported type or the
// predicate threw).
function gradeRun(graders, ctx) {
  const out = {};
  for (const g of graders) {
    if (!g.check) { out[g.name] = null; continue; }
    try { out[g.name] = Boolean(g.check(ctx)); } catch { out[g.name] = null; }
  }
  return out;
}

module.exports = { ...predicates, predicates, compileMdGrader, loadGraders, gradeRun, COMPLETION_TOOL_PREFIX };
