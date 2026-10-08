import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WORK_PREFIX, LEGACY_PENDING_PREFIX, SHIPPING_PREFIX, CONCEPT_PREFIX,
  KNOWN_PREFIX_EMOJI, stripPrefixes, nextTitle, readCurrentTitle,
} from "./session-title.js";
import { SESSION_PREFIX, LEGACY_PREFIXES, releasedPrefix, pausedPrefix, stripTitlePrefix, hookRequire } from "../../mcp-server/lib/mode-state.js";

// The hook reads the title itself and hands Claude the exact value, so the
// set call rides along in the turn's first tool batch (no get_session round
// trip). These tests pin the rules the old prose instruction spelled out.

describe("session-title — prefixes mirror mode-state.js", () => {
  test("pinned strings equal SESSION_PREFIX / LEGACY_PREFIXES", () => {
    expect(WORK_PREFIX).toBe(SESSION_PREFIX.work);
    expect(SHIPPING_PREFIX).toBe(SESSION_PREFIX.shipping);
    expect(CONCEPT_PREFIX).toBe(SESSION_PREFIX.concept);
    expect(LEGACY_PREFIXES).toContain(LEGACY_PENDING_PREFIX);
  });

  test("stripPrefixes strips every prefix mode-state knows, like stripTitlePrefix", () => {
    const all = [
      ...Object.values(SESSION_PREFIX), ...LEGACY_PREFIXES,
      ...["alpha", "beta", "stable"].map(releasedPrefix),
      ...["restart", "reboot", "usage-reset", "user"].map(pausedPrefix),
    ];
    for (const p of all) {
      expect(stripPrefixes(p + "My task"), p).toBe("My task");
      expect(stripPrefixes(p + "My task")).toBe(stripTitlePrefix(p + "My task"));
    }
  });

  test("stacked prefixes go, a plain or foreign-emoji title stays", () => {
    expect(stripPrefixes("🧪 Test – ⏳ 🚀 Shipped – X")).toBe("X");
    expect(stripPrefixes("Plain title")).toBe("Plain title");
    expect(stripPrefixes("🐛 Bug hunt")).toBe("🐛 Bug hunt");
    // An outcome emoji without a worded prefix is title text, not a prefix.
    expect(stripPrefixes("📦 packaging rework")).toBe("📦 packaging rework");
  });

  test("mcp-server can load the lib through hookRequire", () => {
    const lib = hookRequire("lib", "session-title.js");
    expect(lib.nextTitle("X")).toBe("⏳ X");
    expect(lib.KNOWN_PREFIX_EMOJI).toEqual(KNOWN_PREFIX_EMOJI);
  });
});

describe("session-title — nextTitle (user prompt)", () => {
  test("plain title gets the bare hourglass", () => {
    expect(nextTitle("Fix login")).toBe("⏳ Fix login");
  });
  test("an outcome prefix is replaced", () => {
    expect(nextTitle("🧪 Test – Fix login")).toBe("⏳ Fix login");
    expect(nextTitle("🚀 Shipped – Fix login")).toBe("⏳ Fix login");
    expect(nextTitle("🎊 Released Stable – Fix login")).toBe("⏳ Fix login");
    expect(nextTitle("⏸️ Paused until limit reset – Fix login")).toBe("⏳ Fix login");
  });
  test("an already bare-marked title needs nothing; the legacy worded form is rewritten", () => {
    expect(nextTitle("⏳ Fix login")).toBeNull();
    expect(nextTitle(LEGACY_PENDING_PREFIX + "Fix login")).toBe("⏳ Fix login");
  });
  test("batch is owned by its skill, a running ship is never replaced", () => {
    expect(nextTitle("📥 Batch – Queue")).toBeNull();
    expect(nextTitle("🚀 Shipping – Fix login")).toBeNull();
    expect(nextTitle("🚀 Shipping – Fix login", { prefix: SHIPPING_PREFIX })).toBeNull();
  });
  test("the concept compass yields to a user prompt", () => {
    expect(nextTitle("🧭 Concept – Dashboard")).toBe("⏳ Dashboard");
  });
  test("a ship prompt sets Shipping, also over the hourglass", () => {
    expect(nextTitle("⏳ Fix login", { prefix: SHIPPING_PREFIX })).toBe("🚀 Shipping – Fix login");
    expect(nextTitle("🚀 Shipped – Fix login", { prefix: SHIPPING_PREFIX })).toBe("🚀 Shipping – Fix login");
  });
  test("empty / unknown / prefix-only titles do nothing", () => {
    expect(nextTitle("")).toBeNull();
    expect(nextTitle(null)).toBeNull();
    expect(nextTitle("🧪 Test – ")).toBeNull();
  });
});

