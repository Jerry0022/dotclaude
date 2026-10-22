import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WORK_PREFIX, LEGACY_PENDING_PREFIX, LEGACY_PREFIXES as HOOK_LEGACY, SHIPPING_PREFIX, CONCEPT_PREFIX,
  CONCEPT_WORKING_PREFIX, INTERRUPTED_PREFIX, classify, stripPrefixes, nextTitle, interruptedTitle, readCurrentTitle,
} from "./session-title.js";
import S from "./title-scheme.js";
import { SESSION_PREFIX, LEGACY_PREFIXES, releasedPrefix, pausedPrefix, stripTitlePrefix, hookRequire } from "../../mcp-server/lib/mode-state.js";

const W = WORK_PREFIX;

// The hook reads the title itself and hands Claude the exact value, so the
// set call rides along in the turn's first tool batch (no get_session round
// trip). These tests pin the rules of the two-slot scheme (lib/title-scheme.js).

const FE0F = "️";
const noFE0F = (s) => s.split(FE0F).join("");
/** Every prefix a state can leave, status raised included (👉 for a done state). */
const ALL_NEW = S.allStatePrefixes();

describe("session-title — prefixes mirror mode-state.js", () => {
  test("pinned strings equal SESSION_PREFIX / LEGACY_PREFIXES", () => {
    expect(WORK_PREFIX).toBe(SESSION_PREFIX.work);
    expect(SHIPPING_PREFIX).toBe(SESSION_PREFIX.shipping);
    expect(CONCEPT_PREFIX).toBe(SESSION_PREFIX["concept-waiting"]);
    expect(CONCEPT_WORKING_PREFIX).toBe(SESSION_PREFIX["concept-working"]);
    expect(INTERRUPTED_PREFIX).toBe("👉 ┃ ⚡ Interrupted ");
    expect(HOOK_LEGACY).toEqual(LEGACY_PREFIXES);
    expect(LEGACY_PREFIXES).toContain(LEGACY_PENDING_PREFIX);
  });

  test("LEGACY_PREFIXES holds every old single-icon prefix (R4)", () => {
    for (const p of ["⏳ Working – ", "🧭 Concept – ", "📥 Batch – ", "🚀 Shipping – ", "🚀 Shipped – ",
      "🎊 Released – ", "🎊 Released Alpha – ", "🎊 Released Beta – ", "🎊 Released Stable – ",
      "🧪 Test – ", "▶️ Started – ", "📦 Ready – ", "⛔ Blocked – ", "🚫 Aborted – ", "📋 Analysis – ",
      "🔧 Done – ", "⏸️ Paused – ", "⏸️ Paused until restart – ", "⏸️ Paused until reboot – ",
      "⏸️ Paused until limit reset – "]) {
      expect(LEGACY_PREFIXES, p).toContain(p);
    }
  });

  test("stripPrefixes strips every new prefix (each status the state can take), like stripTitlePrefix", () => {
    const all = [
      ...Object.values(SESSION_PREFIX), ...ALL_NEW,
      ...["alpha", "beta", "stable"].map((c) => releasedPrefix(c)),
      ...["beta", "stable"].map((c) => releasedPrefix(c, { promoted: true })),
      ...["restart", "reboot", "usage-reset", "user"].map(pausedPrefix),
    ];
    expect(ALL_NEW.length).toBeGreaterThan(Object.keys(S.STATES).length);
    for (const p of all) {
      expect(stripPrefixes(p + "My task"), p).toBe("My task");
      expect(stripPrefixes(p + "My task"), p).toBe(stripTitlePrefix(p + "My task"));
    }
  });

  test("stripPrefixes strips every legacy prefix, alone and stacked under a new one", () => {
    for (const p of LEGACY_PREFIXES) {
      expect(stripPrefixes(p + "My task"), p).toBe("My task");
      expect(stripPrefixes(SESSION_PREFIX.ready + p + "My task"), p).toBe("My task");
      expect(stripPrefixes(WORK_PREFIX + p + "My task"), p).toBe("My task");
    }
  });

  test("FE0F: every prefix strips with and without the variation selector", () => {
    const withSel = [...ALL_NEW, ...LEGACY_PREFIXES].filter((p) => p.includes(FE0F));
    expect(withSel.length).toBeGreaterThan(5); // ▶️ ⏸️ 🖥️ ⚠️ are covered
    for (const p of withSel) {
      expect(stripPrefixes(noFE0F(p) + "Job"), p).toBe("Job");
      expect(stripPrefixes(p + "Job"), p).toBe("Job");
    }
    // A selector where the canonical form has none is tolerated too.
    expect(stripPrefixes("👉 📦" + FE0F + " Ready – Job")).toBe("Job");
    expect(classify("🟦 ┃ ✋ Paused Job")).toBe("outcome");
    expect(stripPrefixes("🟦 ┃ 🔋 Limit reset Job")).toBe("Job");
    expect(stripPrefixes("🟩 ┃ 🖥️ System Job")).toBe("Job");
    expect(stripPrefixes("👉 ┃ ⚠️ Red tests Job")).toBe("Job");
    expect(stripPrefixes("🟩 ▶ Started – Job")).toBe("Job");
  });

  // F6: the old WORDED rule took any "Xxx – " after a bare ⏳ as a prefix.
  test("F6: only known prefixes go — free text after a bare ⏳ stays", () => {
    expect(stripPrefixes("⏳ Fix Login – Bug")).toBe("Fix Login – Bug");
    expect(nextTitle("⏳ Fix Login – Bug")).toBeNull();
    expect(nextTitle("👉 ┃ 📦 Ready Fix Login – Bug")).toBe(W + "Fix Login – Bug");
    expect(stripPrefixes("🟩 ┃ 🚀 Alpha Fix Login – Bug")).toBe("Fix Login – Bug");
    expect(stripPrefixes("📦 Packaging – rework")).toBe("📦 Packaging – rework");
    expect(stripPrefixes("👉 📦 Shipit – rework")).toBe("👉 📦 Shipit – rework");
    expect(stripPrefixes("Release Notes – v2")).toBe("Release Notes – v2");
  });

  test("stacked prefixes go, a plain or foreign-emoji title stays", () => {
    expect(stripPrefixes("🧪 Test – ⏳ 🚀 Shipped – X")).toBe("X");
    expect(stripPrefixes("👉 ┃ 🧪 Test ⏳ ┃ 🚀 Shipping 🟩 ┃ 🖥️ System X")).toBe("X");
    expect(stripPrefixes("Plain title")).toBe("Plain title");
    expect(stripPrefixes("🐛 Bug hunt")).toBe("🐛 Bug hunt");
    // An activity icon without a known prefix is title text, not a prefix.
    expect(stripPrefixes("📦 packaging rework")).toBe("📦 packaging rework");
    expect(stripPrefixes("👉 look at this")).toBe("👉 look at this");
  });

  test("classify reads the two-slot grammar", () => {
    expect(classify("Plain")).toBe("plain");
    expect(classify("⏳ X")).toBe("work");
    expect(classify("⏳ Working – X")).toBe("work");
    expect(classify("⏳ ┃ 🚀 Shipping X")).toBe("shipping");
    expect(classify("🚀 Shipping – X")).toBe("shipping");
    expect(classify("👉 ┃ 📚 Batch X")).toBe("batch");
    expect(classify("📥 Batch – X")).toBe("batch");
    expect(classify("🟥 ┃ 📚 Batch X")).toBe("batch");
    expect(classify("👉 ┃ 🧭 Concept X")).toBe("concept-waiting");
    expect(classify("🧭 Concept – X")).toBe("concept-waiting");
    expect(classify("⏳ ┃ 🧭 Concept X")).toBe("process");
    expect(classify("⏳ ┃ 🤖 Team X")).toBe("process");
    expect(classify("⏳ ┃ 🧪 Testing X")).toBe("process");
    expect(classify("🟩 ┃ 🚀 Alpha X")).toBe("outcome");
    expect(classify("🚀 Shipped – X")).toBe("outcome");
  });

  test("mcp-server can load the lib through hookRequire", () => {
    const lib = hookRequire("lib", "session-title.js");
    expect(lib.nextTitle("X")).toBe(W + "X");
    expect(lib.stripPrefixes).toBe(stripPrefixes);
  });
});

