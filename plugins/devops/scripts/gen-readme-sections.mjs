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
 *   The completion-card examples are rendered through the real card renderer
 *   (mcp-server/index.js --render-card) from scripts/readme-card-examples.json,
 *   so the README can no longer show a card the renderer stopped drawing.
 *
 *   Curated prose (token math, skill/agent table descriptions) stays manual —
 *   only content between <!--devops:count:*--> and <!--devops:block:*-->
 *   markers is rewritten. Files without markers are left untouched.
 *
 *   Usage:
 *     node scripts/gen-readme-sections.mjs [project-root]   # rewrite in place
 *     node scripts/gen-readme-sections.mjs --check [root]    # exit 1 if stale
 *
 *   No-ops silently when [project-root]/plugins/devops/ is absent (i.e. this
 *   is a consumer repo, not the plugin source repo).
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

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
  { name: "SubagentStart", key: "sub", header: "SubagentStart — runs when a subagent is spawned" },
  { name: "SubagentStop", key: "substop", header: "SubagentStop — runs when a subagent finishes" },
  { name: "PostToolUse", key: "post", header: "PostToolUse — runs after each tool call" },
  { name: "Stop", key: "stop", header: "Stop — runs when Claude finishes responding" },
];

// Category view of the same roster: a hook's domain is the middle segment of
// its id (`pre.ship.guard` → ship). A domain missing here lands in "other",
// so a new hook is always listed, just less neatly, until it gets a home.
const CATEGORIES = [
  { title: "tokens & load — keep the context window and the machine free", domains: ["tokens", "governor", "crawl", "claude"] },
  { title: "git & branches — keep work in sync and off main", domains: ["git", "main", "edit", "worktree", "orphan", "session", "cleanup"] },
  { title: "ship — the release pipeline", domains: ["ship"] },
  { title: "flow — completion card, verification, session title", domains: ["flow", "ask", "guide", "batch", "title"] },
  { title: "agents & runs — delegation, do-run contract, burn", domains: ["agent", "run", "burn"] },
  { title: "skills & knowledge — routing, overrides, injected docs", domains: ["skill", "knowledge", "strict", "readme", "design", "concept"] },
  { title: "plugin & MCP — updates, dependencies, server health", domains: ["plugin", "mcp", "permissions", "statusline", "thinking", "watchdog", "tmp", "project"] },
  { title: "issues & team", domains: ["issue", "team"] },
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

/**
 * Parse the hook roster → { SessionStart: [{id, desc}], ... } excluding deprecated.
 * The roster is hooks/dispatch/manifest.json (hooks.json registers one
 * dispatcher per event); a plugin without a dispatcher keeps hooks.json.
 */
function readHooks() {
  const manifest = join(pluginDir, "hooks", "dispatch", "manifest.json");
  const hooksJson = JSON.parse(readFileSync(existsSync(manifest) ? manifest : join(pluginDir, "hooks", "hooks.json"), "utf8"));
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

function buildCategories(hooks) {
  const seen = new Map();
  for (const ev of EVENTS) {
    for (const h of hooks[ev.name]) {
      if (seen.has(h.id)) seen.get(h.id).events.push(ev.name);
      else seen.set(h.id, { ...h, events: [ev.name] });
    }
  }
  const groups = CATEGORIES.map((c) => ({ ...c, hooks: [] }));
  const other = { title: "other", hooks: [] };
  for (const h of seen.values()) {
    const domain = h.id.split(".")[1];
    (groups.find((g) => g.domains.includes(domain)) || other).hooks.push(h);
  }
  const parts = [];
  for (const g of [...groups, other]) {
    if (!g.hooks.length) continue;
    parts.push(`#### ${g.title}`, "");
    for (const h of g.hooks) parts.push(`- \`${h.id}\` *(${h.events.join(", ")})*`);
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

// ── Completion-card examples ────────────────────────────────────────────────

/**
 * Render one card payload through the CLI renderer. Usage, the pre-check and
 * the Desktop widget are switched off so the output is the deterministic
 * terminal markdown; the stale-server info line ("ℹ …") depends on what is
 * installed on this machine and is dropped. Returns null when rendering fails.
 */
function renderCardMarkdown(payload) {
  return new Promise((done) => {
    let out = "";
    let child;
    try {
      child = spawn(process.execPath, [join(pluginDir, "mcp-server", "index.js"), "--render-card", "-"], {
        cwd: projectRoot,
        windowsHide: true,
        env: { ...process.env, DEVOPS_COMPLETION_NO_USAGE: "1", DEVOPS_CARD_PREGATE: "0", CLAUDE_CODE_ENTRYPOINT: "cli" },
      });
    } catch { return done(null); }
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); done(null); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !out.includes("---")) return done(null);
      done(out.split(/\r?\n/).filter((l) => !l.startsWith("ℹ ")).join("\n").trim());
    });
    child.stdin.end(JSON.stringify({ lang: "en", session_id: "readme-card-example", ...payload }));
  });
}

