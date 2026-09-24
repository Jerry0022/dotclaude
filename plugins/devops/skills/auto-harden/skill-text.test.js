import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Skill restructure PR 2: auto-harden and auto-polish are layer-4 passes.
// Their callers are the user, do-run and do-ship (never auto-agents, which is
// the layer they execute through); do-ship calls both diff-scoped with
// --invoked-by=ship. These tests bind both skills' prose to that contract.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARDEN = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
const POLISH = fs.readFileSync(path.join(__dirname, "..", "auto-polish", "SKILL.md"), "utf8");

function section(text, start, end) {
  const a = text.indexOf(start);
  expect(a, `heading not found: ${start}`).toBeGreaterThan(-1);
  const b = end ? text.indexOf(end, a + 1) : -1;
  return text.slice(a, b === -1 ? text.length : b);
}

describe.each([
  ["auto-harden", HARDEN],
  ["auto-polish", POLISH],
])("%s — callers and execution", (name, text) => {
  test("no phase-B placeholder is left", () => {
    expect(text).not.toContain("PR2-phaseB");
  });

  test("callers are do-run and do-ship; auto-agents never calls it", () => {
    const ctx = section(text, "## Invocation Context", "## Execution");
    expect(ctx).toContain("--invoked-by=do-run");
    expect(ctx).toContain("--invoked-by=ship");
    expect(ctx).toMatch(/`\/auto-agents` \(layer 5\) never calls it/);
  });

  test("accepts --strict (stay in scope, report wider findings)", () => {
    const args = section(text, "## Step 1 — Parse Arguments", "## ");
    expect(args).toContain("`--strict`");
    expect(args).toContain("`--invoked-by=do-run|ship`");
    expect(text).toMatch(/`--strict` narrows, never widens/);
  });

  test("executes through auto-agents with --from, --mode and ignores its ship field", () => {
    const exec = section(text, "## Execution — through auto-agents", "## Step 0");
    expect(exec).toContain(`--from=${name}`);
    expect(exec).toMatch(/--mode=background` under `--autonomous`, else `--mode=interactive`/);
    expect(exec).toMatch(/\*\*ignore `ship`\*\*/);
    expect(exec).toMatch(/Inline shortcut/);
  });

  test("frontmatter: layer 4, invokes only auto-agents, hint names the new values", () => {
    const fm = text.slice(0, text.indexOf("\n---", 4));
    expect(fm).toMatch(/^layer: 4$/m);
    expect(fm).toMatch(/^invokes: \[auto-agents\]$/m);
    expect(fm).toMatch(/argument-hint: .*--strict.*--invoked-by=do-run\|ship/);
  });
});

describe("auto-harden — ship path (diff-scoped, like polish's rules-only path)", () => {
  const ship = section(HARDEN, "## Ship path — `$SHIP_PATH=1`", "## Step 2");

  test("static, inline, bounded — no agents, no browser, no test run", () => {
    expect(ship).toMatch(/no\s+agents, no browser, no network, no test run/);
    expect(ship).toMatch(/Budget ~60 s/);
    expect(ship).toContain("git -C <cwd> diff -U0 origin/<base>...HEAD");
  });

  // Red-team R3: a composed /do-ship --cwd=<path> must diff AND fix the
  // target checkout, never this session's own.
  test("--cwd scopes the diff and the fixes to the target checkout", () => {
    expect(ship).toMatch(/`<cwd>` = `--cwd`, else the\s+session's cwd; the fixes of step 4 edit files under that same `<cwd>`/);
    const parse = section(HARDEN, "## Step 1 — Parse Arguments", "## Ship path");
    expect(parse).toMatch(/`--cwd=<path>` → the target checkout/);
    expect(parse).toMatch(/scopes BOTH the diff and the fixes/);
  });

  test("mechanical fixes only; strict applies none; returns a structure, no card", () => {
    for (const id of ["H1", "H2", "H3", "H4", "H5", "H6", "H7"]) expect(ship).toContain(`| ${id} |`);
    expect(ship).toMatch(/unless `\$STRICT=1`, then apply none/);
    expect(ship).toMatch(/No completion card, no AskUserQuestion/);
  });

  test("never blocks — only ship_build's red stops a ship", () => {
    expect(ship).toMatch(/\*\*Never blocks\.\*\*/);
    expect(ship).toContain("ship_build");
  });
});
