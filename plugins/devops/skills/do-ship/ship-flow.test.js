import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Skill restructure PR 2 (docs/superpowers/specs/2026-09-24-skill-restructure-design.md):
// promote folded into do-ship — "ship" goes to alpha, a named beta/stable
// ships anything unshipped and then promotes, ending with ONE released card —
// and do-ship runs auto-harden + auto-polish diff-scoped at ship. These tests
// bind the skill prose to that contract.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
const PROMOTE = fs.readFileSync(path.join(__dirname, "modes", "promote.md"), "utf8");

function section(text, start, end) {
  const a = text.indexOf(start);
  expect(a, `heading not found: ${start}`).toBeGreaterThan(-1);
  const b = end ? text.indexOf(end, a + 1) : -1;
  return text.slice(a, b === -1 ? text.length : b);
}

describe("do-ship — target channel (promote folded in)", () => {
  const target = section(SKILL, "## Target channel", "## Composed ships");

  test("alpha is the default; beta/stable ship first, then promote", () => {
    expect(target).toMatch(/always lands on \*\*alpha\*\*/);
    expect(target).toMatch(/ship if\s+anything is unshipped, then promote/);
    expect(target).toContain("**Step 5d**");
    expect(target).toContain("**promotion only**");
    expect(target).toContain("modes/promote.md");
  });

  test("the channel comes from the hook's argument or the user's words, en + de", () => {
    expect(target).toContain("prompt.ship.detect");
    for (const phrase of ["ship stable", "promote to beta", "release beta", "auf stable heben", "/do-ship promote", "/promote"]) {
      expect(target, phrase).toContain(phrase);
    }
  });

  test("promotion stays a user decision — never from an orchestrator or under lockout", () => {
    expect(target).toMatch(/Promotion stays a user decision/);
    expect(target).toContain("$SHIP_LOCKOUT");
    expect(target).toMatch(/monotonicity, ancestry, immutability/);
  });

  test("the lockout table never promotes unattended", () => {
    const lockout = section(SKILL, "## Pre-Step A", "## Pre-Step B");
    expect(lockout).toMatch(/Step 5d — promotion.*never promote/);
  });

  test("Step 5d promotes the just-shipped version and falls back to ship-successful + open item", () => {
    const step = section(SKILL, "## Step 5d — Promote", "## Step 6");
    expect(step).toContain("ship_promote");
    expect(step).toMatch(/fast-track/);
    expect(step).toContain("$MAIN_REPO_ROOT");
    expect(step).toMatch(/deploy gate/);
    expect(step).toMatch(/never undoes the\s+ship/);
  });

  test("ONE card per run: a promotion renders released, never ship-successful first", () => {
    const card = section(SKILL, "## Step 6 — Completion Card", "### Session title on exit");
    expect(card).toMatch(/One card per run/);
    expect(card).toMatch(/ONE\s+`released` card — never a `ship-successful` card first/);
  });

  test("the promotion-only run is spared the compact stop, a ship-first promotion is not", () => {
    const compact = section(SKILL, "## Pre-Step 0", "## Pre-Step A");
    expect(compact).toMatch(/promotion-only/);
    expect(compact).toMatch(/has to ship first is a ship/);
  });

// Red-team R2(a)/(d): a named version is promotion-only (a stale card
  // click never ships later edits), and a stable run that skips the beta
  // soak says so on the card.
  test("a named version is promotion-only, whatever the tree holds", () => {
    expect(target).toMatch(/names a \*\*version\*\*.*never ship first, even with unshipped work/);
    const step = section(SKILL, "## Step 5d — Promote", "## Step 6");
    expect(step).toMatch(/A named version never triggers a ship/);
    const step2 = section(PROMOTE, "## Step 2", "## Step 3");
    expect(step2).toMatch(/\*\*A named version\*\*.*promotes exactly that version/s);
    expect(step2).toMatch(/never\s+ships first, even when the branch has unshipped work/);
  });

  test("a negated channel is a plain ship — the parser is named", () => {
    expect(target).toMatch(/\*\*negated\*\* channel/);
    expect(target).toContain("hooks/lib/ship-intent.js");
  });

  test("skipping the beta soak is an open item on the card, never silent", () => {
    const step = section(SKILL, "## Step 5d — Promote", "## Step 6");
    expect(step).toMatch(/\*\*Beta soak skipped\*\*/);
    expect(step).toContain("Beta übersprungen");
    expect(step).toContain("fastTrack: true");
    const step3 = section(PROMOTE, "## Step 3", "## Step 4");
    expect(step3).toContain("Beta übersprungen");
  });

  test("no phase-B placeholder is left", () => {
    expect(SKILL).not.toContain("PR2-phaseB");
    expect(PROMOTE).not.toContain("PR2-phaseB");
  });

  test("promote.md: a named channel answers the question, a bare promote still asks", () => {
    const step2 = section(PROMOTE, "## Step 2", "## Step 3");
    expect(step2).toMatch(/A channel named by the user answers this step/);
    expect(step2).toMatch(/A bare "promote"\*\* \(no channel\) asks/);
    const step4 = section(PROMOTE, "## Step 4", "## Rollback");
    expect(step4).toMatch(/run's ONE card/);
    expect(step4).toContain("**`released`**");
  });
});

describe("do-ship — harden + polish at ship (Step 1e)", () => {
  const passes = section(SKILL, "### 1e. Ship passes", "### Merge strategy decision");

  test("both passes are called with --invoked-by=ship, diff-scoped", () => {
    expect(passes).toContain("/auto-harden --invoked-by=ship --base=<base> [--cwd=<path>] <files of the diff>");
    expect(passes).toContain("/auto-polish --invoked-by=ship [--cwd=<path>] <ui files of the diff>");
  });

  test("findings: mechanical → fix, the rest → userFinalTest; never blocks", () => {
    expect(passes).toMatch(/mechanical: true/);
    expect(passes).toContain("userFinalTest");
    expect(passes).toMatch(/\*\*Never blocks\.\*\*/);
    expect(passes).toContain('method: "Harden (Ship)"');
  });

  test("strict mode: the passes run with --strict and apply nothing", () => {
    expect(passes).toMatch(/\*\*Strict mode\*\*/);
    expect(passes).toContain("--strict");
    expect(passes).toMatch(/nothing is applied/);
  });

// Red-team R3: on a composed ship (--cwd, e.g. auto-cleanup) the passes
  // diffed and fixed this session's own checkout. The target cwd is forwarded
  // and both skills document that --cwd scopes the diff AND the fixes.
  test("composed ships forward --cwd to both passes; both skills honour it", () => {
    expect(passes).toMatch(/pass the SAME `--cwd=<path>` to both\s+passes/);
    expect(passes).toContain("git -C <path>");
    const composed = section(SKILL, "## Composed ships", "## Pre-Step 0");
    expect(composed).toContain("both Step 1e passes get `--cwd=<path>`");
    for (const name of ["auto-harden", "auto-polish"]) {
      const text = fs.readFileSync(path.join(__dirname, "..", name, "SKILL.md"), "utf8");
      expect(text, name).toMatch(/argument-hint: .*\[--cwd=<path>\]/);
      expect(text, name).toMatch(/`--cwd=<path>` → the target checkout/);
      expect(text, name).toMatch(/never this session's own\s+checkout/);
    }
  });

  test("the frontmatter declares both calls", () => {
    const fm = SKILL.slice(0, SKILL.indexOf("\n---", 4));
    expect(fm).toMatch(/invokes: \[auto-harden, auto-polish\]/);
  });
});