/**
 * Both card blocks, or null when the fixtures or the renderer are unavailable.
 * All payloads render in parallel — one node process each, ~1 s apiece.
 */
async function buildCardBlocks() {
  const file = join(pluginDir, "scripts", "readme-card-examples.json");
  if (!existsSync(file)) return null;
  const fixtures = JSON.parse(readFileSync(file, "utf8"));

  const variants = fixtures.variants || [];
  const [rendered, ...variantMds] = await Promise.all(
    [fixtures.example, ...variants.map((v) => v.payload)].map(renderCardMarkdown),
  );
  if (rendered == null) return null;
  // The leading `&nbsp;` spacer only matters in a chat; in a fence it is noise.
  const example = rendered.slice(rendered.indexOf("---"));

  const rows = ["| Variant / state | Decision heading | When |", "|---|---|---|"];
  for (const [i, v] of variants.entries()) {
    const md = variantMds[i];
    if (md == null) return null;
    const heading = (md.split("\n").find((l) => l.startsWith("## ")) || "").slice(3).trim();
    rows.push(`| \`${v.label}\` | ${heading} | ${v.when} |`);
  }
  return { example: "````\n" + example + "\n````", variants: rows.join("\n") };
}

// ── Main ────────────────────────────────────────────────────────────────────

function applyMarkers(content, counts, lifecycle, cards, categories) {
  let out = content;
  for (const [key, value] of Object.entries(counts)) out = replaceCount(out, key, value);
  if (lifecycle != null) out = replaceBlock(out, "hook-lifecycle", lifecycle);
  if (categories != null) out = replaceBlock(out, "hook-categories", categories);
  if (cards) {
    out = replaceBlock(out, "card-example", cards.example);
    out = replaceBlock(out, "card-variants", cards.variants);
  }
  return out;
}

function processFile(path, counts, lifecycle, stale, cards = null, categories = null) {
  if (!existsSync(path)) return;
  const existing = readFileSync(path, "utf8");
  const updated = applyMarkers(existing, counts, lifecycle, cards, categories);
  if (updated === existing) return;
  if (checkOnly) {
    stale.push(path);
  } else {
    writeFileSync(path, updated, "utf8");
    console.error(`[gen-readme-sections] updated ${path.replace(projectRoot, ".")}`);
  }
}

async function generate() {
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

  // A renderer that cannot run (a broken checkout, a missing file) leaves the
  // card blocks as they are — counts and the hook roster still refresh.
  let cards = null;
  try { cards = await buildCardBlocks(); } catch { cards = null; }
  if (!cards) console.error("[gen-readme-sections] card examples not rendered — README card blocks left unchanged");

  const stale = [];
  // --check must not pass on blocks it could not verify (a fixture the
  // renderer's schema now rejects would otherwise freeze the old example).
  if (!cards && checkOnly) stale.push("README.md card examples (renderer or fixture failed)");
  processFile(join(projectRoot, "README.md"), counts, lifecycle, stale, cards, buildCategories(hooks));
  processFile(join(pluginDir, "docs", "architecture.html"), counts, null, stale);

  if (checkOnly && stale.length) {
    console.error(
      "[gen-readme-sections] STALE — run `node plugins/devops/scripts/gen-readme-sections.mjs` to refresh:\n  " +
        stale.map((p) => p.replace(projectRoot, ".")).join("\n  "),
    );
    process.exit(1);
  }
  if (checkOnly) console.error("[gen-readme-sections] markers up-to-date");
  return true;
}

await generate();
