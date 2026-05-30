#!/usr/bin/env node
/**
 * @script gen-readme-sections
 * @version 0.1.0
 * @plugin devops
 * @description Regenerates the auto-maintained marker blocks in README.md and
 *   docs/architecture.html from the canonical plugin roster (hooks.json,
 *   skills/, agents/, deep-knowledge/). Keeps every COUNT and the hook
 *   lifecycle roster in sync with reality so they can never drift again.
 *   Called automatically by ship_build; can also be run standalone.
 *
 *   Curated prose (token math, skill/agent table descriptions) stays manual —
 *   only content between <!--devops:count:*--> and <!--devops:block:*-->
 *   markers is rewritten. Files without markers are left untouched.
 *
 *   Usage:
 *     node scripts/gen-readme-sections.js [project-root]   # rewrite in place
 *     node scripts/gen-readme-sections.js --check [root]    # exit 1 if stale
 *
 *   No-ops silently when [project-root]/plugins/devops/ is absent (i.e. this
 *   is a consumer repo, not the plugin source repo).
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const rootArg = args.find((a) => !a.startsWith("--"));
// Default: repo root is two levels above plugins/devops/scripts/
const projectRoot = resolve(rootArg || join(__dirname, "..", "..", ".."));
const pluginDir = join(projectRoot, "plugins", "devops");

// ── Turn-order event metadata ───────────────────────────────────────────────

const EVENTS = [
  { name: "SessionStart", key: "ss", header: "SessionStart — runs once when a session begins" },
  { name: "UserPromptSubmit", key: "prompt", header: "UserPromptSubmit — runs when the user sends a message" },
  { name: "PreToolUse", key: "pre", header: "PreToolUse — runs before each tool call" },
  { name: "PostToolUse", key: "post", header: "PostToolUse — runs after each tool call" },
  { name: "Stop", key: "stop", header: "Stop — runs when Claude finishes responding" },
];

// ── Roster extraction ───────────────────────────────────────────────────────

/** First sentence (or ~80-char slice) of a hook file's @description. */
function hookDescription(file) {
  let content;
  try { content = readFileSync(file, "utf8"); } catch { return ""; }

  const m = content.match(/@description\s+([\s\S]*?)(?:\n\s*\*\s*@|\n\s*\*\/)/);
  let raw;
  if (m) {
    raw = m[1];
  } else {
    // Fallback: first non-tag JSDoc prose line
    const line = content
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .find((l) => l && !l.startsWith("@") && !l.startsWith("/**") && !l.startsWith("#!"));
    raw = line || "";
  }

  const flat = raw
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const sentence = flat.match(/^(.*?\.)(?:\s|$)/);
  const text = sentence ? sentence[1] : flat;
  return text.length > 88 ? text.slice(0, 85).trimEnd() + "…" : text;
}

/** Parse hooks.json → { SessionStart: [{id, desc}], ... } excluding deprecated. */
function readHooks() {
  const hooksJson = JSON.parse(readFileSync(join(pluginDir, "hooks", "hooks.json"), "utf8"));
  const byEvent = {};
  for (const ev of EVENTS) byEvent[ev.name] = [];

  for (const [event, groups] of Object.entries(hooksJson.hooks || {})) {
    if (!byEvent[event]) continue;
    for (const group of groups) {
      for (const entry of group.hooks || []) {
        if (entry._deprecated) continue;
        const rel = (entry.command || "").match(/hooks\/[\w./-]+\.js/);
        if (!rel) continue;
        const file = join(pluginDir, rel[0]);
        const id = rel[0].split("/").pop().replace(/\.js$/, "");
        byEvent[event].push({ id, desc: hookDescription(file) });
      }
    }
  }
  return byEvent;
}

function countSkills() {
  const dir = join(pluginDir, "skills");
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
    .length;
}

function countAgents() {
  return readdirSync(join(pluginDir, "agents")).filter((f) => f.endsWith(".md")).length;
}

function countDeepKnowledge() {
  return readdirSync(join(pluginDir, "deep-knowledge"))
    .filter((f) => f.endsWith(".md") && f !== "INDEX.md").length;
}

// ── Marker rewriting ────────────────────────────────────────────────────────

function replaceCount(content, key, value) {
  const re = new RegExp(`(<!--devops:count:${key}-->)([\\s\\S]*?)(<!--/devops:count:${key}-->)`, "g");
  return content.replace(re, `$1${value}$3`);
}

function replaceBlock(content, key, inner) {
  const re = new RegExp(`(<!--devops:block:${key}-->)([\\s\\S]*?)(<!--/devops:block:${key}-->)`, "g");
  return content.replace(re, `$1\n${inner}\n$3`);
}

function buildLifecycle(hooks) {
  const parts = [];
  for (const ev of EVENTS) {
    const list = hooks[ev.name];
    if (!list.length) continue;
    parts.push(`#### ${ev.header}`, "");
    for (const h of list) parts.push(`- \`${h.id}\` — ${h.desc}`);
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

// ── Main ────────────────────────────────────────────────────────────────────

function applyMarkers(content, counts, lifecycle) {
  let out = content;
  for (const [key, value] of Object.entries(counts)) out = replaceCount(out, key, value);
  if (lifecycle != null) out = replaceBlock(out, "hook-lifecycle", lifecycle);
  return out;
}

function processFile(path, counts, lifecycle, stale) {
  if (!existsSync(path)) return;
  const existing = readFileSync(path, "utf8");
  const updated = applyMarkers(existing, counts, lifecycle);
  if (updated === existing) return;
  if (checkOnly) {
    stale.push(path);
  } else {
    writeFileSync(path, updated, "utf8");
    console.error(`[gen-readme-sections] updated ${path.replace(projectRoot, ".")}`);
  }
}

function generate() {
  if (!existsSync(pluginDir)) {
    // Not the plugin source repo — nothing to maintain.
    return false;
  }

  const hooks = readHooks();
  const perEvent = {};
  let hookTotal = 0;
  for (const ev of EVENTS) {
    perEvent[`hooks:${ev.key}`] = hooks[ev.name].length;
    hookTotal += hooks[ev.name].length;
  }

  const counts = {
    hooks: hookTotal,
    skills: countSkills(),
    agents: countAgents(),
    dk: countDeepKnowledge(),
    ...perEvent,
  };
  const lifecycle = buildLifecycle(hooks);

  const stale = [];
  processFile(join(projectRoot, "README.md"), counts, lifecycle, stale);
  processFile(join(pluginDir, "docs", "architecture.html"), counts, null, stale);

  if (checkOnly && stale.length) {
    console.error(
      "[gen-readme-sections] STALE — run `node plugins/devops/scripts/gen-readme-sections.js` to refresh:\n  " +
        stale.map((p) => p.replace(projectRoot, ".")).join("\n  "),
    );
    process.exit(1);
  }
  if (checkOnly) console.error("[gen-readme-sections] markers up-to-date");
  return true;
}

generate();