describe("session-title — nextTitle (user prompt)", () => {
  test("plain title gets the bare hourglass", () => {
    expect(nextTitle("Fix login")).toBe(W + "Fix login");
  });
  test("every outcome prefix — new, raised and legacy — is replaced by the bare hourglass", () => {
    const outcomes = ALL_NEW.filter((p) => ["outcome", "concept-waiting"].includes(classify(p + "X")));
    expect(outcomes.length).toBeGreaterThan(20);
    for (const p of [...outcomes, ...LEGACY_PREFIXES.filter((p) => !["🚀 Shipping – ", "📥 Batch – "].includes(p))]) {
      expect(nextTitle(p + "Fix login"), p).toBe(W + "Fix login");
    }
  });
  test("an already bare-marked title needs nothing; the legacy worded form is rewritten", () => {
    expect(nextTitle("⏳ Fix login")).toBeNull();
    expect(nextTitle(LEGACY_PENDING_PREFIX + "Fix login")).toBe(W + "Fix login");
  });
  // R1: the guards read the two-slot grammar, the running ship first.
  test("batch is owned by its skill, a running ship and any ⏳ process are never replaced", () => {
    for (const t of ["👉 ┃ 📚 Batch Queue", "📥 Batch – Queue", "⏳ ┃ 🚀 Shipping Fix login", "🚀 Shipping – Fix login",
      "⏳ ┃ 🧭 Concept D", "⏳ ┃ 🤖 Team D", "⏳ ┃ 🧪 Testing D"]) {
      expect(nextTitle(t), t).toBeNull();
    }
    expect(nextTitle("⏳ ┃ 🚀 Shipping Fix login", { prefix: SHIPPING_PREFIX })).toBeNull();
    expect(nextTitle("👉 ┃ 📚 Batch Queue", { prefix: SHIPPING_PREFIX })).toBeNull();
  });
  test("a waiting concept yields to a user prompt", () => {
    expect(nextTitle("👉 ┃ 🧭 Concept Dashboard")).toBe(W + "Dashboard");
    expect(nextTitle("🧭 Concept – Dashboard")).toBe(W + "Dashboard");
  });
  test("a ship prompt sets Shipping — over the hourglass, an outcome, a process; a legacy Shipping is upgraded", () => {
    expect(nextTitle("⏳ Fix login", { prefix: SHIPPING_PREFIX })).toBe("⏳ ┃ 🚀 Shipping Fix login");
    expect(nextTitle("🟩 ┃ 🚀 Alpha Fix login", { prefix: SHIPPING_PREFIX })).toBe("⏳ ┃ 🚀 Shipping Fix login");
    expect(nextTitle("🚀 Shipped – Fix login", { prefix: SHIPPING_PREFIX })).toBe("⏳ ┃ 🚀 Shipping Fix login");
    expect(nextTitle("⏳ ┃ 🤖 Team Fix login", { prefix: SHIPPING_PREFIX })).toBe("⏳ ┃ 🚀 Shipping Fix login");
    expect(nextTitle("🚀 Shipping – Fix login", { prefix: SHIPPING_PREFIX })).toBe("⏳ ┃ 🚀 Shipping Fix login");
    expect(nextTitle("⏳ Fix Login – Bug", { prefix: SHIPPING_PREFIX })).toBe("⏳ ┃ 🚀 Shipping Fix Login – Bug");
  });
  test("empty / unknown / prefix-only titles do nothing", () => {
    expect(nextTitle("")).toBeNull();
    expect(nextTitle(null)).toBeNull();
    expect(nextTitle("🧪 Test – ")).toBeNull();
    expect(nextTitle("👉 ┃ 🧪 Test ")).toBeNull();
  });
});

