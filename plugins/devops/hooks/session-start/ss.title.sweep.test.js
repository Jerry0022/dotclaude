import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { findStaleTitles, interruptedFor } from "../lib/stale-titles.js";
import { buildContext, nextSeen } from "./ss.title.sweep.js";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const MIN = 60_000;

let tmp, root, gov;

/** A session `id` under `slug` with `title`, its transcript last written `ageMin` ago. */
function session(slug, id, title, ageMin, { sidecarAgeMin = ageMin } = {}) {
  const dir = path.join(root, slug, id);
  fs.mkdirSync(dir, { recursive: true });
  const sidecar = path.join(dir, "custom-title.json");
  fs.writeFileSync(sidecar, JSON.stringify({ customTitle: title }));
  const jsonl = path.join(root, slug, `${id}.jsonl`);
  fs.writeFileSync(jsonl, "{}\n");
  const at = (m) => new Date(NOW - m * MIN);
  fs.utimesSync(sidecar, at(sidecarAgeMin), at(sidecarAgeMin));
  fs.utimesSync(jsonl, at(ageMin), at(ageMin));
}

const find = (o = {}) => findStaleTitles({ root, governorDir: gov, now: NOW, ...o });

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "title-sweep-"));
  root = path.join(tmp, "projects");
  gov = path.join(tmp, "governor");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(gov, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("interruptedFor", () => {
  test("every ⏳ form becomes Interrupted on the bare title", () => {
    expect(interruptedFor("⏳ ➜ 🤖 Solo ┃ Fix login")).toBe("👉 ➜ ⚡ Interrupted ┃ Fix login");
    expect(interruptedFor("⏳ ➜ 🤖 Team ┃ Phase 1")).toBe("👉 ➜ ⚡ Interrupted ┃ Phase 1");
    expect(interruptedFor("⏳ ➜ 🚀 Shipping ┃ Ship it")).toBe("👉 ➜ ⚡ Interrupted ┃ Ship it");
    expect(interruptedFor("⏳ ┃ 🧭 Concept ➜ 🤖 Solo ┃ Phase 3")).toBe("👉 ➜ ⚡ Interrupted ┃ Phase 3");
    expect(interruptedFor("⏳ Übungen")).toBe("👉 ➜ ⚡ Interrupted ┃ Übungen");
  });

  test("non-⏳ and empty titles stay", () => {
    expect(interruptedFor("👉 ➜ 🧭 Concept ┃ Page")).toBeNull();
    expect(interruptedFor("🟩 ➜ 📊 Analysis ┃ X")).toBeNull();
    expect(interruptedFor("Plain title")).toBeNull();
    expect(interruptedFor("⏳ ")).toBeNull();
    expect(interruptedFor(null)).toBeNull();
  });
});

describe("findStaleTitles", () => {
  test("finds an idle ⏳ session, skips idle-too-briefly, non-⏳ and self", () => {
    session("C--r-app", "aaa", "⏳ ➜ 🤖 Solo ┃ Crashed work", 30);
    session("C--r-app", "bbb", "⏳ ➜ 🤖 Solo ┃ Just now", 1);
    session("C--r-app", "ccc", "🟩 ➜ 📦 Ready ┃ Done", 30);
    session("C--r-app", "self", "⏳ ➜ 🤖 Solo ┃ Me", 30);
    expect(find({ selfId: "self" }).map((s) => [s.sessionId, s.next]))
      .toEqual([["aaa", "👉 ➜ ⚡ Interrupted ┃ Crashed work"]]);
  });

  test("a live governor pid keeps the session (process still there)", () => {
    session("C--r-app", "live", "⏳ ➜ 🤖 Team ┃ Agents running", 30);
    fs.writeFileSync(path.join(gov, "live.json"), JSON.stringify({ claudePid: process.pid }));
    session("C--r-app", "dead", "⏳ ➜ 🤖 Solo ┃ Gone", 30);
    fs.writeFileSync(path.join(gov, "dead.json"), JSON.stringify({ claudePid: 2 ** 22 + 12345 }));
    expect(find().map((s) => s.sessionId)).toEqual(["dead"]);
  });

  test("a session under several slugs: newest sidecar wins, newest transcript decides idleness", () => {
    session("C--r-app", "moved", "⏳ ➜ 🤖 Solo ┃ Old name", 600);
    session("C--r-app--claude-worktrees-x", "moved", "⏳ ➜ 🤖 Solo ┃ New name", 20);
    expect(find().map((s) => s.title)).toEqual(["⏳ ➜ 🤖 Solo ┃ New name"]);
    session("C--r-app--claude-worktrees-y", "moved", "⏳ ➜ 🤖 Solo ┃ Old", 1, { sidecarAgeMin: 900 });
    expect(find()).toEqual([]);
  });

  test("sidecars older than 7 days and already-seen transcripts are skipped", () => {
    session("C--r-app", "old", "⏳ ➜ 🤖 Solo ┃ Ancient", 8 * 24 * 60);
    session("C--r-app", "seen", "⏳ ➜ 🤖 Solo ┃ Reported", 30);
    const seenMtime = NOW - 30 * MIN;
    expect(find({ seen: { seen: seenMtime } })).toEqual([]);
    expect(find({ seen: { seen: seenMtime - 1 } }).map((s) => s.sessionId)).toEqual(["seen"]);
  });

  test("missing root → empty", () => {
    expect(findStaleTitles({ root: path.join(tmp, "nope"), now: NOW })).toEqual([]);
  });
});

describe("ss.title.sweep context", () => {
  test("silent without candidates", () => {
    expect(buildContext([])).toBeNull();
  });

  test("lists exact old → new titles and the isRunning:false guard", () => {
    const ctx = buildContext([{ sessionId: "a", title: "⏳ ➜ 🤖 Solo ┃ X", next: "👉 ➜ ⚡ Interrupted ┃ X", mtimeMs: 1 }]);
    expect(ctx).toContain("isRunning:false");
    expect(ctx).toContain("list_sessions");
    expect(ctx).toContain('"⏳ ➜ 🤖 Solo ┃ X" → "👉 ➜ ⚡ Interrupted ┃ X"');
  });

  test("seen map records new entries and drops ones past the TTL", () => {
    const out = nextSeen({ keep: NOW - MIN, drop: NOW - 15 * 24 * 60 * MIN, bad: "x" }, [{ sessionId: "n", mtimeMs: 5 }], NOW);
    expect(out).toEqual({ keep: NOW - MIN, n: 5 });
  });
});
