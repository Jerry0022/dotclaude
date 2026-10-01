/**
 * Agent definitions against the official subagent contract (code.claude.com
 * docs: sub-agents, plugins/components — checked 2026-10-01).
 *
 * Born from the 2026-10 agent audit: qa, frontend, designer and gamer listed
 * MCP tools by their bare names (`navigate`, `preview_screenshot`,
 * `use_figma`). Those never resolve, so in 30 days of transcripts qa made
 * zero browser calls in 65 runs while its definition called browser checks
 * mandatory. AskUserQuestion was listed too — Claude Code strips it from
 * every sub-agent. Both failures are silent at runtime; this test is where
 * they surface.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "agents");

// Fields a plugin-shipped agent may carry. permissionMode, hooks, mcpServers
// and initialPrompt are ignored for plugin agents, so they are refused here.
const FIELDS = new Set([
  "name", "description", "model", "effort", "maxTurns", "tools", "disallowedTools",
  "skills", "memory", "background", "omitClaudeMd", "isolation", "color", "experimental",
]);
const COLORS = new Set(["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"]);
const MODELS = new Set(["sonnet", "opus", "fable", "inherit"]); // no haiku: agent-orchestration.md
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const BUILTIN_TOOLS = new Set([
  "Read", "Write", "Edit", "Bash", "PowerShell", "Glob", "Grep", "WebSearch", "WebFetch",
  "Agent", "NotebookEdit", "TodoWrite", "Skill", "ToolSearch", "Monitor",
]);
// Stripped from every sub-agent by Claude Code, foreground or background.
const STRIPPED_TOOLS = new Set(["AskUserQuestion", "EnterPlanMode", "ExitPlanMode", "ScheduleWakeup", "Workflow"]);

function frontmatter(file) {
  const src = readFileSync(join(AGENTS_DIR, file), "utf8").replace(/\r\n/g, "\n");
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${file}: no frontmatter`);
  const fm = {};
  let key = null;
  for (const line of m[1].split("\n")) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const top = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (top) {
      key = top[1];
      fm[key] = top[2];
    } else if (key) {
      fm[key] += `\n${line.trim()}`;
    }
  }
  for (const k of ["tools", "disallowedTools"]) {
    if (fm[k] !== undefined) fm[k] = JSON.parse(fm[k].replace(/\n/g, " "));
  }
  return { fm, body: src.slice(m[0].length) };
}

const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));

describe.each(files)("agents/%s", (file) => {
  const { fm, body } = frontmatter(file);

  test("only fields Claude Code honours for plugin agents", () => {
    for (const k of Object.keys(fm)) expect(FIELDS, `unknown field ${k}`).toContain(k);
    expect(fm.name).toBe(file.replace(/\.md$/, ""));
    expect(fm.description.length).toBeGreaterThan(40);
  });

  test("model, effort and color are official values", () => {
    expect(MODELS).toContain(fm.model);
    if (fm.effort) expect(EFFORTS).toContain(fm.effort);
    expect(COLORS).toContain(fm.color);
  });

  test("every tool entry resolves: a built-in or a full mcp__ name", () => {
    for (const t of [...(fm.tools || []), ...(fm.disallowedTools || [])]) {
      const ok = BUILTIN_TOOLS.has(t) || /^mcp__[\w-]+(__[\w-]+|__\*)?$/.test(t);
      expect(ok, `${file}: "${t}" is neither a built-in tool nor mcp__<server>[__<tool>]`).toBe(true);
    }
  });

  test("lists no tool Claude Code strips from sub-agents", () => {
    for (const t of fm.tools || []) expect(STRIPPED_TOOLS.has(t), `${file}: ${t} is stripped`).toBe(false);
  });

  test("at most one <example> — descriptions load into every session", () => {
    expect((fm.description.match(/<example>/g) || []).length).toBeLessThanOrEqual(1);
  });

  test("an agent that must spawn others has the Agent tool", () => {
    const spawns = /\bspawn (`?po`?|`?qa`?|research|domain agents)\b/i.test(body);
    if (spawns && fm.tools) expect(fm.tools).toContain("Agent");
  });

  test("never hard-resets outside the shared, guarded branch setup", () => {
    expect(body).not.toMatch(/git reset --hard/);
  });
});

test("the roster has one source per branch-setup procedure", () => {
  const doc = readFileSync(join(AGENTS_DIR, "..", "deep-knowledge", "agent-branch-setup.md"), "utf8");
  expect(doc).toMatch(/git status --porcelain/);
  expect(doc).toMatch(/Never `git reset --hard`/);
  for (const f of files) {
    const { body } = frontmatter(f);
    if (/## Branch Setup/.test(body)) expect(body, f).toContain("deep-knowledge/agent-branch-setup.md");
  }
});

describe("the roster agrees with the rest of the plugin", () => {
  const PLUGIN = join(AGENTS_DIR, "..");

  test("every browser server an allowlist names is one the browsertest guard counts", async () => {
    const { isBrowserTool } = await import("../hooks/lib/browsertest-guard.js");
    const sample = { mcp__Claude_Browser: "read_page", "mcp__claude-in-chrome": "navigate", mcp__Claude_in_Chrome: "navigate",
      mcp__Claude_Preview: "preview_snapshot", mcp__plugin_playwright_playwright: "browser_snapshot" };
    for (const f of files) {
      for (const t of frontmatter(f).fm.tools || []) {
        if (!sample[t]) continue;
        expect(isBrowserTool(`${t}__${sample[t]}`), `${f}: ${t}`).toBe(true);
      }
    }
  });

  test("the model/effort table in agent-orchestration.md matches each frontmatter", () => {
    const full = readFileSync(join(PLUGIN, "deep-knowledge", "agent-orchestration.md"), "utf8").replace(/\r\n/g, "\n");
    const doc = full.slice(full.indexOf("### Model & Effort Defaults"), full.indexOf("### Complexity Tiers"));
    for (const f of files) {
      const { fm } = frontmatter(f);
      const row = doc.split("\n").map((l) => l.split("|").map((c) => c.trim()))
        .find((c) => c[1] === `**${fm.name}**` && c.length >= 5);
      if (row) row.splice(0, 1); // drop the empty cell before the leading pipe
      expect(row, `${fm.name} missing from § Model & Effort Defaults`).not.toBeNull();
      expect(row[1], `${fm.name} model`).toBe(fm.model);
      expect(row[2].trim(), `${fm.name} effort`).toBe(fm.effort || "*(inherit)*");
    }
  });

  test("no removed role is still referenced as an agent", () => {
    const hits = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === "CHANGELOG.md") continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(md|js|mjs)$/.test(e.name) && !e.name.endsWith(".test.js")) {
          const src = readFileSync(p, "utf8");
          if (/devops:(gamer|windows)\b|agents\/(gamer|windows)\b|\*\*(gamer|windows)\*\* \|/.test(src)) hits.push(p);
        }
      }
    };
    walk(PLUGIN);
    expect(hits).toEqual([]);
  });
});