describe("session-title — nextTitle (machine turn)", () => {
  const m = { machine: true };
  test("modes, processes and outcomes stay (#618)", () => {
    for (const t of ["👉 ┃ 🧭 Concept D", "⏳ ┃ 🧭 Concept D", "👉 ┃ 📚 Batch Q", "🟩 ┃ 🚀 Alpha X",
      "👉 ┃ 📦 Ready X", "🟦 ┃ ✋ Paused X", "🧭 Concept – D", "📥 Batch – Q", "🚀 Shipped – X", "📦 Ready – X", "⏸️ Paused – X"]) {
      expect(nextTitle(t, m), t).toBeNull();
    }
  });
  test("a plain title and the legacy hourglass are still marked", () => {
    expect(nextTitle("Backlog run", m)).toBe(W + "Backlog run");
    expect(nextTitle(LEGACY_PENDING_PREFIX + "Backlog run", m)).toBe(W + "Backlog run");
    expect(nextTitle("⏳ Backlog run", m)).toBeNull();
  });
});

// F5: a turn that ends without a card must not leave "⏳" claiming work.
describe("session-title — interruptedTitle (F5)", () => {
  test("a bare ⏳ (or the legacy worded one) becomes 👉 ┃ ⚡ Interrupted", () => {
    expect(interruptedTitle("⏳ Refactor")).toBe("👉 ┃ ⚡ Interrupted Refactor");
    expect(interruptedTitle("⏳ Working – Refactor")).toBe("👉 ┃ ⚡ Interrupted Refactor");
    expect(interruptedTitle("⏳ Fix Login – Bug")).toBe("👉 ┃ ⚡ Interrupted Fix Login – Bug");
  });
  test("batch, a waiting concept, a running ship and every named state stay", () => {
    for (const t of ["👉 ┃ 📚 Batch Q", "📥 Batch – Q", "👉 ┃ 🧭 Concept D", "🧭 Concept – D", "⏳ ┃ 🧭 Concept D",
      "⏳ ┃ 🚀 Shipping X", "🚀 Shipping – X", "⏳ ┃ 🤖 Team X", "⏳ ┃ 🧪 Testing X", "👉 ┃ ⚡ Interrupted X",
      "🟩 ┃ 🚀 Alpha X", "Plain", "", null]) {
      expect(interruptedTitle(t), String(t)).toBeNull();
    }
    expect(interruptedTitle("⏳ ")).toBeNull();
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
    const p = write("a.jsonl", [ct("Old"), msg(10), ct("👉 ┃ 🧪 Test New"), an("👉 ┃ 🧪 Test New"), msg(10)]);
    expect(readCurrentTitle(p)).toBe("👉 ┃ 🧪 Test New");
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
    const p = write("g.jsonl", [msg(3000), ct("👉 ┃ 🧭 Concept Übersicht ä"), msg(100)]);
    expect(readCurrentTitle(p, { chunk: 200 })).toBe("👉 ┃ 🧭 Concept Übersicht ä");
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
    expect(batchTitle(SESSION_PREFIX["concept-waiting"] + "Fix login")).toBe(SESSION_PREFIX.batch + "Fix login");
    // A legacy batch title is upgraded to the two-slot form.
    expect(batchTitle("📥 Batch – Fix login")).toBe(SESSION_PREFIX.batch + "Fix login");
    expect(batchTitle("⏳ Fix Login – Bug")).toBe(SESSION_PREFIX.batch + "Fix Login – Bug");
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
    // The legacy batch prefix of an older session is retired too.
    expect(unbatchTitle("📥 Batch – Fix login")).toBe("Fix login");
    expect(unbatchTitle(null)).toBeNull();
  });
});
