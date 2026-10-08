import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The gate-critical contract of /do-ship (#653). Skill trims cut words inside
// steps; these tests make sure a trim can never silently drop a gate, rename a
// step a project extension hooks into, or lose a `cwd`. They pin decisions and
// identifiers, not prose: change one only together with the gate it guards.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
const ALL = [SKILL, ...["modes", "deep-knowledge"].flatMap((d) =>
  fs.readdirSync(path.join(__dirname, d)).filter((f) => f.endsWith(".md"))
    .map((f) => fs.readFileSync(path.join(__dirname, d, f), "utf8")))].join("\n");

// Whitespace and blockquote markers are layout, not contract.
const flat = (s) => s.replace(/\n>[ \t]?/g, "\n").replace(/\s+/g, " ");
function section(start, end) {
  const a = SKILL.indexOf(start);
  expect(a, `heading not found: ${start}`).toBeGreaterThan(-1);
  const b = end ? SKILL.indexOf(end, a + 1) : -1;
  return flat(SKILL.slice(a, b === -1 ? SKILL.length : b));
}

// Every heading, in order. Project extensions ("Step 6.5", "Step 8"), hooks,
// tests and the run map reference these by number and name.
const HEADINGS = [
  "## Pipeline at a glance",
  "## Target channel — alpha by default, beta / stable on request",
  "## Composed ships — `--cwd`, `--keep`, `--queued`, the queue marker",
  "## Pre-Step 0 — Large context: ship in a subagent (the hook decides, this skill obeys)",
  "## Pre-Step R — Resume an interrupted ship (`--resume`)",
  "## Pre-Step A — Autonomous Lockout Detection",
  "## Pre-Step B — Session Activity Guard",
  "## Pre-Step C — Mark the session in the sidebar",
  "## Step 0 — Load Extensions",
  "## Step 0.5 — Load Deferred MCP Schemas",
  "## Step 1 — Pre-Flight & Rebase Loop",
  "### 1a. Run preflight",
  "### 1a-ii. Read `mode` — the repo-mode fork",
  "### 1b. Resolve merge-safety warnings",
  "### 1c. Re-run preflight",
  "### 1d. Purpose Alignment Gate",
  "### 1e. Ship passes — harden + polish, diff-scoped",
  "### Merge strategy decision",
  "## Step 2 — Build + Quality Gates",
  "### Codex Review Gate (after build passes)",
  "## Step 2.5 — Deploy-Parity Build",
  "## Step 2.6 — Docs-Sync",
  "## Step 3 — Version Bump",
  "## Step 4 — Release",
  "### Squash-Merge Traceability Convention",
  "### Step 4a — Delivery extension hook",
  "## Step 4b — Spawn Post-Merge Watcher (final ship only)",
  "## Step 4c — Live Surface Verification (final ship only)",
  "## Step 4d — Out-of-Band Deploy Gate (final ship only)",
  "## Step 5a — Continue-Intent Check (auto-detect keep-mode)",
  "### Signals that trigger keep-mode",
  "## Step 5b — Cleanup (normal mode)",
  "### Substep 1 — Capture session context",
  "### Substep 2 — Exit worktree + ship_cleanup",
  "### Substep 3 — Re-open session-opened files from main-repo path",
  "## Step 5c — Keep-mode cleanup (sentinel only)",
  "## Step 5d — Promote (beta / stable requested)",
  "## Step 5e — Memory Dream (silent, before the card)",
  "## Step 6 — Completion Card",
  "### Session title on exit (carried by the card result)",
  "### Session archive on exit (carried by the card result, #632)",
  "### Promotion-gap nudge (final ship to main without a promotion — MANDATORY)",
  "### Post-ship hygiene (merged ship or promotion — MANDATORY)",
  "## Reference files — every one is one level from here",
];

describe("do-ship gate contract — pipeline steps", () => {
  test("every step heading exists verbatim, in pipeline order, nothing merged or renumbered", () => {
    const got = SKILL.split("\n").filter((l) => /^#{2,3} /.test(l));
    expect(got).toEqual(HEADINGS);
  });

  test("the run map lists every step group and the ship_* call that ends it", () => {
    const glance = section("## Pipeline at a glance", "## Target channel");
    for (const row of ["Pre-Steps 0, R, A–C", "| 0 / 0.5 |", "| 1 |", "| 2 |", "| 2.5 / 2.6 |", "| 3 |", "| 4 |",
      "| 4a–4d |", "| 5a–5c |", "| 5d |", "| 5e, 6 |"]) expect(glance, row).toContain(row);
    for (const call of ["`ship_preflight`", "`ship_build`", "`ship_version_bump`", "`ship_release`", "`ship_cleanup`",
      "`ship_promote`", "`ship_hygiene`", "`render_completion_card`"]) expect(glance, call).toContain(call);
  });
});

describe("do-ship gate contract — cwd on every ship call", () => {
  test("the cwd rule is stated up front", () => {
    const head = flat(SKILL.slice(0, SKILL.indexOf("## Pipeline at a glance")));
    expect(head).toMatch(/Every `ship_\*` tool call MUST include `cwd`/);
  });

  test("every ship_*/render call example in the skill passes cwd", () => {
    const calls = flat(SKILL).match(/\b(ship_[a-z_]+)\(\{[^}]*\}\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const c of calls) {
      // shorthands that point back at a full call shown elsewhere
      if (/^ship_cleanup\(\{ ?(?:\.\.\., )?keep: true ?\}\)$/.test(c)) continue;
      expect(c, c).toMatch(/\bcwd\b/);
    }
  });

  test("each pipeline tool is actually called in its step, with cwd", () => {
    expect(section("### 1a. Run preflight", "### 1a-ii")).toContain('ship_preflight({ cwd: "<current working directory>" })');
    expect(section("## Step 2 —", "### Codex Review Gate")).toMatch(/ship_build\(\{ [^}]*cwd: "<cwd>" \}\)/);
    expect(section("## Step 3 —", "## Step 4 —")).toContain('ship_version_bump({ bump: "minor", cwd: "<cwd>" })');
    expect(section("## Step 4 —", "### Squash-Merge")).toContain("`ship_release`");
    expect(section("### Substep 2", "### Substep 3")).toContain('ship_cleanup({ branch: "claude/feature-branch", base: "main", cwd: "<cwd>" })');
    expect(section("## Step 5c", "## Step 5d")).toContain('ship_cleanup({ branch: "claude/feature-branch", base: "main", cwd: "<cwd>", keep: true })');
    expect(section("### Post-ship hygiene", "## Reference files")).toContain('ship_hygiene({ cwd: "<cwd>", trigger: "ship", lang: "de" })');
    expect(section("## Step 6 —", "### Session title")).toMatch(/`cwd` is required for clickable links/);
  });

  test("composed ships route every ship_* call and git command to --cwd, never ExitWorktree", () => {
    const composed = section("## Composed ships", "## Pre-Step 0");
    expect(composed).toMatch(/Every `ship_\*` MCP call passes this path as `cwd`/);
    expect(composed).toContain("`git -C <path>`");
    expect(composed).toMatch(/`ExitWorktree` is \*\*never\*\* called/);
    expect(composed).toMatch(/`--cwd` implies `--keep`/);
  });
});

describe("do-ship gate contract — schemas, tools absent, no improvised ship", () => {
  test("Step 0.5 loads all six ship tool schemas in one ToolSearch select", () => {
    const s = section("## Step 0.5", "## Step 1 —");
    expect(s).toContain("select:mcp__plugin_devops_dotclaude-ship__ship_preflight,mcp__plugin_devops_dotclaude-ship__ship_build,mcp__plugin_devops_dotclaude-ship__ship_version_bump,mcp__plugin_devops_dotclaude-ship__ship_release,mcp__plugin_devops_dotclaude-ship__ship_cleanup,mcp__plugin_devops_dotclaude-ship__ship_hygiene");
    expect(s).toMatch(/do NOT improvise a ship with `gh pr create`/i);
    expect(s).toContain("mcp-server/ship/cli.js");
    expect(s).toContain("deep-knowledge/manual-ship.md");
  });

  test("a large-context ship runs no ship_* call and no push in the parent", () => {
    expect(section("## Pre-Step 0", "## Pre-Step R")).toMatch(/Run no `ship_\*` call and no git push or merge/);
  });
});

describe("do-ship gate contract — lockout", () => {
  const lockout = section("## Pre-Step A", "## Pre-Step B");

  test("lockout is detected first, persisted in a marker and re-derived at every gate", () => {
    expect(lockout).toContain('node "{PLUGIN_ROOT}/scripts/autonomous-lockout.js" check');
    expect(lockout).toContain(".claude/.ship-lockout");
    expect(lockout).toMatch(/at every interactive gate re-derive `\$SHIP_LOCKOUT=true` when the marker file exists/);
    expect(lockout).toMatch(/Clear the marker in Step 5 cleanup \(delete `\.claude\/\.ship-lockout`\)/);
    expect(lockout).toMatch(/treat it as \*\*not locked\*\*/);
  });

  test("under lockout AskUserQuestion is never called; each gate BLOCKs or records", () => {
    expect(lockout).toMatch(/never call `AskUserQuestion`/);
    expect(lockout).toMatch(/\*\*BLOCK\*\* → stop the pipeline, call `render_completion_card` with variant `ship-blocked`/);
    expect(lockout).toMatch(/\*\*RECORD & CONTINUE\*\*/);
    const rows = {
      "Pre-Step B": /in-scope activity pending → \*\*BLOCK\*\*/,
      "Step 1b(e)": /`git rebase --abort` → \*\*BLOCK\*\*/,
      "Step 1d": /high-impact items → \*\*RECORD & CONTINUE\*\*/,
      "Step 1e": /never BLOCK/,
      "Step 5d": /never promote/,
      "Step 2 — Codex": /design\/logic\/security → \*\*BLOCK\*\*/,
      "Step 3 — major": /\*\*BLOCK\*\* \("needs major-version decision/,
    };
    for (const [gate, re] of Object.entries(rows)) expect(lockout, gate).toMatch(re);
  });

  test("each interactive gate repeats its lockout branch in place", () => {
    expect(section("## Pre-Step B", "## Pre-Step C")).toMatch(/If `\$SHIP_LOCKOUT`.*\*\*BLOCK\*\*/);
    expect(section("### 1b.", "### 1c.")).toMatch(/If `\$SHIP_LOCKOUT`.*`git rebase --abort`, \*\*BLOCK\*\*/);
    expect(section("### 1d.", "### 1e.")).toMatch(/If `\$SHIP_LOCKOUT`.*\*\*RECORD & CONTINUE\*\*/);
    expect(section("### Codex Review Gate", "## Step 2.5")).toMatch(/If `\$SHIP_LOCKOUT`.*\*\*BLOCK\*\*/);
    expect(section("## Step 3 —", "## Step 4 —")).toMatch(/\*\*major\*\*: always ask user via AskUserQuestion\. \*\*If `\$SHIP_LOCKOUT`.*\*\*BLOCK\*\*/);
  });
});

describe("do-ship gate contract — blocked exits and sentinel hygiene", () => {
  test("every ship-blocked exit calls ship_cleanup keep:true first", () => {
    expect(section("## Pipeline at a glance", "## Target channel")).toContain("Every `ship-blocked` exit calls `ship_cleanup({ keep: true })` first");
    const hygiene = section("> **Sentinel hygiene", "## Step 0 —");
    expect(hygiene).toMatch(/before rendering ANY `ship-blocked` card, first call `ship_cleanup\(\{ branch, cwd, keep: true \}\)`/);
  });

  test("each hard stop renders ship-blocked", () => {
    expect(section("### 1a. Run preflight", "### 1a-ii")).toMatch(/`ready: false` → report errors and \*\*STOP\*\*/);
    expect(section("## Step 2 —", "### Codex Review Gate")).toMatch(/`success: false` → call `render_completion_card` with variant `ship-blocked`/);
    expect(section("## Step 2.5", "## Step 2.6")).toMatch(/`failed` → \*\*STOP\*\* with `ship-blocked` \(also under `\$SHIP_LOCKOUT`\)/);
    expect(section("## Step 3 —", "## Step 4 —")).toMatch(/`success: false` → no version file found\..*`ship-blocked`/);
    expect(section("## Step 4 —", "### Squash-Merge")).toMatch(/If `success: false` → do NOT proceed to cleanup\..*`ship-blocked`/);
  });
});

describe("do-ship gate contract — release results", () => {
  const release = section("## Step 4 —", "### Squash-Merge");

  test("a landed merge is never retried; success alone is never a merge", () => {
    expect(release).toMatch(/`merged` present → the PR IS on base\. Never retry `ship_release`/);
    expect(release).toMatch(/Never read `success: true` alone as a merge/);
  });

  test("validation gaps, git-probe-timeout and rebaseRequired keep their actions", () => {
    expect(release).toContain('reason: "validation-gaps"');
    expect(release).toMatch(/`acceptGaps: true` only when the user said to ship as-is/);
    expect(release).toMatch(/`reason: "git-probe-timeout"`.*\*\*retry the same call once\*\*.*second timeout → BLOCK/i);
    expect(release).toMatch(/`rebaseRequired: true`.*Go back to Step 1b/);
    expect(release).toMatch(/`baseAdvancedDuringChecks: true`/);
    expect(release).toMatch(/\*\*Step 1d full check\*\*/);
    expect(release).toContain("checksBlocked: true");
  });

  test("the merge strategy follows the final preflight's file-overlap", () => {
    const m = section("### Merge strategy decision", "## Step 2 —");
    expect(m).toMatch(/No overlap\*\* → use `mergeStrategy: "squash"`/);
    expect(m).toMatch(/Overlap detected\*\* → use `mergeStrategy: "merge"`/);
  });
});

describe("do-ship gate contract — safety", () => {
  test("no plain force-push anywhere in the skill, only --force-with-lease", () => {
    const bad = ALL.split("\n").filter((l) => /\bgit\b[^`]*\bpush\b[^`]*?(?:--force(?!-with-lease)|\s-f\b)/.test(l));
    expect(bad).toEqual([]);
    expect(section("### 1b.", "### 1c.")).toContain("`git push --force-with-lease`");
  });

  test("Codex runs only through codex-safe.sh, never /codex:rescue, with the rc table", () => {
    const codex = section("### Codex Review Gate", "## Step 2.5");
    expect(codex).toContain('bash "{PLUGIN_ROOT}/scripts/codex-safe.sh"');
    expect(codex).toMatch(/Do NOT use the `\/codex:rescue` Agent tool/);
    for (const rc of ["rc=0", "rc=75", "rc=124", "rc=126", "rc=127", "other non-zero"]) expect(codex, rc).toContain(rc);
    expect(codex).toMatch(/rc=124\*\*.*Do NOT retry, do NOT block the ship/);
    expect(codex).toMatch(/rc=75\*\*.*Do NOT retry/);
  });

  test("cleanup touches only the own branch, only after a confirmed merge, stops on ExitWorktree failure", () => {
    const s = section("### Substep 2", "### Substep 3");
    expect(s).toMatch(/If `ExitWorktree` \*\*fails\*\*.*\*\*STOP\*\*/);
    expect(s).toMatch(/do \*\*NOT\*\* force-remove the directory the session lives in/);
    expect(s).toMatch(/\*\*Only own branch\/worktree\.\*\* Never clean up other branches or worktrees\./);
    expect(s).toMatch(/\*\*Only after confirmed merge\.\*\* If Step 4 failed, preserve everything\./);
  });
});

describe("do-ship gate contract — keep / queued / delegated", () => {
  test("keep-mode: harness worktree → keep without state.kept; signals → state.kept", () => {
    const k = section("## Step 5a", "## Step 5b");
    expect(k).toMatch(/\*\*Harness-created worktree → keep-mode, always \(#442\)\.\*\*/);
    expect(k).toMatch(/\*\*Never print git commands for the user to run after a ship\*\*/);
    expect(k).toMatch(/\*\*Default is normal cleanup\.\*\*/);
    expect(k).toMatch(/A weak or borderline signal → \*\*normal cleanup\*\*/);
    const c = section("## Step 5c", "## Step 5d");
    expect(c).toMatch(/Do NOT call `ExitWorktree`.*Do NOT delete the branch/);
    expect(c).toMatch(/\*\*Deliberate keep\*\*.*`state\.kept: true`/);
    expect(c).toMatch(/\*\*Harness-created worktree\*\*.*no `state\.kept`/);
  });

  test("queued ships skip ship_hygiene; the queue marker defers install-mutating extension steps", () => {
    const composed = section("## Composed ships", "## Pre-Step 0");
    expect(composed).toMatch(/`--queued`.*Step 6 skips `ship_hygiene`/);
    expect(composed).toMatch(/Project ship extensions MUST skip any post-ship step that mutates this install/);
    expect(composed).toMatch(/older than 6 h/);
    expect(composed).toMatch(/Not a lockout/);
    expect(section("### Post-ship hygiene", "## Reference files")).toMatch(/Skip it for `--queued` ships.*and for every blocked or aborted run/);
  });

  test("promotion is never autonomous", () => {
    expect(section("## Target channel", "## Composed ships")).toMatch(/Never promote on a channel that did not come from the user/);
  });
});

describe("do-ship gate contract — completion card", () => {
  const card = section("## Step 6 —", "## Reference files");

  test("variant follows what the pipeline did; merged is never downgraded to ready", () => {
    expect(card).toMatch(/`merged` \(\+ `tag` where applicable\) ⇒ `ship-successful`\. Never downgrade to `ready`/);
    expect(card).toMatch(/ONE `released` card — never a `ship-successful` card first/);
    expect(card).toMatch(/`state\.deployPending: true` and the `deployGate` array/);
  });

  test("the card is the last action: verbatim, nothing after it, extension steps before the widget", () => {
    expect(card).toMatch(/Output the card markdown VERBATIM/);
    expect(card).toMatch(/\*\*The card ends the run — nothing after it\.\*\*/);
    expect(card).toMatch(/runs between that call and the Desktop `show_widget` call, never after the widget/);
    expect(card).toMatch(/execute it \*\*before\*\* outputting the card/);
    expect(section("## Step 5e", "## Step 6 —")).toMatch(/Runs \*\*before\*\* the completion card/);
  });

  test("archive only when the hook releases it; promotion-gap nudge and hygiene before the card", () => {
    expect(card).toContain('mcp__ccd_session_mgmt__archive_session {session_id:"self"}');
    expect(card).toMatch(/Make it only when the hook says so/);
    expect(card).toMatch(/\*\*Before rendering the card\*\*/);
    expect(card).toMatch(/call once, before the card, with the same `cwd` the card gets/);
  });
});
