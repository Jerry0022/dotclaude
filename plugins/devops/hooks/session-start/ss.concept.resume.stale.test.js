import { describe, test, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { isStale, readStore } from "./ss.concept.resume.js";

// #426 — a concept opened 2026-09-20 11:32 with a draft saved at 22:03 and a
// journal restore at 14:50 the next day vanished on a session restart at
// ~15:00: the bridge had died with the session, `isStale()` measured from
// `started_at` (the OPEN, > 24 h ago), the hook deleted the state file and
// exited with NO output, and the next tick shut down the bridge the user had
// just relaunched by hand. Staleness now means "no activity for 24 h" against
// the durable store, a typed draft keeps the concept live at any age, and a
// prune is announced on stdout with the store dir.

const HOOK = path.resolve(import.meta.dirname, "ss.concept.resume.js");
const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..", "..");
const H = 3600_000;
const iso = (agoMs) => new Date(Date.now() - agoMs).toISOString();

/** A project dir with a state file and a durable store shaped like the server writes them. */
function project({ startedAgo, savedAgo, draft, draftAgo }) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "concept-stale-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "concept-stale-home-"));
  fs.mkdirSync(path.join(home, ".claude"));
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  fs.mkdirSync(path.join(cwd, "docs", "concepts"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "concepts", "2026-09-20-x.html"), "<html></html>");
  fs.mkdirSync(path.join(cwd, ".claude"));
  const stateFile = path.join(cwd, ".claude", "concept-active.json");
  // Port 1 is never a listening bridge: the heartbeat probe fails fast.
  fs.writeFileSync(stateFile, JSON.stringify({ port: 1, html_path: "docs/concepts/2026-09-20-x.html", slug: "x", started_at: iso(startedAgo) }));
  const store = path.join(cwd, ".claude", "concepts", "2026-09-20-x");
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, "state.json"), JSON.stringify({ decisions: "{}", version: 3, phase: "idle", saved_at: iso(savedAgo) }));
  if (draft) {
    fs.mkdirSync(path.join(store, "drafts"));
    fs.writeFileSync(path.join(store, "drafts", "x.json"), JSON.stringify({ rev: 199, ts: iso(draftAgo), state: draft }));
  }
  return { cwd, home, stateFile, store };
}

function runHook({ cwd, home }) {
  const r = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify({ session_id: `vitest-stale-${process.pid}-${Date.now()}`, source: "startup" }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, HOME: home, USERPROFILE: home },
    encoding: "utf8",
    timeout: 20_000,
  });
  return { status: r.status, stdout: r.stdout || "" };
}

describe("isStale — measured from the last activity, not the open (#426)", () => {
  const old = { started_at: iso(30 * H) };

  test("no store: the open alone decides, as before", () => {
    expect(isStale({})).toBe(false);
    expect(isStale({ started_at: iso(1 * H) })).toBe(false);
    expect(isStale(old)).toBe(true);
  });

  test("an old open with store activity inside 24 h is NOT stale", () => {
    expect(isStale(old, { lastActivityAt: iso(17 * H), hasDraft: false })).toBe(false);
  });

  test("an old open whose last store activity is also older than 24 h is stale", () => {
    expect(isStale(old, { lastActivityAt: iso(26 * H), hasDraft: false })).toBe(true);
  });

  test("a store holding a typed draft is never stale, whatever the age", () => {
    expect(isStale(old, { lastActivityAt: iso(90 * H), hasDraft: true })).toBe(false);
  });

  test("a store without any activity stamp falls back to the open", () => {
    expect(isStale(old, { lastActivityAt: null, hasDraft: false })).toBe(true);
    expect(isStale({ started_at: iso(1 * H) }, { lastActivityAt: null, hasDraft: false })).toBe(false);
  });
});

describe("readStore — lastActivityAt and hasDraft", () => {
  test("takes the newest of state.json saved_at and the draft snapshot ts; a typed note sets hasDraft", () => {
    const p = project({ startedAgo: 30 * H, savedAgo: 20 * H, draft: { "text:c1": "keep this", "check:a": true }, draftAgo: 17 * H });
    const s = readStore(p.store);
    expect(s.present).toBe(true);
    expect(s.hasDraft).toBe(true);
    expect(Math.abs(Date.parse(s.lastActivityAt) - (Date.now() - 17 * H))).toBeLessThan(5_000);
  });

  test("a draft whose text keys are all empty is not a typed note", () => {
    const p = project({ startedAgo: 30 * H, savedAgo: 20 * H, draft: { "text:c1": "   ", "check:a": true }, draftAgo: 17 * H });
    expect(readStore(p.store).hasDraft).toBe(false);
  });

  test("an absent store reports no activity and no draft", () => {
    const s = readStore(path.join(os.tmpdir(), "concept-stale-none-" + Date.now()));
    expect(s.present).toBe(false);
    expect(s.lastActivityAt).toBeNull();
    expect(s.hasDraft).toBe(false);
  });
});

describe("dead bridge, old open — the hook keeps a live concept and announces a prune", () => {
  test("REGRESSION: open 30 h ago, draft saved 17 h ago → NOT pruned, relaunch mandate instead", () => {
    const p = project({ startedAgo: 30 * H, savedAgo: 30 * H, draft: { "text:c1": "typed last night" }, draftAgo: 17 * H });
    const r = runHook(p);
    expect(r.status).toBe(0);
    expect(fs.existsSync(p.stateFile)).toBe(true);
    expect(r.stdout).not.toContain("PRUNED");
    expect(r.stdout).toMatch(/relaunch|port 1/i);
  });

  test("open 30 h ago, no draft, but the store was saved 20 h ago → still live", () => {
    const p = project({ startedAgo: 30 * H, savedAgo: 20 * H, draft: null });
    const r = runHook(p);
    expect(fs.existsSync(p.stateFile)).toBe(true);
    expect(r.stdout).not.toContain("PRUNED");
  });

  test("open 30 h ago, store last saved 28 h ago, no draft → pruned, and the prune is said out loud with the store dir", () => {
    const p = project({ startedAgo: 30 * H, savedAgo: 28 * H, draft: null });
    // The mtime fallback must not rescue it: age the files on disk too.
    const old = new Date(Date.now() - 28 * H);
    fs.utimesSync(path.join(p.store, "state.json"), old, old);
    const r = runHook(p);
    expect(r.status).toBe(0);
    expect(fs.existsSync(p.stateFile)).toBe(false);
    expect(r.stdout).toMatch(/^PRUNED stale concept state /m);
    expect(r.stdout).toContain("port 1");
    expect(r.stdout).toContain(p.store);
    expect(r.stdout).toContain("no activity for more than 24 h");
  });
});
