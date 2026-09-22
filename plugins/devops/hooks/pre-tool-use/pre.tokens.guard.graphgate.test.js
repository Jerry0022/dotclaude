import { describe, test, expect, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  markQueryDone,
  refreshFlagPath,
  writeUpdateLock,
  updateGlobalCap,
  gateQuerySlotPath,
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

// Requirement 8: every hook spawn below points DOTCLAUDE_GRAPHIFY_METRICS at
// an isolated temp file — never the real `~/.claude/graphify-metrics.jsonl`
// (a live QA session lost 15 lines written by other sessions backing that
// file up/restoring it by hand; this makes that unnecessary).
const METRICS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "graphgate-metrics-")), "graphify-metrics.jsonl");

/** Parsed events from the isolated metrics file. */
function events() {
  if (!fs.existsSync(METRICS_FILE)) return [];
  return fs.readFileSync(METRICS_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// The hook under test spawns a REAL detached `graphify update .` whenever it
// decides to self-heal, AND a synchronous `graphify query ...` for the
// answer-in-gate. Left on the real binary, every case below would launch the
// Python indexer/query engine against a temp dir the test deletes moments
// later. Point the hook at stub binaries instead (DOTCLAUDE_GRAPHIFY_BIN): the
// spawn path stays real, the indexer/query engine never runs.
//
// Every stub is a `.cmd` file, which — on Windows — a shell:false spawn
// cannot exec directly (CreateProcess needs a shell for batch files), so
// every test below actually exercises `spawnGraphifySync`'s ENOENT/EINVAL
// shell FALLBACK (strict per-argv quoting), not the primary shell:false path.
// That fallback is exactly what needs proving safe against shell
// metacharacters — see graphify-query-spawn.test.js for the primary
// shell:false path proof against a real (non-batch) executable.
//
// ANSWER_STUB emits a real `Traversal: … | N nodes found` header (required by
// `hasGraphAnswer` since the live-QA fix) followed by its own argv (prefixed
// "Node:") — a stand-in "found a node" answer that also lets a test assert on
// exactly what args the query was invoked with (the `--budget`/`--graph`
// plumbing) without needing a real graphify. NOANSWER_STUB reproduces the
// exact "nothing found" output a real graphify prints (no header at all).
// TIMEOUT_STUB never exits, to exercise the hard timeout. Self-heal's
// `update .` calls ignore the stub's stdout entirely (stdio:'ignore' in the
// runner), so the same stubs serve both call sites.
const STUB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "graphgate-stub-"));
function writeStub(name, body) {
  const p = process.platform === "win32" ? path.join(STUB_DIR, `${name}.cmd`) : path.join(STUB_DIR, name);
  fs.writeFileSync(p, body, { mode: 0o755 });
  return p;
}
const GRAPHIFY_STUB = process.platform === "win32"
  ? writeStub("graphify", "@echo off\r\necho Traversal: BFS depth=2 ^| 5 nodes found\r\necho Node: %*\r\n")
  : writeStub("graphify", "#!/bin/sh\necho 'Traversal: BFS depth=2 | 5 nodes found'\necho \"Node: $*\"\n");
const NOANSWER_STUB = process.platform === "win32"
  ? writeStub("graphify-noanswer", "@echo off\r\necho No matching nodes found.\r\n")
  : writeStub("graphify-noanswer", "#!/bin/sh\necho 'No matching nodes found.'\n");
const TIMEOUT_STUB = process.platform === "win32"
  ? writeStub("graphify-timeout", "@echo off\r\nping -n 8 127.0.0.1 > nul\r\necho Node: too slow\r\n")
  : writeStub("graphify-timeout", "#!/bin/sh\nsleep 8\necho 'Node: too slow'\n");