describe("session-title — nextTitle (machine turn)", () => {
  const m = { machine: true };
  test("modes and outcomes stay (#618)", () => {
    for (const t of ["🧭 Concept – D", "📥 Batch – Q", "🚀 Shipped – X", "📦 Ready – X", "⏸️ Paused – X"]) {
      expect(nextTitle(t, m), t).toBeNull();
    }
  });
  test("a plain title and the legacy hourglass are still marked", () => {
    expect(nextTitle("Backlog run", m)).toBe("⏳ Backlog run");
    expect(nextTitle(LEGACY_PENDING_PREFIX + "Backlog run", m)).toBe("⏳ Backlog run");
    expect(nextTitle("⏳ Backlog run", m)).toBeNull();
  });
});

describe("session-title — readCurrentTitle", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "session-title-")); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name, lines) => {
    const p = join(dir, name);
    writeFileSync(p, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
    return p;
  };
  const ct = (t) => ({ type: "custom-title", customTitle: t, sessionId: "s" });
  const an = (t) => ({ type: "agent-name", agentName: t, sessionId: "s" });
  const msg = (n) => ({ type: "user", message: { content: "x".repeat(n) } });

  test("the last custom-title wins", () => {
    const p = write("a.jsonl", [ct("Old"), msg(10), ct("🧪 Test – New"), an("🧪 Test – New"), msg(10)]);
    expect(readCurrentTitle(p)).toBe("🧪 Test – New");
  });
  test("agent-name is the fallback when no custom-title is in reach", () => {
    expect(readCurrentTitle(write("b.jsonl", [msg(5), an("Named"), msg(5)]))).toBe("Named");
  });
  test("a message that merely quotes the entry text is no title entry", () => {
    const p = write("c.jsonl", [ct("Real"), { type: "user", message: { content: '{"type":"custom-title","customTitle":"Fake"}' } }]);
    expect(readCurrentTitle(p)).toBe("Real");
  });
  test("unknown → null: no path, missing file, no title entry, empty file", () => {
    expect(readCurrentTitle(undefined)).toBeNull();
    expect(readCurrentTitle(join(dir, "missing.jsonl"))).toBeNull();
    expect(readCurrentTitle(write("d.jsonl", [msg(5), msg(5)]))).toBeNull();
    writeFileSync(join(dir, "e.jsonl"), "");
    expect(readCurrentTitle(join(dir, "e.jsonl"))).toBeNull();
  });
  test("large file: finds an entry deep in the tail by growing the window, stops at maxBytes", () => {
    const big = [];
    for (let i = 0; i < 300; i++) big.push(msg(2000)); // ~600 KB of noise
    const p = write("f.jsonl", [ct("Deep"), ...big]);
    expect(readCurrentTitle(p, { chunk: 4096 })).toBe("Deep");
    // Out of reach of maxBytes → unknown, the caller falls back to get_session.
    expect(readCurrentTitle(p, { chunk: 4096, maxBytes: 64 * 1024 })).toBeNull();
  });
  test("multi-byte titles survive a chunk boundary", () => {
    const p = write("g.jsonl", [msg(3000), ct("🧭 Concept – Übersicht ä"), msg(100)]);
    expect(readCurrentTitle(p, { chunk: 200 })).toBe("🧭 Concept – Übersicht ä");
  });
});

