import { describe, test, expect, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  markQueryDone,
  refreshFlagPath,
  writeUpdateLock,
  updateGlobalCap,
} from "../lib/graphify-state.js";

// This file spawns real processes (hooks, scripts, or a server). The full suite
// runs 64 files in parallel, all starting `node` at once, so process-start tail
// latency reaches many times its isolated cost — enough for a spawn-heavy test
// to blow the 5s default on a load spike rather than on a defect. Measured
// 2026-08-16: the worst offender costs 832ms isolated and still timed out at 5s
// during a full run. 30s leaves that headroom and still catches a genuine hang.
vi.setConfig({ testTimeout: 30_000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.tokens.guard.js");

const OLD = new Date(Date.now() - 60_000);
const NOW = new Date();

// Isolate the GLOBAL (~/.claude/graphify.json) consent record from whatever
// happens to exist on the machine running this test — without this, isEnabled()
// reads the real $HOME/graphify.json and a globally-opted-out dev machine makes
// every "gate fires" assertion below flake. Same HOME/USERPROFILE-override
// idiom as graphify-state.test.js. No graphify.json is written here, so the
// global record resolves to "absent" (enabled) for all tests below by default.
const HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "graphgate-home-"));
fs.mkdirSync(path.join(HOME_DIR, ".claude"), { recursive: true });

// The hook under test spawns a REAL detached `graphify update .` whenever it
// decides to self-heal, AND a synchronous `graphify query ...` for the
// answer-in-gate. Left on the real binary, every case below would launch the
// Python indexer/query engine against a temp dir the test deletes moments
// later. Point the hook at stub binaries instead (DOTCLAUDE_GRAPHIFY_BIN): the
// spawn path stays real, the indexer/query engine never runs.
//
// ANSWER_STUB echoes its own argv back (prefixed "Node:") — a stand-in
// "found a node" answer that also lets a test assert on exactly what args the
// query was invoked with (the `--budget`/`--graph` plumbing) without needing a
// real graphify. NOANSWER_STUB reproduces the exact "nothing found" output a
// real graphify prints. TIMEOUT_STUB never exits, to exercise the hard
// timeout. Self-heal's `update .` calls ignore the stub's stdout entirely
// (stdio:'ignore' in the runner), so the same stubs serve both call sites.
const STUB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "graphgate-stub-"));
function writeStub(name, body) {
  const p = process.platform === "win32" ? path.join(STUB_DIR, `${name}.cmd`) : path.join(STUB_DIR, name);
  fs.writeFileSync(p, body, { mode: 0o755 });
  return p;
}
const GRAPHIFY_STUB = process.platform === "win32"
  ? writeStub("graphify", "@echo off\r\necho Node: %*\r\n")
  : writeStub("graphify", "#!/bin/sh\necho \"Node: $*\"\n");
const NOANSWER_STUB = process.platform === "win32"
  ? writeStub("graphify-noanswer", "@echo off\r\necho No matching nodes found.\r\n")
  : writeStub("graphify-noanswer", "#!/bin/sh\necho 'No matching nodes found.'\n");
const TIMEOUT_STUB = process.platform === "win32"
  ? writeStub("graphify-timeout", "@echo off\r\nping -n 8 127.0.0.1 > nul\r\necho Node: too slow\r\n")
  : writeStub("graphify-timeout", "#!/bin/sh\nsleep 8\necho 'Node: too slow'\n");

afterAll(() => {
  for (const d of [STUB_DIR, HOME_DIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});

// Build a temp project. graph:"fresh"|"stale"|"none", consent:true|false|null.
function project({ consent, graph }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "graphgate-"));
  // A git work tree — the auto-build refuses anything else (see
  // graphify-state isProjectDir), and these tests exercise the refresh path.
  fs.mkdirSync(path.join(dir, ".git"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  // Enable the plugin so plugin-guard does not short-circuit.
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  if (consent !== null) {
    fs.writeFileSync(
      path.join(dir, ".claude", "graphify.json"),
      JSON.stringify({ consent })
    );
  }
  const src = path.join(dir, "a.js");
  fs.writeFileSync(src, "const x = 1;");
  if (graph !== "none") {
    const gp = path.join(dir, "graphify-out", "graph.json");
    fs.mkdirSync(path.dirname(gp), { recursive: true });
    // Must clear hasGraph()'s size floor (MIN_GRAPH_BYTES) to count as present.
    fs.writeFileSync(gp, JSON.stringify({ nodes: Array(50).fill({ id: "x" }) }));
    if (graph === "fresh") {
      fs.utimesSync(src, OLD, OLD);
      fs.utimesSync(gp, NOW, NOW);
    } else { // stale: source newer than graph
      fs.utimesSync(gp, OLD, OLD);
      fs.utimesSync(src, NOW, NOW);
    }
  }
  return dir;
}

function runGrep(dir, sid, pattern, homeDir = HOME_DIR, bin = GRAPHIFY_STUB, toolInput = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    cwd: dir,
    input: JSON.stringify({ tool_name: "Grep", tool_input: { pattern, ...toolInput }, session_id: sid }),
    encoding: "utf8",
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, DOTCLAUDE_GRAPHIFY_BIN: bin },
  });
  return { status: res.status, stderr: res.stderr || "" };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

