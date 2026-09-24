/**
 * Static-text regression tests for the /auto-agents plan template (Step 3).
 *
 * The plan is prose, so the only cheap guard for what it must show the user
 * before anything is spawned is asserting the wording:
 *
 *   1. The model column renders `model · effort`. Effort is fixed by the
 *      agent's frontmatter — the Agent tool has no effort parameter — so the
 *      plan is the one place the user sees the effective value up front.
 *   2. The complexity tier and its per-agent tool-call ceiling are a slot in
 *      the template, not a prose reminder: the budget every agent prompt will
 *      carry (§ Agent Prompt Template item 6) is visible before confirmation.
 *   3. `deep-knowledge/agent-orchestration.md` § Model & Effort Defaults stays
 *      the source of truth for that column — it describes the same rendering,
 *      names `fable` as an accepted override value, and its rows match the
 *      agents' frontmatter (a drifted row makes the plan lie).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(here, "..", "..");
const skill = readFileSync(join(here, "SKILL.md"), "utf8");
const orchestration = readFileSync(
  join(PLUGIN_ROOT, "deep-knowledge", "agent-orchestration.md"),
  "utf8",
);

function section(doc, startHeading, endHeading) {
  const start = doc.indexOf(startHeading);
  expect(start, `heading not found: ${startHeading}`).toBeGreaterThan(-1);
  const end = endHeading ? doc.indexOf(endHeading, start + 1) : doc.length;
  return doc.slice(start, end === -1 ? doc.length : end);
}

/** Cells of a markdown table row, trimmed. */
const cells = (row) => row.split("|").slice(1, -1).map((c) => c.trim());

const step3 = section(skill, "## Step 3 — Present Plan", "## Step 4 — Execution Mode");
const template = (() => {
  const m = step3.match(/```\n([\s\S]*?)```/);
  expect(m, "Step 3 has no fenced plan template").toBeTruthy();
  return m[1];
})();

describe("auto-agents plan template — model · effort column", () => {
  it("labels the column Model · Effort in both locales", () => {
    const row = step3.split("\n").find((l) => l.includes("`plan.model`"));
    expect(row, "label table lacks the plan.model row").toBeTruthy();
    expect(cells(row)).toEqual(["`plan.model`", "Model · Effort", "Modell · Effort"]);
  });

  it("renders every example agent as model · effort", () => {
    const rows = template.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      // `inherit` is the feature agent: model and effort come from the parent.
      expect(cells(row)[2], `row lacks effort: ${row}`).toMatch(
        /^(?:(?:sonnet|opus|haiku|fable) · (?:low|medium|high)(?:, )?)+$|^inherit$/,
      );
    }
  });

  it("shows a model override with the effort repeated on both sides", () => {
    expect(step3).toMatch(/sonnet · medium → opus · medium/);
  });

  it("states that effort cannot be overridden at invocation", () => {
    expect(step3).toMatch(/no effort\s+parameter/i);
  });
});

describe("auto-agents plan template — complexity tier and tool-call budget", () => {
  it("has a plan.budget label in both locales", () => {
    const row = step3.split("\n").find((l) => l.includes("`plan.budget`"));
    expect(row, "label table lacks the plan.budget row").toBeTruthy();
    const [, en, de] = cells(row);
    expect(en).toMatch(/tool-call budget/i);
    expect(de).toMatch(/Tool-Call-Budget/);
  });

  it("puts the budget line between the agents table and the dependencies", () => {
    const tableEnd = template.lastIndexOf("\n| ");
    const budget = template.indexOf("{plan.budget}");
    const deps = template.indexOf("### {plan.deps}");
    expect(budget, "template has no {plan.budget} slot").toBeGreaterThan(tableEnd);
    expect(budget).toBeLessThan(deps);
    expect(template.slice(budget, deps)).toMatch(/tool calls per agent/);
  });

  it("derives the ceiling from § Complexity Tiers with the documented ranges", () => {
    const at = step3.indexOf("**`{plan.budget}`");
    expect(at, "Step 3 has no {plan.budget} guidance paragraph").toBeGreaterThan(-1);
    const guidance = step3.slice(at);
    expect(guidance).toMatch(/§ Complexity Tiers/);
    expect(guidance).toMatch(/~5–15/);
    expect(guidance).toMatch(/~15–30/);
  });
});

describe("agent-orchestration.md § Model & Effort Defaults stays the source of truth", () => {
  const defaults = section(orchestration, "### Model & Effort Defaults", "### Complexity Tiers");

  it("describes the model · effort rendering of the plan column", () => {
    expect(defaults).toMatch(/`Model · Effort` column/);
    expect(defaults).toMatch(/`model · effort`/);
  });

  it("names fable as an accepted model value for upward overrides", () => {
    expect(defaults).toMatch(/`fable`/);
  });

  it("matches every roster row to the agent's frontmatter", () => {
    const rows = defaults.split("\n").filter((l) => /^\| \*\*[a-z]+\*\* \|/.test(l));
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      const [name, model, effort] = cells(row).map((c) => c.replace(/[*()]/g, ""));
      const body = readFileSync(join(PLUGIN_ROOT, "agents", `${name}.md`), "utf8");
      const fm = body.match(/^---\n([\s\S]*?)\n---/)[1];
      expect(fm.match(/^model:\s*(\S+)/m)?.[1], `${name}: model`).toBe(model);
      // feature inherits both from the parent session — no effort key at all.
      expect(fm.match(/^effort:\s*(\S+)/m)?.[1] ?? "inherit", `${name}: effort`).toBe(effort);
    }
  });
});