describe("session-title — transcript path from session_id + cwd", () => {
  const { projectSlug, findTranscript } = hookRequire("lib", "session-title.js");

  test("the slug turns every non-alphanumeric char into '-' (Claude Code's project dir name)", () => {
    expect(projectSlug(String.raw`C:\Users\Jerem\IdeaProjects\dotclaude\.claude\worktrees\remove-startup-cmd-windows-d3f414`))
      .toBe("C--Users-Jerem-IdeaProjects-dotclaude--claude-worktrees-remove-startup-cmd-windows-d3f414");
    expect(projectSlug("/home/u/my_repo")).toBe("-home-u-my-repo");
  });

  test("the cwd's slug dir first, any project dir as fallback, null when absent or unsafe", () => {
    const home = mkdtempSync(join(tmpdir(), "st-home-"));
    try {
      const cwd = join(home, "repo.x");
      const slugDir = join(home, ".claude", "projects", projectSlug(cwd));
      const otherDir = join(home, ".claude", "projects", "elsewhere");
      mkdirSync(slugDir, { recursive: true });
      mkdirSync(otherDir, { recursive: true });
      writeFileSync(join(slugDir, "sid-a.jsonl"), "");
      writeFileSync(join(otherDir, "sid-b.jsonl"), "");
      expect(findTranscript("sid-a", home, cwd)).toBe(join(slugDir, "sid-a.jsonl"));
      expect(findTranscript("sid-b", home, cwd)).toBe(join(otherDir, "sid-b.jsonl"));
      expect(findTranscript("sid-b", home)).toBe(join(otherDir, "sid-b.jsonl"));
      expect(findTranscript("sid-c", home, cwd)).toBeNull();
      expect(findTranscript("../etc", home, cwd)).toBeNull();
      expect(findTranscript(undefined, home, cwd)).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("session-title — do-batch titles", () => {
  const { BATCH_PREFIX, batchTitle, unbatchTitle } = hookRequire("lib", "session-title.js");

  test("BATCH_PREFIX mirrors SESSION_PREFIX.batch", () => {
    expect(BATCH_PREFIX).toBe(SESSION_PREFIX.batch);
  });

  test("batchTitle prefixes, strips every devops prefix first, never stacks", () => {
    expect(batchTitle("Fix login")).toBe(SESSION_PREFIX.batch + "Fix login");
    expect(batchTitle("⏳ Fix login")).toBe(SESSION_PREFIX.batch + "Fix login");
    expect(batchTitle("🧪 Test – 🔧 Done – Fix login")).toBe(SESSION_PREFIX.batch + "Fix login");
    expect(batchTitle(SESSION_PREFIX.concept + "Fix login")).toBe(SESSION_PREFIX.batch + "Fix login");
  });

  test("batchTitle leaves an armed, empty or unknown title alone", () => {
    expect(batchTitle(SESSION_PREFIX.batch + "Fix login")).toBeNull();
    expect(batchTitle("")).toBeNull();
    expect(batchTitle(null)).toBeNull();
    expect(batchTitle("⏳ ")).toBeNull();
  });

  test("unbatchTitle strips exactly the batch prefix; a renamed title wins", () => {
    expect(unbatchTitle(SESSION_PREFIX.batch + "Fix login")).toBe("Fix login");
    expect(unbatchTitle(SESSION_PREFIX.batch + "⏳ Fix login")).toBe("⏳ Fix login");
    expect(unbatchTitle("Renamed by user")).toBeNull();
    expect(unbatchTitle("🧪 Test – Fix login")).toBeNull();
    expect(unbatchTitle(SESSION_PREFIX.batch)).toBeNull();
    expect(unbatchTitle(null)).toBeNull();
  });
});
