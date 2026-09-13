/**
 * Static-text regression tests for the /run-agents plan template (Step 3).
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

describe("run-agents plan template — model · effort column", () => {
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

describe("run-agents plan template — complexity tier and tool-call budget", () => {
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
