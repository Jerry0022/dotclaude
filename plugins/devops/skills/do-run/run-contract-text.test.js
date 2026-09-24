/**
 * Pins the run-contract doc/skill text (spec § I,
 * docs/superpowers/specs/2026-09-24-run-contract-design.md): do-run gains a
 * Step 5b and drops the Inline shortcut, backlog.md ships only through
 * devops:do-ship, auto-agents names the do-run exception, and the
 * deep-knowledge reference names the CLI verbs and the kill switch.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const doRunSkill = read(join(here, "SKILL.md"));
const backlog = read(join(here, "modes", "backlog.md"));
const autonomous = read(join(here, "modes", "autonomous.md"));
const autoAgents = read(join(here, "..", "auto-agents", "SKILL.md"));
const doBatch = read(join(here, "..", "do-batch", "SKILL.md"));
const runContractDoc = read(join(here, "..", "..", "deep-knowledge", "run-contract.md"));

describe("do-run SKILL.md — run contract", () => {
  it("has a Step 5b run-contract section", () => {
    expect(doRunSkill).toMatch(/## Step 5b — Run contract/);
  });

  it("no longer offers the Inline shortcut around auto-agents", () => {
    expect(doRunSkill).not.toMatch(/\*\*Inline shortcut:\*\*/);
  });

  it("Step 7 says the passes and ship are gated", () => {
    const step7 = doRunSkill.slice(doRunSkill.indexOf("## Step 7"), doRunSkill.indexOf("## Rules"));
    expect(step7).toMatch(/\*\*Gated\.\*\*/);
    expect(step7).toMatch(/never the\s+`ship_\*` MCP tools directly/);
  });

  it("Rules say every chosen pass runs or is skipped with a reason", () => {
    expect(doRunSkill).toMatch(/Every chosen pass runs, or is skipped\s+with a reason that the card shows/);
  });
});

describe("do-run backlog mode — ships only via devops:do-ship", () => {
  it("names Skill(\"devops:do-ship\", ...) and forbids direct ship_* calls", () => {
    expect(backlog).toMatch(/Skill\("devops:do-ship",\s*"--queued=<n>\/<N>\s*--keep"\)/);
    expect(backlog).toMatch(/NEVER the ship_\* MCP tools directly/);
  });

  it("Step 5 closes the run contract", () => {
    const step5 = backlog.slice(backlog.indexOf("## Step 5 — Completion"), backlog.indexOf("## Artifacts"));
    expect(step5).toMatch(/run-contract\.js" done/);
  });
});

describe("do-run autonomous mode — aborts or closes the contract", () => {
  it("aborts the contract before an INTERRUPTED/BLOCKED card", () => {
    expect(autonomous).toMatch(/run-contract\.js" abort --reason/);
  });

  it("closes the contract at Step 8 if still open", () => {
    expect(autonomous).toMatch(/run-contract\.js" done/);
  });
});

describe("auto-agents SKILL.md — do-run exception to the Inline skip", () => {
  it("names the do-run exception and points at the run-contract doc", () => {
    expect(autoAgents).toMatch(/except inside a do-run run/);
    expect(autoAgents).toMatch(/deep-knowledge\/run-contract\.md/);
  });

  it("still keeps the pinned 'Not for Inline' marker in Step 5", () => {
    expect(autoAgents).toMatch(/\*\*Not for Inline\*\*/);
    expect(autoAgents).toMatch(/`▶ Inline · <reason: domains, ~files>`/);
  });
});

describe("do-batch SKILL.md — hand-off gate", () => {
  it("names the hook-enforced hand-off and the batch-handoff marker", () => {
    expect(doBatch).toMatch(/batch-handoff\.json/);
    expect(doBatch).toMatch(/Hook-enforced, not just written down/);
  });
});

describe("deep-knowledge/run-contract.md", () => {
  it("exists and names skip, done, abort and the kill switch", () => {
    expect(runContractDoc).toMatch(/^# Run Contract/);
    expect(runContractDoc).toMatch(/run-contract\.js" skip/);
    expect(runContractDoc).toMatch(/run-contract\.js" done/);
    expect(runContractDoc).toMatch(/run-contract\.js" abort/);
    expect(runContractDoc).toMatch(/DOTCLAUDE_RUN_CONTRACT=off/);
  });
});