afterAll(() => {
  for (const d of [STUB_DIR, HOME_DIR, path.dirname(METRICS_FILE)]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
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

function runTool(toolName, dir, sid, toolInput, homeDir = HOME_DIR, bin = GRAPHIFY_STUB, extraEnv = {}) {
  const env = {
    ...process.env,
    HOME: homeDir, USERPROFILE: homeDir,
    DOTCLAUDE_GRAPHIFY_BIN: bin,
    DOTCLAUDE_GRAPHIFY_METRICS: METRICS_FILE,
    ...extraEnv,
  };
  const payload = { tool_name: toolName, tool_input: toolInput };
  if (sid !== undefined) payload.session_id = sid;
  const res = spawnSync(process.execPath, [HOOK], {
    cwd: dir,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env,
  });
  return { status: res.status, stderr: res.stderr || "" };
}

function runGrep(dir, sid, pattern, homeDir = HOME_DIR, bin = GRAPHIFY_STUB, extraToolInput = {}) {
  return runTool("Grep", dir, sid, { pattern, ...extraToolInput }, homeDir, bin);
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

/** Same key construction the hook uses for the graphgate escape-hatch flag. */
function gflagPathFor(sid, dir, toolInput) {
  const costFieldsObj = {
    pattern: toolInput.pattern || "", path: toolInput.path || "",
    glob: toolInput.glob || "", type: toolInput.type || "", output_mode: toolInput.output_mode || "",
  };
  const searchKey = `Grep:${dir}:${JSON.stringify(costFieldsObj)}`;
  const key = `graphgate:${sid}:${searchKey}`;
  const hash = crypto.createHash("md5").update(key).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `claude_confirm_${hash}.flag`);
}

describe("pre.tokens.guard — graphify hard-gate (integration)", () => {
  // Isolate the graphify update-lock dir (#291) — this ALSO isolates the
  // gate-query concurrency slots (gateQuerySlotPath uses the same
  // lockBaseDir()), so a busy-slot assertion in one test can never see a
  // slot left over by another test or a real build on this machine.
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
    const r = runGrep(dir, "s-block", "alphaTerm");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  test("retry of the same search relents (escape hatch) AND does not double-block (R6)", () => {
    const dir = project({ consent: true, graph: "fresh" });
    const first = runGrep(dir, "s-retry", "betaTerm");
    expect(first.stderr).toContain("GRAPHIFY GATE");
    const second = runGrep(dir, "s-retry", "betaTerm");
    expect(second.stderr).not.toContain("GRAPHIFY GATE");
    // R6: without the classic-confirm-flag pre-release, this retry fell
    // straight into the classic full-repo-search threshold block a SECOND
    // time (a different message, "HIGH TOKEN COST", still exit 2).
    expect(second.status).toBe(0);
    expect(second.stderr).not.toContain("HIGH TOKEN COST");
    cleanup(dir);
  });

  test("no consent record (default-on, opt-out model) → graph gate STILL fires", () => {
    const dir = project({ consent: null, graph: "fresh" });
    const r = runGrep(dir, "s-noconsent", "gammaTerm");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  test("declined (consent:false) → graph gate never fires", () => {
    const dir = project({ consent: false, graph: "fresh" });
    const r = runGrep(dir, "s-declined", "deltaTerm");
    expect(r.stderr).not.toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  test("stale graph within tolerance (1 newer file) → STILL blocked, with a lag disclosure", () => {
    const dir = project({ consent: true, graph: "stale" });
    const r = runGrep(dir, "s-stale", "epsilonTerm");
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
    const r = runGrep(wt, "s-worktree", "thetaTerm");
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
    const r = runGrep(dir, "s-queried", "zetaTerm");
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
    const r = runGrep(dir, "s-global-declined", "etaTerm", declinedHome);
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
    const r = runGrep(dir, "s-heal", "omegaTerm");
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

    const r = runGrep(dir, "s-heal-declined", "omegaTerm");
    expect(r.stderr).not.toContain("GRAPHIFY GATE"); // still never blocks beyond tolerance
    // The spawn never happened, so the 2-minute cooldown must NOT be charged —
    // otherwise the next search cannot retry and the graph never converges.
    expect(fs.existsSync(refreshFlagPath(dir))).toBe(false);
    cleanup(dir);
  });

  describe("eligibility (R4/R7) — Grep only, content-mode directory scoping", () => {
    test("a Grep scoped to a single FILE never gates, even with a semantic pattern", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const filePath = path.join(dir, "a.js");
      const r = runGrep(dir, "s-file-scope", "authService", HOME_DIR, GRAPHIFY_STUB, { path: filePath });
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("a Grep scoped to a directory WITHOUT output_mode:'content' → not eligible", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-dir-noconent", "authService", HOME_DIR, GRAPHIFY_STUB, { path: dir });
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      const r2 = runGrep(dir, "s-dir-fwm", "authService", HOME_DIR, GRAPHIFY_STUB, { path: dir, output_mode: "files_with_matches" });
      expect(r2.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("a Grep scoped to a directory WITH output_mode:'content' IS eligible", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-dir-content", "authService", HOME_DIR, GRAPHIFY_STUB, { path: dir, output_mode: "content" });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("Glob is NEVER gated — the answer-in-gate no longer covers it at all", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runTool("Glob", dir, "s-glob", { pattern: "authService" });
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
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

  describe("session-id instability (R5) — sid missing/'nosid' skips the whole gate", () => {
    test("a Grep with no session_id at all is never gated", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, undefined, "authService");
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("an empty-string session_id is never gated", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "", "authService");
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    });
  });

  describe("answer-in-gate — hit vs. no-hit vs. timeout", () => {
    test("a graph HIT blocks and puts the answer directly in the message", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-hit", "authService", HOME_DIR, GRAPHIFY_STUB);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Traversal:");
      expect(r.stderr).toContain("Node:");
      expect(r.stderr).toContain("retry the same search if you need exact matches.");
      cleanup(dir);
    });

    test("no matching nodes (no traversal header) → ALLOWS silently, no gate text at all", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const r = runGrep(dir, "s-noanswer", "authService", HOME_DIR, NOANSWER_STUB);
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("a query that exceeds the timeout ALLOWS silently within a hard wall-clock bound (~5s)", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const started = Date.now();
      const r = runGrep(dir, "s-timeout", "authService", HOME_DIR, TIMEOUT_STUB);
      const elapsedMs = Date.now() - started;
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      // The query's own hard timeout is ~4s; the whole hook run (spawn +
      // Node startup + the rest of the guard) must stay comfortably under
      // 5.5s, proving shell:false lets spawnSync's `timeout` actually kill
      // the child rather than leaving it running past its bound.
      expect(elapsedMs).toBeLessThan(5_500);
      cleanup(dir);
    }, 15_000);
  });

  describe("gate flag TTL (~12h) — Requirement 5", () => {
    test("a stale (>12h old) gate flag is treated as expired, not as an escape hatch", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const sid = "s-ttl";
      const first = runGrep(dir, sid, "authService");
      expect(first.status).toBe(2);
      const gflag = gflagPathFor(sid, dir, { pattern: "authService" });
      expect(fs.existsSync(gflag)).toBe(true);
      fs.writeFileSync(gflag, String(Date.now() - 13 * 60 * 60 * 1000)); // 13h old
      const second = runGrep(dir, sid, "authService");
      // Expired → re-blocked by the gate again (a fresh answer), not silently bypassed.
      expect(second.status).toBe(2);
      expect(second.stderr).toContain("GRAPHIFY GATE");
      cleanup(dir);
    });
  });

  describe("machine-wide gate-query concurrency cap — Requirement 2", () => {
    test("with both slots pre-occupied, an otherwise-eligible search is skipped (allow, gate_skipped_busy)", () => {
      const dir = project({ consent: true, graph: "fresh" });
      // Saturate both default slots (cap=2) directly.
      fs.writeFileSync(gateQuerySlotPath(0), JSON.stringify({ pid: 999999, ts: Date.now() }));
      fs.writeFileSync(gateQuerySlotPath(1), JSON.stringify({ pid: 999999, ts: Date.now() }));
      const before = events().length;
      const r = runGrep(dir, "s-busy", "authService");
      expect(r.stderr).not.toContain("GRAPHIFY GATE");
      const evs = events().slice(before);
      expect(evs.some((e) => e.event === "gate_skipped_busy")).toBe(true);
      cleanup(dir);
    });

    test("a STALE slot (>10s old) is reclaimed rather than treated as busy", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const staleTs = Date.now() - 11_000;
      fs.writeFileSync(gateQuerySlotPath(0), JSON.stringify({ pid: 999999, ts: staleTs }));
      fs.writeFileSync(gateQuerySlotPath(1), JSON.stringify({ pid: 999999, ts: staleTs }));
      const r = runGrep(dir, "s-stale-slot", "authService");
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("GRAPHIFY GATE");
      cleanup(dir);
    });
  });

  // R1: a non-block outcome (timeout, no-hit, error, or a busy slot) must not
  // leave the search undeclared — a retry of the EXACT same search must never
  // then get gate-blocked, whichever way round the two calls go. Live-observed:
  // a path-less search timed out on call 1, then the identical call 2 got a
  // real answer and was BLOCKED — the double block this covers in reverse.
  // The session-start project-map/graph-nudge injection (pre.tokens.guard's
  // OTHER once-per-session feature) intercepts the FIRST broad Grep/Glob of a
  // session with an ALLOW + additionalContext, regardless of the graphify
  // gate's own verdict. `primeMapInjection` burns that one-time slot with an
  // ineligible, throwaway search first, so the tests below observe the
  // classic threshold block on their own first real call, not the nudge.
  function primeMapInjection(dir, sid) {
    runGrep(dir, sid, "ab"); // "ab" fails isSemanticPattern (too short) — never touches the gate
  }

  describe("R1 — declined marker prevents a double block via a non-block outcome", () => {
    test("timeout → classic block on call 1 → identical retry is allowed, never gate-blocked", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const sid = "s-r1-timeout";
      primeMapInjection(dir, sid);
      const first = runGrep(dir, sid, "authService", HOME_DIR, TIMEOUT_STUB);
      expect(first.stderr).not.toContain("GRAPHIFY GATE");
      // The classic full-repo-search threshold block fires instead (first
      // time reaching that code this invocation — the gate declined).
      expect(first.status).toBe(2);
      expect(first.stderr).toContain("HIGH TOKEN COST");
      const second = runGrep(dir, sid, "authService", HOME_DIR, TIMEOUT_STUB);
      expect(second.stderr).not.toContain("GRAPHIFY GATE");
      expect(second.status).toBe(0); // classic retry-to-proceed releases it
      cleanup(dir);
    }, 15_000);

    test("no-hit → classic block on call 1 → identical retry is allowed, never gate-blocked", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const sid = "s-r1-nohit";
      primeMapInjection(dir, sid);
      const first = runGrep(dir, sid, "authService", HOME_DIR, NOANSWER_STUB);
      expect(first.stderr).not.toContain("GRAPHIFY GATE");
      expect(first.status).toBe(2);
      expect(first.stderr).toContain("HIGH TOKEN COST");
      const second = runGrep(dir, sid, "authService", HOME_DIR, NOANSWER_STUB);
      expect(second.stderr).not.toContain("GRAPHIFY GATE");
      expect(second.status).toBe(0);
      cleanup(dir);
    });

    test("a no-hit outcome even if the SAME search would hit on a retry never flips to a gate block (the exact live-observed bug)", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const sid = "s-r1-flip";
      const first = runGrep(dir, sid, "authService", HOME_DIR, NOANSWER_STUB);
      expect(first.stderr).not.toContain("GRAPHIFY GATE");
      // Retry with the STUB THAT WOULD ANSWER — proves the declined marker,
      // not merely "the same stub", is what prevents the flip.
      const second = runGrep(dir, sid, "authService", HOME_DIR, GRAPHIFY_STUB);
      expect(second.stderr).not.toContain("GRAPHIFY GATE");
      cleanup(dir);
    });

    test("busy skip → classic block on call 1 → retry with a FREE slot is allowed, never gate-blocked", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const sid = "s-r1-busy";
      primeMapInjection(dir, sid);
      fs.writeFileSync(gateQuerySlotPath(0), JSON.stringify({ pid: 999999, ts: Date.now() }));
      fs.writeFileSync(gateQuerySlotPath(1), JSON.stringify({ pid: 999999, ts: Date.now() }));
      const first = runGrep(dir, sid, "authService", HOME_DIR, GRAPHIFY_STUB);
      expect(first.stderr).not.toContain("GRAPHIFY GATE");
      expect(first.status).toBe(2);
      expect(first.stderr).toContain("HIGH TOKEN COST");
      // Free the slots — the retry must still not be gate-blocked (the
      // declined marker skips the query regardless of slot availability).
      try { fs.unlinkSync(gateQuerySlotPath(0)); } catch {}
      try { fs.unlinkSync(gateQuerySlotPath(1)); } catch {}
      const second = runGrep(dir, sid, "authService", HOME_DIR, GRAPHIFY_STUB);
      expect(second.stderr).not.toContain("GRAPHIFY GATE");
      expect(second.status).toBe(0);
      cleanup(dir);
    });

    test("a declined outcome does NOT touch the bypass streak or write gate_bypassed", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const sid = "s-r1-no-streak";
      const before = events().length;
      runGrep(dir, sid, "authService", HOME_DIR, NOANSWER_STUB);
      runGrep(dir, sid, "authService", HOME_DIR, NOANSWER_STUB); // declined-marker skip
      const evs = events().slice(before);
      expect(evs.some((e) => e.event === "gate_bypassed")).toBe(false);
      expect(evs.some((e) => e.event === "gate_noanswer")).toBe(true);
      // Only ONE gate_noanswer — the second call skipped the query entirely.
      expect(evs.filter((e) => e.event === "gate_noanswer")).toHaveLength(1);
      cleanup(dir);
    });
  });

  // R2: repeating the SAME already-bypassed search must NOT keep inflating
  // the streak (the old bug — `last.key === searchKey` without also checking
  // `!last.bypassed` — let ONE search retried three times relent the gate,
  // as if three DIFFERENT searches had each declined an answer).
  test("R2: repeating the SAME bypassed search 2 more times does NOT relent the gate", () => {
    const dir = project({ consent: true, graph: "fresh" });
    const sid = "s-r2-no-inflation";
    const first = runGrep(dir, sid, "answerTerm", HOME_DIR, GRAPHIFY_STUB);
    expect(first.status).toBe(2); // blocked with an accepted answer — bypass streak starts at 0
    for (let i = 0; i < 3; i++) {
      const r = runGrep(dir, sid, "answerTerm", HOME_DIR, GRAPHIFY_STUB);
      expect(r.stderr).not.toContain("GRAPHIFY GATE"); // escape hatch bypass, every time
    }
    // A brand-new eligible search must STILL be gated — the streak only ever
    // reached 1 (the same search bypassed repeatedly counts once), nowhere
    // near the 3-DIFFERENT-searches threshold.
    const freshSearch = runGrep(dir, sid, "freshUnseenTerm", HOME_DIR, GRAPHIFY_STUB);
    expect(freshSearch.status).toBe(2);
    expect(freshSearch.stderr).toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  test("adaptive relent (R5): 3 blocks/bypasses on 3 DIFFERENT searches still relents the gate", () => {
    const dir = project({ consent: true, graph: "fresh" });
    const sid = "s-adaptive-relent-different";
    for (let i = 0; i < 3; i++) {
      const term = `differentTerm${i}`;
      const blocked = runGrep(dir, sid, term, HOME_DIR, GRAPHIFY_STUB);
      expect(blocked.status).toBe(2);
      const bypassed = runGrep(dir, sid, term, HOME_DIR, GRAPHIFY_STUB);
      expect(bypassed.stderr).not.toContain("GRAPHIFY GATE");
    }
    const freshSearch = runGrep(dir, sid, "yetAnotherTerm", HOME_DIR, GRAPHIFY_STUB);
    expect(freshSearch.stderr).not.toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  test("a block that is NEVER retried resets the streak — a later bypass elsewhere does not relent early", () => {
    const dir = project({ consent: true, graph: "fresh" });
    const sid = "s-reset-on-accept";
    // Block + bypass term A (streak → 1).
    expect(runGrep(dir, sid, "resetTermA", HOME_DIR, GRAPHIFY_STUB).status).toBe(2);
    runGrep(dir, sid, "resetTermA", HOME_DIR, GRAPHIFY_STUB); // bypass, streak=1
    // Block term B and NEVER retry it — an accepted answer, resets the streak.
    expect(runGrep(dir, sid, "resetTermB", HOME_DIR, GRAPHIFY_STUB).status).toBe(2);
    // Block + bypass term C twice more (streak would only reach 2 total from
    // here, not 3) — must NOT relent yet.
    expect(runGrep(dir, sid, "resetTermC", HOME_DIR, GRAPHIFY_STUB).status).toBe(2);
    runGrep(dir, sid, "resetTermC", HOME_DIR, GRAPHIFY_STUB); // bypass, streak=1 (reset by B)
    const stillGated = runGrep(dir, sid, "resetTermD", HOME_DIR, GRAPHIFY_STUB);
    expect(stillGated.status).toBe(2); // NOT relented — streak reset by B's unretried accept
    expect(stillGated.stderr).toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  describe("telemetry (R9 support) — outputMode and keyHash on gate events", () => {
    test("gate_fired and gate_bypassed carry outputMode and a keyHash that LINKS them", () => {
      const dir = project({ consent: true, graph: "fresh" });
      const sid = "s-telemetry-link";
      const before = events().length;
      runGrep(dir, sid, "linkedTerm", HOME_DIR, GRAPHIFY_STUB, { output_mode: "content" });
      runGrep(dir, sid, "linkedTerm", HOME_DIR, GRAPHIFY_STUB, { output_mode: "content" }); // bypass
      const evs = events().slice(before);
      const fired = evs.find((e) => e.event === "gate_fired");
      const bypassed = evs.find((e) => e.event === "gate_bypassed");
      expect(fired).toBeTruthy();
      expect(bypassed).toBeTruthy();
      expect(fired.outputMode).toBe("content");
      expect(fired.keyHash).toBeTruthy();
      expect(bypassed.keyHash).toBe(fired.keyHash);
      expect(fired.answerChars).toBeGreaterThan(0);
      cleanup(dir);
    });
  });
});
