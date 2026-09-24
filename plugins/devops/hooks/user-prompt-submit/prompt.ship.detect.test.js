import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sessionFile, writeSessionFile } from "../lib/session-id.js";

const HOOK = fileURLToPath(new URL("./prompt.ship.detect.js", import.meta.url));

let cwd;

/** Run the hook as the harness does: JSON on stdin, a git project as cwd
 *  (the hook is silent outside a work tree), plugin enabled in its settings
 *  so plugin-guard passes whatever the machine's global state is. */
function runHook(payload, env) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, session_id: "ship-detect-test", ...payload }),
    cwd,
    encoding: "utf8",
    env: { ...process.env, DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "", ...(env || {}) },
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

/** A transcript whose newest assistant call carried `tokens` of context. */
function transcript(tokens) {
  const file = path.join(cwd, "transcript.jsonl");
  const lines = [
    JSON.stringify({ type: "user", message: { content: "hallo" } }),
    JSON.stringify({ type: "assistant", message: { id: "m1", usage: { input_tokens: 2, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0, output_tokens: 50 } } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }),
  ];
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ship-detect-test-"));
  fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  execFileSync("git", ["init", "-q"], { cwd });
});

afterEach(() => {
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

// The ship pipeline re-reads the whole context ~16 times. Above the threshold
// the hook hands the user the /compact command instead of starting the ship;
// below it, and whenever the size is unknown, the ship instruction is unchanged.
describe("prompt.ship.detect — careful compact", () => {
  test("small context: the ship instruction, no compact advice", () => {
    const r = runHook({ prompt: "/do-ship", transcript_path: transcript(90_000) });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Skill("devops:do-ship")');
    expect(r.stdout).not.toContain("[ship-compact]");
  });

  test("large context: the compact advice replaces the ship instruction", () => {
    const r = runHook({ prompt: "/do-ship", transcript_path: transcript(434_000) });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("[ship-compact]");
    expect(r.stdout).toContain("434 k");
    expect(r.stdout).toContain("/compact ");
    expect(r.stdout).not.toContain('Skill("devops:do-ship")');
  });

  test("an affirmation after edits is a ship too, and gets the same stop", () => {
    // the edit counter the affirmation path reads lives in the session file store
    writeSessionFile(sessionFile("dotclaude-devops-edits", "ship-detect-test"), "3");
    const r = runHook({ prompt: "ja", transcript_path: transcript(500_000) });
    expect(r.stdout).toContain("[ship-compact]");
  });

  test("--no-compact lets the large-context ship through", () => {
    const r = runHook({ prompt: "/do-ship --no-compact", transcript_path: transcript(434_000) });
    expect(r.stdout).toContain('Skill("devops:do-ship")');
    expect(r.stdout).not.toContain("[ship-compact]");
  });

  test("no transcript path (unknown size) never stops a ship", () => {
    const r = runHook({ prompt: "/do-ship" });
    expect(r.stdout).toContain('Skill("devops:do-ship")');
  });

  test("threshold 0 disables the stop", () => {
    const r = runHook({ prompt: "/do-ship", transcript_path: transcript(900_000) }, { DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "0" });
    expect(r.stdout).toContain('Skill("devops:do-ship")');
  });

  test("never twice in a row: the next ship prompt runs, the one after that is asked again", () => {
    const t = transcript(434_000);
    expect(runHook({ prompt: "ship", transcript_path: t }).stdout).toContain("[ship-compact]");
    const second = runHook({ prompt: "ship", transcript_path: t });
    expect(second.stdout).toContain('Skill("devops:do-ship")');
    expect(second.stdout).not.toContain("[ship-compact]");
    // the marker was consumed — a later ship on a big context is asked again
    expect(runHook({ prompt: "ship", transcript_path: t }).stdout).toContain("[ship-compact]");
  });

  test("right after /compact the stale pre-compact size does not stop the ship", () => {
    const t = transcript(469_000);
    fs.appendFileSync(t, JSON.stringify({ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "manual", preTokens: 469_000 } }) + "\n");
    const r = runHook({ prompt: "ship", transcript_path: t });
    expect(r.stdout).toContain('Skill("devops:do-ship")');
    expect(r.stdout).not.toContain("[ship-compact]");
  });

  afterEach(() => {
    for (const prefix of ["dotclaude-devops-edits", "dotclaude-devops-ship-compact-advised"]) {
      try { fs.unlinkSync(sessionFile(prefix, "ship-detect-test")); } catch {}
    }
  });

  test("a non-ship prompt is untouched", () => {
    const r = runHook({ prompt: "erklär mir cache reads", transcript_path: transcript(900_000) });
    expect(r.stdout).toBe("");
  });
});

// Skill restructure PR 2: promote folded into do-ship. The hook parses the
// target channel (lib/ship-intent.js) and passes it as the skill argument;
// do-ship ships anything unshipped to alpha, then promotes.
describe("prompt.ship.detect — target channel", () => {
  test("a plain ship carries no argument (alpha is the default)", () => {
    const r = runHook({ prompt: "ship it" });
    expect(r.stdout).toContain('MANDATORY: Use Skill("devops:do-ship") to execute the full shipping pipeline.');
    expect(r.stdout).not.toContain("with args");
  });

  test.each([
    ["promote stable", "stable"],
    ["release beta", "beta"],
    ["auf stable heben", "stable"],
    ["ship it to stable", "stable"],
    ["/do-ship beta", "beta"],
    ["/promote stable", "stable"],
  ])("%s → do-ship with args %s", (prompt, args) => {
    const r = runHook({ prompt });
    expect(r.stdout).toContain(`Skill("devops:do-ship") with args "${args}"`);
    expect(r.stdout).toContain("ships any unshipped work of this branch to alpha first");
  });

  // Red-team R2(a): a named version is promotion-only — a stale card button
  // ("promote stable 0.193.0") must never ship edits made after that card.
  test.each([
    ["Promote v0.171.0 to stable", "stable 0.171.0"],
    ["promote stable 0.193.0", "stable 0.193.0"],
    ["promote 0.193.0", "promote 0.193.0"],
  ])("%s → promotion-only, args %s", (prompt, args) => {
    const r = runHook({ prompt });
    expect(r.stdout).toContain(`Skill("devops:do-ship") with args "${args}"`);
    expect(r.stdout).toContain("do NOT ship any unshipped work");
    expect(r.stdout).not.toContain("ships any unshipped work of this branch to alpha first");
  });

  // Red-team R1: a negated channel is a plain ship — never args "stable".
  test.each(["ship, aber nicht auf stable", "ship it but don't promote to stable", "ship it, not to stable"])(
    "%s → plain ship, no promotion argument", (prompt) => {
      const r = runHook({ prompt });
      expect(r.stdout).toContain('MANDATORY: Use Skill("devops:do-ship") to execute the full shipping pipeline.');
      expect(r.stdout).not.toContain("with args");
    });

  test("a bare promote passes 'promote' — do-ship asks which promotion", () => {
    const r = runHook({ prompt: "promote" });
    expect(r.stdout).toContain('Skill("devops:do-ship") with args "promote"');
  });

  test("'promote the idea to the team' is no ship at all", () => {
    expect(runHook({ prompt: "promote the idea to the team" }).stdout).toBe("");
  });

  describe("careful compact vs. a promotion", () => {
    /** Turn the test cwd into a clone whose main is in sync with its origin. */
    function syncedWithOrigin() {
      const origin = fs.mkdtempSync(path.join(os.tmpdir(), "ship-detect-origin-"));
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
      execFileSync("git", ["checkout", "-q", "-b", "main"], { cwd });
      fs.writeFileSync(path.join(cwd, "a.txt"), "one\n");
      execFileSync("git", ["add", "a.txt"], { cwd });
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"], { cwd });
      execFileSync("git", ["remote", "add", "origin", origin], { cwd });
      execFileSync("git", ["push", "-q", "-u", "origin", "main"], { cwd });
      execFileSync("git", ["remote", "set-head", "origin", "main"], { cwd });
      return origin;
    }

    afterEach(() => {
      try { fs.unlinkSync(sessionFile("dotclaude-devops-ship-compact-advised", "ship-detect-test")); } catch {}
    });

    test("promotion-only (nothing unshipped): no compact stop on a large context", () => {
      const origin = syncedWithOrigin();
      try {
        const r = runHook({ prompt: "promote stable", transcript_path: transcript(600_000) });
        expect(r.stdout).toContain('Skill("devops:do-ship") with args "stable"');
        expect(r.stdout).not.toContain("[ship-compact]");
      } finally {
        fs.rmSync(origin, { recursive: true, force: true });
      }
    });

    test("a promotion that has to ship first is a ship — the stop applies", () => {
      const origin = syncedWithOrigin();
      try {
        fs.writeFileSync(path.join(cwd, "a.txt"), "two\n");
        const r = runHook({ prompt: "promote stable", transcript_path: transcript(600_000) });
        expect(r.stdout).toContain("[ship-compact]");
      } finally {
        fs.rmSync(origin, { recursive: true, force: true });
      }
    });

    test("a promotion naming its version never gets the stop — even with unshipped work (it ships nothing)", () => {
      const origin = syncedWithOrigin();
      try {
        fs.writeFileSync(path.join(cwd, "a.txt"), "two\n");
        const r = runHook({ prompt: "promote stable 0.193.0", transcript_path: transcript(600_000) });
        expect(r.stdout).not.toContain("[ship-compact]");
        expect(r.stdout).toContain('with args "stable 0.193.0"');
      } finally {
        fs.rmSync(origin, { recursive: true, force: true });
      }
    });
    test("a plain ship on a synced branch still gets the stop (only promotions are spared)", () => {
      const origin = syncedWithOrigin();
      try {
        expect(runHook({ prompt: "ship", transcript_path: transcript(600_000) }).stdout).toContain("[ship-compact]");
      } finally {
        fs.rmSync(origin, { recursive: true, force: true });
      }
    });
  });
});