// PR 2 of the skill restructure (docs/superpowers/specs/2026-09-24-skill-restructure-design.md
// § auto-agents): this skill is the single execution path of every
// implementing skill and sits at the bottom of the call graph because it
// invokes NO skill. Shipping, concept pages and issues are returned to the
// caller instead.
const frontmatter = skill.slice(0, skill.indexOf("\n---", 4));
const body = skill.slice(skill.indexOf("\n---", 4) + 4);

describe("auto-agents invokes no skill", () => {
  it("declares an empty invokes list at the bottom layer", () => {
    expect(frontmatter).toMatch(/^invokes: \[\]$/m);
    expect(frontmatter).toMatch(/^layer: 5$/m);
  });

  it("does not pre-approve the Skill tool", () => {
    const tools = frontmatter.match(/^allowed-tools:(.*)$/m)[1];
    expect(tools.split(",").map((t) => t.trim())).not.toContain("Skill");
  });

  it("never tells the model or the user to start another devops skill", () => {
    // Slash forms of any devops skill, and a "run/invoke <skill>" instruction.
    expect(body).not.toMatch(/`\/(do-ship|do-run|auto-concept|auto-issue|auto-fix|auto-harden|auto-polish|ship|concept)\b/);
    expect(body).not.toMatch(/\b(invoke|run|call)\s+(the\s+)?(Skill\s+)?`?(do-ship|auto-concept|auto-issue)`?(?!\s+next)/i);
    expect(body).toMatch(/\*\*This skill invokes no skill\.\*\*/);
  });

  it("returns shipping to the caller as a result field", () => {
    const step7 = section(skill, "## Step 7 — Return to the caller", "## Rules");
    expect(step7).toMatch(/^ship: <auto \| manual>$/m);
    expect(step7).toMatch(/^needs-decision: /m);
    expect(step7).toMatch(/never ships/);
    expect(step7).toMatch(/`ship: auto` means the\s+caller runs `do-ship` next/);
  });
});

describe("auto-agents arguments — the mode comes from the caller", () => {
  const step1 = section(skill, "## Step 1 — Inputs", "## Step 2 — Tier and agents");

  it("documents --from, --mode and --ship", () => {
    for (const arg of ["`--from=<caller>`", "`--mode=interactive\\|background`", "`--ship=auto\\|manual`"]) {
      expect(step1, arg).toContain(arg);
    }
  });

  it("maps do-run's question 2 onto the execution mode", () => {
    expect(step1).toMatch(/\*\*Interaktiv · …\*\* → `interactive`, \*\*Autonom · …\*\* → `background`/);
  });

  it("asks the mode question only on a direct full-ceremony invocation", () => {
    const step4 = section(skill, "## Step 4 — Execution Mode", "## Step 5 — Start Table");
    expect(step4).toMatch(/Ask only when this skill was\s+invoked directly — no `--from`, no `--mode` — and the tier is full ceremony/);
  });

  it("reads plan and usage through get_usage", () => {
    expect(step1).toContain("mcp__plugin_devops_dotclaude-completion__get_usage");
    expect(step1).toMatch(/budget\.cls/);
  });
});

describe("auto-agents start table", () => {
  const step5 = section(skill, "## Step 5 — Start Table", "## Step 6 — Execution");
  const block = (() => {
    const m = step5.match(/```\n([\s\S]*?)```/);
    expect(m, "Step 5 has no fenced table shape").toBeTruthy();
    return m[1];
  })();

  it("has exactly the columns wave · task · model · effort, in that order", () => {
    const header = block.split("\n").find((l) => l.startsWith("| {start."));
    expect(cells(header)).toEqual(["{start.wave}", "{start.task}", "{start.model}", "{start.effort}"]);
    const rows = block.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(cells(row)).toHaveLength(4);
  });

  it("labels the columns in both locales", () => {
    const label = (key) => cells(step5.split("\n").find((l) => l.startsWith(`| \`${key}\``)));
    expect(label("start.wave")).toEqual(["`start.wave`", "Wave", "Wave"]);
    expect(label("start.task")).toEqual(["`start.task`", "Task", "Aufgabe"]);
    expect(label("start.model")).toEqual(["`start.model`", "Model", "Modell"]);
    expect(label("start.effort")).toEqual(["`start.effort`", "Effort", "Effort"]);
  });

  it("is card-style but carries no CTA and no completion-card marker", () => {
    expect(block.startsWith("---\n")).toBe(true);
    expect(block.trimEnd().endsWith("---")).toBe(true);
    expect(block).not.toContain("✨");
    expect(block).not.toMatch(/^## /m); // no decision heading
    expect(step5).toMatch(/\*\*has no CTA\*\*/);
  });

  it("is not shown for the inline tier", () => {
    expect(step5).toMatch(/\*\*Not for Inline\*\*/);
  });

  it("resolves the model at runtime — never a hard-coded id or version", () => {
    expect(step5).toMatch(/Agent tool's `model`\s+parameter enum/);
    expect(step5).toMatch(/`inherit` → the session's own model/);
    expect(step5).toMatch(/newest release/);
    // No model id or "family + version" anywhere in the skill.
    expect(skill).not.toMatch(/claude-(opus|sonnet|haiku|fable)-\d/);
    expect(skill).not.toMatch(/\b(opus|sonnet|haiku|fable) \d+(\.\d+)?\b/i);
  });

  it("gives effort per task, never with an arrow", () => {
    expect(step5).toMatch(/\*\*Effort — per task\.\*\*/);
    const rows = block.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    for (const row of rows) expect(cells(row)[3]).not.toContain("→");
  });
});
