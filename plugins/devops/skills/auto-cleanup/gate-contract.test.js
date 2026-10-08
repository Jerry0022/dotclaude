import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The gate-critical contract of /auto-cleanup (#653): nothing is deleted or
// shipped without the Apply-Manifest + Dry-Run-Confirm, unmerged work is never
// pre-selected for deletion, live sessions are untouchable, and the protected
// set is rebuilt before every destructive action. A skill trim may cut words,
// never one of these.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const flat = (s) => s.replace(/\n>[ \t]?/g, "\n").replace(/\s+/g, " ");
const SKILL = read("SKILL.md");
const EXEC = read("deep-knowledge", "execution.md");

function section(text, start, end) {
  const a = text.indexOf(start);
  expect(a, `heading not found: ${start}`).toBeGreaterThan(-1);
  const b = end ? text.indexOf(end, a + 1) : -1;
  return flat(text.slice(a, b === -1 ? text.length : b));
}

describe("auto-cleanup gate contract — steps", () => {
  test("every step heading exists verbatim and in order", () => {
    const got = SKILL.split("\n").filter((l) => /^## /.test(l));
    expect(got).toEqual([
      "## Where this skill sits",
      "## Step 0 — Repo-mode check",
      "## SAFETY: Worktree Branch Protection",
      "## Step 1 — Repo Context",
      "## Step 2 — Fetch & Sync",
      "## Step 3 — Branch Classification",
      "## Step 4 — Remote Branch Audit",
      "## Step 5 — PR Cross-Reference + Open-PR Inventory",
      "## Step 6 — Local vs Remote Main Sync",
      "## Step 7 — Gather Inline Detail Data",
      "## Step 8 — Generate Concept Page",
      "## Step 9 — Open & Monitor",
      "## Step 10 — Execute Decisions",
      "## Step 11 — Completion Card",
      "## Rules",
    ]);
    expect(EXEC.split("\n").filter((l) => /^## /.test(l))).toEqual([
      "## Step 10a — Apply-Manifest + Dry-Run-Confirm",
      "## Step 10b — Ship Queue (before any cleanup)",
      "## Step 10c — Cleanup Execution",
      "## Safety Invariants",
      "## Worktree Removal Safety",
    ]);
  });

  test("a non-git directory aborts before any git command", () => {
    const s = section(SKILL, "## Step 0", "## SAFETY");
    expect(s).toContain("git rev-parse --is-inside-work-tree");
    expect(s).toMatch(/abort/i);
  });
});

describe("auto-cleanup gate contract — confirm before anything runs", () => {
  test("Step 10 loads execution.md before any ship, delete or removal", () => {
    const s = section(SKILL, "### Steps 10a–10c", "## Step 11");
    expect(s).toContain("deep-knowledge/execution.md");
    expect(s).toMatch(/no ship, no delete and no worktree removal before it is in context/);
    expect(s).toMatch(/nothing runs without the user's explicit yes/);
  });

  test("10a shows the Apply-Manifest and waits for an explicit Dry-Run-Confirm", () => {
    const s = section(EXEC, "## Step 10a", "## Step 10b");
    expect(s).toContain("Folgende Aktionen werden ausgeführt:");
    expect(s).toMatch(/\*\*Dry-Run-Confirm\*\* prompt before executing/);
    expect(s).toMatch(/NICHT rückgängig/);
    expect(s).toMatch(/\[Ja\] \[Abbrechen\]/);
    expect(s).toMatch(/Only proceed after explicit confirmation\./);
  });

  test("10c runs only after the confirm and after the ship queue", () => {
    expect(section(EXEC, "## Step 10c", "## Safety Invariants")).toMatch(/Execute in order after Dry-Run-Confirm and after the ship queue \(10b\)/);
  });
});

describe("auto-cleanup gate contract — unmerged work and live sessions", () => {
  test("only merged branches are pre-checked; unmerged default to keep", () => {
    const s = section(SKILL, "## Step 3", "## Step 4");
    expect(s).toMatch(/🟢 \*\*Löschbar\*\* \| MERGED or SQUASH-MERGED Git-Sessions \| Pre-checked \(delete\)/);
    expect(s).toMatch(/🟡 \*\*Untersuchen\*\* \| UNMERGED Git-Sessions \(no PR or open PR\) \| Unchecked \(keep\)/);
    expect(s).toMatch(/`git merge-base --is-ancestor <branch> origin\/main`/);
  });

  test("clean sessions are never pre-checked; dirty ones get no destructive control", () => {
    expect(section(SKILL, "## Step 2", "## Step 3")).toMatch(/clean Aktive Sessions are placed in the Löschbar group but NOT pre-checked/);
    const w = section(EXEC, "## Worktree Removal Safety", null);
    expect(w).toMatch(/must NOT render any DESTRUCTIVE action controls/);
    expect(w).toMatch(/\*\*Never force-remove:\*\*/);
    expect(w).toMatch(/do NOT retry with `--force`/);
  });

  test("live sessions are untouchable; membership by exact ref only", () => {
    const s = section(SKILL, "## SAFETY", "## Step 1");
    expect(s).toMatch(/\*\*HARD RULE — no exceptions:\*\*/);
    expect(s).toMatch(/UNTOUCHABLE/);
    expect(s).toMatch(/\*\*The protected set is a set of subjects, not a list of verbs\.\*\*/);
    expect(s).toContain("git worktree list --porcelain");
    expect(s).toContain("grep -qxF");
    expect(s).toMatch(/NEVER test membership by prefix or substring/);
  });

  test("the protected set is rebuilt immediately before every destructive action", () => {
    expect(section(SKILL, "## SAFETY", "## Step 1")).toMatch(/\*\*Re-check before every destructive action\.\*\*/);
    const s10 = section(SKILL, "## Step 10", "### Steps 10a–10c");
    expect(s10).toMatch(/\*\*Re-check worktree branches\*\*.*NEVER trust cached data for deletion/);
    expect(s10).toContain("scripts/repo-health-audit.js");
    expect(s10).toMatch(/`main`\/`master`\/`HEAD`\/`origin`\/default branch are refused here by name/);
    const inv = section(EXEC, "## Safety Invariants", "## Worktree Removal Safety");
    expect(inv).toMatch(/\*\*Never delete a worktree-attached branch\*\* — even if checked by the user/);
    expect(inv).toMatch(/\*\*Re-validate before every delete\*\*/);
  });

  test("candidates come from the truth sources and pass the audit", () => {
    expect(section(SKILL, "## Step 2", "## Step 3")).toMatch(/NEVER from `git branch -a`, `refs\/remotes\/\*` or `%\(refname:short\)`/);
    expect(section(SKILL, "## Step 3", "## Step 4")).toMatch(/Never render a candidate set that has not passed this audit/);
  });
});

describe("auto-cleanup gate contract — ship queue and card", () => {
  test("open PRs land only through the full /do-ship pipeline, never gh pr merge", () => {
    const q = section(EXEC, "## Step 10b", "## Step 10c");
    expect(q).toContain('Skill("devops:do-ship", args: "--cwd=<path> --keep --queued")');
    expect(q).toMatch(/Never `gh pr merge` directly/);
    expect(q).toContain(".claude/.ship-queue");
    expect(q).toMatch(/oldest PR first/);
    expect(section(SKILL, "### Steps 10a–10c", "## Step 11")).toMatch(/never `gh pr merge`/);
  });

  test("foreign PRs are never selectable", () => {
    expect(section(SKILL, "### 5b", "## Step 6")).toMatch(/`fremd` \| not the viewer's PR \| .*\(never selectable\)/);
  });

  test("the completion card variant table and the verbatim-last rule", () => {
    const c = section(SKILL, "## Step 11", "## Rules");
    expect(c).toMatch(/`ship-successful` \(needs `state\.pushed` \+ `state\.merged`; any doubt → `ready`\)/);
    for (const v of ["`ship-blocked`", "`ready`", "`analysis`", "`aborted`"]) expect(c, v).toContain(v);
    expect(c).toMatch(/Output the markdown VERBATIM as the LAST thing/);
  });
});