describe("pre.tokens.guard — graphify hard-gate (integration)", () => {
  // Isolate the graphify update-lock dir (#291). The self-heal now releases its
  // refresh slot when bgWithSentinel declines the spawn, so a machine-wide cap
  // filled by OTHER tests — or by real builds on this machine — turns
  // "refresh kicked" into "refresh correctly not kicked" and the assertions
  // below flip. An isolated lock dir makes the live-build count start at 0, so
  // these tests measure the gate's logic instead of the machine's load.
  let origLockDir, isoLockDir;
  beforeEach(() => {
    origLockDir = process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    isoLockDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphgate-lockiso-"));
    process.env.DOTCLAUDE_GRAPHLOCK_DIR = isoLockDir;
  });
  afterEach(() => {
    try { fs.rmSync(isoLockDir, { recursive: true, force: true }); } catch {}
    if (origLockDir === undefined) delete process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    else process.env.DOTCLAUDE_GRAPHLOCK_DIR = origLockDir;
  });

  test("consent + fresh graph → first broad search is BLOCKED by the graph gate", () => {
    const dir = project({ consent: true, graph: "fresh" });
    const r = runGrep(dir, "s-block", "alpha");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  test("retry of the same search relents (escape hatch) — no longer the graph gate", () => {
    const dir = project({ consent: true, graph: "fresh" });
    const first = runGrep(dir, "s-retry", "beta");
    expect(first.stderr).toContain("GRAPHIFY GATE");
    const second = runGrep(dir, "s-retry", "beta");
    expect(second.stderr).not.toContain("GRAPHIFY GATE"); // fell through to the token guard
    cleanup(dir);
  });

  test("no consent record (default-on, opt-out model) → graph gate STILL fires", () => {
    const dir = project({ consent: null, graph: "fresh" });
    const r = runGrep(dir, "s-noconsent", "gamma");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  test("declined (consent:false) → graph gate never fires", () => {
    const dir = project({ consent: false, graph: "fresh" });
    const r = runGrep(dir, "s-declined", "delta");
    expect(r.stderr).not.toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  test("stale graph within tolerance (1 newer file) → STILL blocked, with a lag disclosure", () => {
    const dir = project({ consent: true, graph: "stale" });
    const r = runGrep(dir, "s-stale", "epsilon");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GRAPHIFY GATE");
    expect(r.stderr).toContain("graph lags");
    expect(fs.existsSync(refreshFlagPath(dir))).toBe(true); // refresh kicked alongside the block
    cleanup(dir);
  });

  test("graph-less linked worktree → gate fires on the PRIMARY checkout's graph and names it via --graph", () => {
    // Primary checkout with a fresh graph; the worktree has none of its own
    // (measured: 11 of 20 sessions ran like this and never saw the gate).
    const main = project({ consent: null, graph: "fresh" });
    fs.mkdirSync(path.join(main, ".git", "worktrees", "wt"), { recursive: true });
    const wt = project({ consent: null, graph: "none" });
    fs.rmSync(path.join(wt, ".git"), { recursive: true, force: true });
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "wt")}\n`);
    fs.utimesSync(path.join(wt, "a.js"), OLD, OLD); // no branch edits newer than the primary graph
    const mainGraph = path.join(main, "graphify-out", "graph.json");
    const r = runGrep(wt, "s-worktree", "theta");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GRAPHIFY GATE");
    // The stub echoes its own argv (see ANSWER_STUB) — proof the query was
    // actually invoked with --graph pointing at the PRIMARY checkout's graph,
    // not the graph-less worktree.
    expect(r.stderr).toContain("--graph");
    expect(r.stderr).toContain(mainGraph);
    cleanup(wt); cleanup(main);
  });

  test("a `graphify query` run elsewhere no longer relents the whole session (old policy removed)", () => {
    const dir = project({ consent: true, graph: "fresh" });
    markQueryDone("s-queried", dir);
    const r = runGrep(dir, "s-queried", "zeta");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GRAPHIFY GATE"); // still fires — queryDone no longer matters here
    cleanup(dir);
  });

  test("globally declined (~/.claude/graphify.json consent:false) → gate never fires, even with no project record", () => {
    const dir = project({ consent: null, graph: "fresh" });
    const declinedHome = fs.mkdtempSync(path.join(os.tmpdir(), "graphgate-home-declined-"));
    fs.mkdirSync(path.join(declinedHome, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(declinedHome, ".claude", "graphify.json"),
      JSON.stringify({ consent: false })
    );
    const r = runGrep(dir, "s-global-declined", "eta", declinedHome);
    expect(r.stderr).not.toContain("GRAPHIFY GATE");
    cleanup(dir);
    cleanup(declinedHome);
  });

  test("stale graph BEYOND tolerance → self-heal refresh requested, not gated", () => {
    const dir = project({ consent: true, graph: "stale" });
    // Push well past GRAPHIFY_STALE_TOLERANCE (25) with more newer files.
    for (let i = 0; i < 30; i++) {
      const p = path.join(dir, `extra${i}.js`);
      fs.writeFileSync(p, "x");
      fs.utimesSync(p, NOW, NOW);
    }
    const r = runGrep(dir, "s-heal", "omega");
    expect(r.stderr).not.toContain("GRAPHIFY GATE"); // never block beyond tolerance
    expect(fs.existsSync(refreshFlagPath(dir))).toBe(true); // background refresh kicked
    cleanup(dir);
  });

  test("declined self-heal hands the refresh slot back instead of burning it (#291)", () => {
    const dir = project({ consent: true, graph: "stale" });
    for (let i = 0; i < 30; i++) {
      const p = path.join(dir, `extra${i}.js`);
      fs.writeFileSync(p, "x");
      fs.utimesSync(p, NOW, NOW);
    }
    // Saturate the machine-wide build cap so bgWithSentinel must decline.
    for (let i = 0; i < updateGlobalCap(); i++) {
      writeUpdateLock(fs.mkdtempSync(path.join(os.tmpdir(), "graphgate-busy-")), process.pid);
    }

    const r = runGrep(dir, "s-heal-declined", "omega");
    expect(r.stderr).not.toContain("GRAPHIFY GATE"); // still never blocks beyond tolerance
    // The spawn never happened, so the 2-minute cooldown must NOT be charged —
    // otherwise the next search cannot retry and the graph never converges.
    expect(fs.existsSync(refreshFlagPath(dir))).toBe(false);
    cleanup(dir);
  });

  describe("eligibility — the gate must not fire on searches the graph cannot usefully answer", () => {
    test("a Grep scoped to a single FILE never gates, even with a semantic pattern", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const filePath = path.join(dir, "a.js");
      const r = runGrep(dir, "s-file-scope", "authService", HOME_DIR, GRAPHIFY_STUB, { path: filePath });
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("a Grep scoped to a directory IS eligible", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-dir-scope", "authService", HOME_DIR, GRAPHIFY_STUB, { path: dir });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("a version-literal pattern is not eligible", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-version", "0\\.51\\.0");
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("a path-like pattern is not eligible", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-path-pattern", "plugins/devops/hooks");
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("a natural-language / sentence pattern (>4 words) is not eligible", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-sentence", "where is the retry logic implemented exactly");
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("a very short term is not eligible", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-short", "ab");
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("an alternation of two identifier terms IS eligible", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-alt", "authService|userRepo");
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("GRAPHIFY GATE");
      cleanup(dir);
    });
  });

  describe("answer-in-gate — hit vs. no-hit vs. timeout", () => {
    test("a graph HIT blocks and puts the answer directly in the message", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-hit", "authService", HOME_DIR, GRAPHIFY_STUB);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Node:");
      expect(r.stderr).toContain("retry the same search if you need exact matches.");
      cleanup(dir);
    });

    test("no matching nodes → ALLOWS silently, no gate text at all", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-noanswer", "authService", HOME_DIR, NOANSWER_STUB);
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("a query that exceeds the timeout ALLOWS silently, same as no answer", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-timeout", "authService", HOME_DIR, TIMEOUT_STUB);
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    }, 15_000);
  });

  test("adaptive relent fires after 3 consecutive bypasses with no accepted answer in between", () => {
    const dir = project({ consent: true, graph: "fresh" });
    const sid = "s-adaptive-relent-2";
    const first = runGrep(dir, sid, "answerTerm", HOME_DIR, GRAPHIFY_STUB);
    expect(first.status).toBe(2); // blocked with an accepted answer — bypass streak starts at 0
    // Three consecutive retries of the SAME already-gated search: each one is
    // a bypass via the escape hatch, and none of them is a fresh accepted
    // answer, so the streak accumulates instead of resetting.
    for (let i = 0; i < 3; i++) {
      const r = runGrep(dir, sid, "answerTerm", HOME_DIR, GRAPHIFY_STUB);
      expect(r.stderr).not.toContain("GRAPHIFY GATE"); // escape hatch bypass
    }
    // A brand-new eligible search must no longer be gated by GRAPHIFY —
    // the gate relented for the rest of this session. (It may still hit the
    // separate, pre-existing generic broad-search token guard — unrelated to
    // this feature — which is why this only asserts on the GATE text.)
    const freshSearch = runGrep(dir, sid, "freshUnseenTerm", HOME_DIR, GRAPHIFY_STUB);
    expect(freshSearch.stderr).not.toContain("GRAPHIFY GATE");
    cleanup(dir);
  });
});
