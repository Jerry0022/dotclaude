import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { bridgeLive, conceptUrl, conceptCloseoutOnly, readConceptState, WIN32_NO_ENTRY_GRACE_MS } from "./mode-state.js";

// #712: the card resolved the concept link from the state file alone, so a
// close-out that had stopped the bridge (and deleted the page on discard)
// still got a localhost link and a "close out" CTA.
const DEAD = 2_000_000_001;
const alive = (pid) => pid !== DEAD;

describe("bridgeLive (#712)", () => {
  let cwd;
  const state = { html_path: "docs/concepts/x.html" };
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "bridge-live-"));
    mkdirSync(join(cwd, "docs", "concepts"), { recursive: true });
    writeFileSync(join(cwd, "docs", "concepts", "x.html"), "<!doctype html>");
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  test("missing page is dead whatever the pid says", () => {
    rmSync(join(cwd, "docs", "concepts", "x.html"));
    expect(bridgeLive(cwd, state, 8800, { isAlive: () => true, readEntry: () => ({ pid: 1 }) })).toBe(false);
  });

  test("registry pid decides: alive -> live, exited -> dead", () => {
    expect(bridgeLive(cwd, state, 8800, { isAlive: alive, readEntry: () => ({ pid: 4242 }) })).toBe(true);
    expect(bridgeLive(cwd, state, 8800, { isAlive: alive, readEntry: () => ({ pid: DEAD }) })).toBe(false);
  });

  test("no registry entry: the state file's server_pid off Windows, ignored on Windows (MSYS $!)", () => {
    const s = { ...state, server_pid: DEAD };
    expect(bridgeLive(cwd, s, 8800, { isAlive: alive, readEntry: () => null, platform: "linux" })).toBe(false);
    expect(bridgeLive(cwd, s, 8800, { isAlive: alive, readEntry: () => null, platform: "win32" })).toBe(true);
  });

  // R8: Step 6a stopped between /shutdown (registry entry removed) and the
  // state-file removal on a `keep` disposition — the page stays, the pid is
  // unknown on Windows, so only the age can tell the dead link apart.
  test("win32 without a registry entry: dead once the last activity is past the grace", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    const win = (extra) => ({ isAlive: alive, readEntry: () => null, platform: "win32", now, ...extra });
    const fresh = new Date(now - 60_000).toISOString();
    const old = new Date(now - WIN32_NO_ENTRY_GRACE_MS - 60_000).toISOString();
    expect(bridgeLive(cwd, { ...state, started_at: fresh }, 8800, win())).toBe(true);
    expect(bridgeLive(cwd, { ...state, started_at: old }, 8800, win())).toBe(false);
    // recent store activity keeps an old open alive
    expect(bridgeLive(cwd, { ...state, started_at: old }, 8800, win({ lastActivityAt: fresh }))).toBe(true);
    // a fresh state-file mtime counts too
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(join(cwd, ".claude", "concept-active.json"), "{}");
    expect(bridgeLive(cwd, { ...state, started_at: old }, 8800, win({ now: Date.now() }))).toBe(true);
    // off Windows the age never decides; on Windows a registry entry still wins
    expect(bridgeLive(cwd, { ...state, started_at: old }, 8800, { ...win(), platform: "linux" })).toBe(true);
    expect(bridgeLive(cwd, { ...state, started_at: old }, 8800, win({ readEntry: () => ({ pid: 4242, worktree: cwd }) }))).toBe(true);
  });

  // Redteam: ports collide across worktrees — a foreign session's live bridge
  // must not vouch for ours.
  test("a registry entry of another worktree is not ours", () => {
    const foreign = () => ({ pid: 4242, worktree: join(cwd, "..", "other-worktree") });
    const s = { ...state, server_pid: DEAD };
    expect(bridgeLive(cwd, s, 8800, { isAlive: alive, readEntry: foreign, platform: "linux" })).toBe(false);
    expect(bridgeLive(cwd, state, 8800, { isAlive: alive, readEntry: () => ({ pid: DEAD, worktree: cwd }) })).toBe(false);
  });

  test("missing or zero pid is unknown: the page alone decides", () => {
    for (const server_pid of [undefined, 0, null, "x"]) {
      expect(bridgeLive(cwd, { ...state, server_pid }, 8800, { isAlive: () => false, readEntry: () => null, platform: "linux" })).toBe(true);
    }
  });
});

describe("conceptUrl / readConceptState / conceptCloseoutOnly against a dead bridge (#712)", () => {
  let cwd, reg, prev;
  const FINAL = '<section data-iteration="2"></section><section data-final-report data-active></section>';
  beforeEach(() => {
    prev = process.env.CONCEPT_BRIDGE_REGISTRY_DIR;
    reg = mkdtempSync(join(tmpdir(), "bridge-live-reg-"));
    process.env.CONCEPT_BRIDGE_REGISTRY_DIR = reg;
    cwd = mkdtempSync(join(tmpdir(), "bridge-live-cwd-"));
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    mkdirSync(join(cwd, "docs", "concepts"), { recursive: true });
    writeFileSync(join(cwd, ".claude", "concept-active.json"), JSON.stringify({ port: 8811, html_path: "docs/concepts/x.html", started_at: new Date().toISOString() }));
    writeFileSync(join(cwd, "docs", "concepts", "x.html"), FINAL);
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.CONCEPT_BRIDGE_REGISTRY_DIR;
    else process.env.CONCEPT_BRIDGE_REGISTRY_DIR = prev;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(reg, { recursive: true, force: true });
  });

  test("live bridge with its page: link and close-out stay", () => {
    writeFileSync(join(reg, "8811.json"), JSON.stringify({ port: 8811, pid: process.pid }));
    expect(conceptUrl(cwd, undefined)).toBe("http://localhost:8811/docs/concepts/x.html");
    expect(conceptCloseoutOnly(cwd)).toBe(true);
  });

  test("dead bridge pid: no link, no close-out, even when the card asserts a concept", () => {
    const deadPid = spawnSync(process.execPath, ["-e", "0"]).pid;
    writeFileSync(join(reg, "8811.json"), JSON.stringify({ port: 8811, pid: deadPid }));
    expect(readConceptState(cwd)).toBeNull();
    expect(conceptUrl(cwd, undefined)).toBe("");
    expect(conceptUrl(cwd, { phase: "waiting" })).toBe("");
    expect(conceptCloseoutOnly(cwd)).toBe(false);
  });

  test("deleted page (discard): no link, no close-out", () => {
    rmSync(join(cwd, "docs", "concepts", "x.html"));
    expect(conceptUrl(cwd, undefined)).toBe("");
    expect(conceptCloseoutOnly(cwd)).toBe(false);
  });
});
