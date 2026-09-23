/**
 * Regression: every project-rooted `.claude/` writer lands at the repo root when
 * the session's cwd is a SUBDIRECTORY. Observed 2026-09-23: a session sitting in
 * `plugins/devops/scripts` created `plugins/devops/.claude/batch-activity` and
 * `plugins/devops/scripts/.claude/batch-activity` — untracked, not ignored,
 * failing /ship preflight's clean-tree check and blocking Desktop archiving.
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as B from "./batch-state.js";
import * as S from "./strict-state.js";
import * as Sentinel from "./ship-sentinel.js";
import { sentinelPath as mcpSentinelPath, writeSentinel } from "../../mcp-server/ship/lib/sentinel.js";

// Spawns cold `node` hooks alongside the rest of the suite — see the note in
// pre.tokens.guard.graphgate.test.js.
vi.setConfig({ testTimeout: 30_000 });

const HOOKS = fileURLToPath(new URL("..", import.meta.url));
const BATCH_HOOK = path.join(HOOKS, "user-prompt-submit", "prompt.batch.collect.js");
const TOKENS_SCAN = path.join(HOOKS, "session-start", "ss.tokens.scan.js");

let root;
let sub;

/** Every `.claude` directory under `dir`, relative — the repo root's own included. */
function claudeDirsUnder(dir) {
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.name === ".claude") out.push(path.relative(dir, p).replace(/\\/g, "/"));
      walk(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** Run a hook exactly as the harness does: JSON on stdin, the SUBDIRECTORY as cwd. */
function runHook(file, payload) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "writers-home-"));
  const res = spawnSync(process.execPath, [file], {
    input: JSON.stringify({ cwd: sub, ...payload }),
    cwd: sub,
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: "" },
  });
  fs.rmSync(home, { recursive: true, force: true });
  return res;
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "writers-repo-")));
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  sub = path.join(root, "plugins", "devops", "scripts");
  fs.mkdirSync(sub, { recursive: true });
  // Enabled at the ROOT only, like a real per-project install — plugin-guard
  // must find it from the subdirectory too, or every hook is silenced.
  fs.mkdirSync(path.join(root, ".claude"));
  fs.writeFileSync(
    path.join(root, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }),
  );
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("prompt.batch.collect — hook run from a subdirectory cwd", () => {
  test("the activity clock lands at <root>/.claude/batch-activity", () => {
    const res = runHook(BATCH_HOOK, { prompt: "fix the flaky test please" });
    expect(res.status).toBe(0);
    expect(fs.existsSync(path.join(root, ".claude", "batch-activity"))).toBe(true);
    expect(claudeDirsUnder(root)).toEqual([".claude"]);
  });

  test("an active collection started at the root keeps collecting from a subdirectory", () => {
    B.activate(root);
    const res = runHook(BATCH_HOOK, { prompt: "remember to rename the helper later" });
    expect(res.status).toBe(2); // collected = blocked, as at the root
    expect(res.stderr).toContain("Notiz #1 gespeichert");
    expect(B.readNotes(root).map(n => n.text).join("\n")).toContain("rename the helper");
    expect(claudeDirsUnder(root)).toEqual([".claude"]);
  });
});

describe("batch-state — every path resolves to the root", () => {
  test("notes, mode, activity and watchdog lock", () => {
    const want = path.join(root, ".claude");
    for (const p of [B.notesPath(sub), B.modePath(sub), B.activityPath(sub), B.lockPath(sub)]) {
      expect(path.dirname(p)).toBe(want);
    }
    B.touchActivity(sub);
    B.appendNote(sub, "a note from deep inside");
    expect(B.readActivity(root)).toBeGreaterThan(0);
    expect(B.countNotes(root)).toBe(1);
    expect(claudeDirsUnder(root)).toEqual([".claude"]);
  });
});

describe("strict-state — mode file from a subdirectory", () => {
  test("activate(sub) writes <root>/.claude/strict-mode.json and is seen from both", () => {
    S.activate(sub, { reason: "on" });
    expect(fs.existsSync(path.join(root, ".claude", S.MODE_FILE))).toBe(true);
    expect(S.isActive(sub)).toBe(true);
    expect(S.isActive(root)).toBe(true);
    expect(claudeDirsUnder(root)).toEqual([".claude"]);
  });

  test("a workflow binding at the root is found from a subdirectory", () => {
    fs.writeFileSync(path.join(root, ".claude", "concept-active.json"), "{}");
    expect(S.findBinding(sub)?.reason).toBe("concept");
  });
});

describe("ship sentinel — hook and MCP mirrors agree on one root file", () => {
  test("hooks: write(sub) is active from the root", () => {
    expect(Sentinel.write(sub)).toBe(true);
    expect(Sentinel.isActive(root)).toBe(true);
    expect(claudeDirsUnder(root)).toEqual([".claude"]);
  });

  test("MCP: writeSentinel(sub) is what the hook guards read", () => {
    expect(mcpSentinelPath(sub)).toBe(Sentinel.sentinelPath(root));
    expect(writeSentinel(sub)).toBe(true);
    expect(Sentinel.isActive(sub)).toBe(true);
    expect(claudeDirsUnder(root)).toEqual([".claude"]);
  });
});

describe("ss.tokens.scan — token-config from a subdirectory", () => {
  test("writes <root>/.claude/token-config.json, nothing below", () => {
    fs.writeFileSync(path.join(root, "big.js"), "x".repeat(4096));
    const res = runHook(TOKENS_SCAN, {});
    expect(res.status).toBe(0);
    expect(fs.existsSync(path.join(root, ".claude", "token-config.json"))).toBe(true);
    expect(claudeDirsUnder(root)).toEqual([".claude"]);
  });
});
