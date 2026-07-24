import { describe, test, expect, vi, afterEach } from "vitest";
import {
  isClaudeMcpServer,
  liveClaudeExclusion,
  computeSelfSubtree,
  findReapable,
  reap,
  parseWin32ProcessJson,
  parseWmicCsv,
} from "./mcp-reaper.js";

const CACHE_CMD_DISCORD =
  'C:\\Users\\jerry\\.claude\\plugins\\cache\\discord\\bin\\bun.exe run server.ts';
const CACHE_CMD_GENERIC =
  'node "C:\\Users\\jerry\\.claude\\plugins\\cache\\github\\mcp-server\\index.js"';

// Real evidence command lines from the red-team's live process table.
const REAL_DISCORD_BUN =
  'bun run --cwd C:/Users/jerry/.claude/plugins/cache/claude-plugins-official/discord/0.0.1 --shell=bun --silent start';
const REAL_DEVOPS_STDIO =
  'node C:/Users/jerry/.claude/plugins/cache/dotclaude/devops/0.119.1/mcp-server/index.js';
const REAL_PLAYWRIGHT_NPX_CLI =
  'node C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js "@playwright/mcp@latest" --browser msedge';
const REAL_PLAYWRIGHT_NPX_DIRECT =
  'node C:/Users/jerry/AppData/Local/npm-cache/_npx/a1b2c3/node_modules/.bin/../@playwright/mcp/cli.js --browser msedge';
const REAL_CONTEXT7_NPX_CLI =
  'node C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js -y "@upstash/context7-mcp@latest"';
const REAL_CONTEXT7_NPX_DIRECT =
  'node C:/Users/jerry/AppData/Local/npm-cache/_npx/d4e5f6/node_modules/@upstash/context7-mcp/dist/index.js';
// The devops-concept bridge server — lives under the plugin cache (so it hits
// the CACHE_PATH_FRAGMENT signature) but is NOT an MCP server; it is a
// long-lived local HTTP bridge that must survive Stop/SessionStart reaps for
// the whole concept session.
const REAL_CONCEPT_BRIDGE =
  'C:\\Users\\jerry\\AppData\\Local\\Programs\\Python\\Python312\\python.exe C:\\Users\\jerry\\.claude\\plugins\\cache\\dotclaude\\devops\\0.121.1\\scripts\\concept-server.py 8791 C:/Users/jerry/proj --html docs/concepts/x.html';

// A live "claude root" process — makes liveClaudeExclusion's census non-empty
// so findReapable's fail-safe gate doesn't swallow every other test.
const LIVE_CLAUDE_ROOT = { pid: 1, ppid: 0, name: "claude.exe", command: "C:\\Users\\jerry\\AppData\\Local\\Programs\\Claude\\Claude.exe" };

// ---------------------------------------------------------------------------
// isClaudeMcpServer — tightened signature (R5): cache path, OR
// (npx marker AND "mcp" token)
// ---------------------------------------------------------------------------

describe("isClaudeMcpServer", () => {
  test("matches the real discord bun launcher (plugin-cache path)", () => {
    expect(isClaudeMcpServer({ command: REAL_DISCORD_BUN })).toBe(true);
  });

  test("matches the real devops stdio MCP server (plugin-cache path)", () => {
    expect(isClaudeMcpServer({ command: REAL_DEVOPS_STDIO })).toBe(true);
  });

  test("matches the real playwright MCP server via npx-cli.js (npx marker + mcp token)", () => {
    expect(isClaudeMcpServer({ command: REAL_PLAYWRIGHT_NPX_CLI })).toBe(true);
  });

  test("matches the real playwright MCP server via direct _npx cache path (npx marker + mcp token)", () => {
    expect(isClaudeMcpServer({ command: REAL_PLAYWRIGHT_NPX_DIRECT })).toBe(true);
  });

  test("matches the real context7 MCP server via npx-cli.js (npx marker + mcp token)", () => {
    expect(isClaudeMcpServer({ command: REAL_CONTEXT7_NPX_CLI })).toBe(true);
  });

  test("matches the real context7 MCP server via direct _npx cache path (npx marker + mcp token)", () => {
    expect(isClaudeMcpServer({ command: REAL_CONTEXT7_NPX_DIRECT })).toBe(true);
  });

  test("R5: does NOT match a bare `npx vite` (npx marker present in real form, no mcp token)", () => {
    const proc = { command: "node C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js vite" };
    expect(isClaudeMcpServer(proc)).toBe(false);
  });

  test("R5: does NOT match a bare `npx tsx` via the _npx cache path (npx marker present, no mcp token)", () => {
    const proc = { command: "node C:\\Users\\jerry\\AppData\\Local\\npm-cache\\_npx\\ffaa11\\node_modules\\.bin\\tsx watch main.ts" };
    expect(isClaudeMcpServer(proc)).toBe(false);
  });

  test("R5: does NOT match literal `npx create-react-app`", () => {
    expect(isClaudeMcpServer({ command: "npx create-react-app my-app" })).toBe(false);
  });

  test("R5: does NOT match `npm exec eslint`", () => {
    expect(isClaudeMcpServer({ command: "npm exec eslint ." })).toBe(false);
  });

  test("does NOT match an unrelated bun dev server (user project, not plugin cache)", () => {
    const proc = { command: "bun run dev --cwd C:\\Users\\jerry\\projects\\my-app" };
    expect(isClaudeMcpServer(proc)).toBe(false);
  });

  test("does NOT match a random node process outside plugins cache", () => {
    expect(isClaudeMcpServer({ command: "node index.js" })).toBe(false);
  });

  test("does NOT match the devops-concept bridge server (concept-server.py is a local bridge, not an MCP server)", () => {
    expect(isClaudeMcpServer({ command: REAL_CONCEPT_BRIDGE })).toBe(false);
  });

  test("findReapable never flags an orphaned devops-concept bridge (dead parent, outside census)", () => {
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 77, ppid: 999999, name: "python.exe", command: REAL_CONCEPT_BRIDGE },
    ];
    const isAlive = (pid) => pid === 1;
    const candidates = findReapable(procs, { selfPid: 5, isAlive, platform: "win32" });
    expect(candidates).toHaveLength(0);
  });

  test("does NOT match Claude Desktop itself or its renderer processes", () => {
    const proc = { command: '"C:\\Users\\jerry\\AppData\\Local\\Programs\\Claude\\Claude.exe" --type=renderer' };
    expect(isClaudeMcpServer(proc)).toBe(false);
  });

  test("handles missing/empty command safely", () => {
    expect(isClaudeMcpServer({ command: "" })).toBe(false);
    expect(isClaudeMcpServer({})).toBe(false);
    expect(isClaudeMcpServer(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// liveClaudeExclusion — the live-Claude census (R2/R3)
// ---------------------------------------------------------------------------

describe("liveClaudeExclusion", () => {
  test("finds a live claude.exe root and its full descendant subtree", () => {
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 2, ppid: 1, name: "bun.exe", command: REAL_DISCORD_BUN },
      { pid: 3, ppid: 2, name: "node.exe", command: "some grandchild" },
    ];
    const isAlive = () => true;
    const census = liveClaudeExclusion(procs, isAlive);
    expect(census).toEqual(new Set([1, 2, 3]));
  });

  test("matches a root by command containing 'claude-code' even when the name isn't claude.exe", () => {
    const procs = [
      { pid: 7, ppid: 1, name: "node.exe", command: "node /usr/local/bin/claude-code" },
      { pid: 8, ppid: 7, name: "node.exe", command: REAL_DEVOPS_STDIO },
    ];
    const isAlive = () => true;
    const census = liveClaudeExclusion(procs, isAlive);
    expect(census).toEqual(new Set([7, 8]));
  });

  test("a claude-named process that is NOT alive is not a root (and protects nothing)", () => {
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 2, ppid: 1, name: "node.exe", command: REAL_DEVOPS_STDIO },
    ];
    const isAlive = () => false; // even the claude root reports dead
    expect(liveClaudeExclusion(procs, isAlive)).toEqual(new Set());
  });

  test("no claude-like process anywhere -> empty census", () => {
    const procs = [{ pid: 9, ppid: 1, name: "node.exe", command: REAL_DEVOPS_STDIO }];
    expect(liveClaudeExclusion(procs, () => true)).toEqual(new Set());
  });

  test("empty process list -> empty census", () => {
    expect(liveClaudeExclusion([], () => true)).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// findReapable
// ---------------------------------------------------------------------------

describe("findReapable", () => {
  test("flags a signature+dead-parent process that is OUTSIDE the live-claude census (positive case)", () => {
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 10, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC }, // unrelated orphan
    ];
    const isAlive = (pid) => pid === 1; // only claude alive; 999999 dead
    const result = findReapable(procs, { selfPid: 5, isAlive });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ pid: 10, ppid: 999999 });
  });

  test("does NOT flag an MCP-signature process whose parent is alive", () => {
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 11, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC },
    ];
    const isAlive = () => true; // everything alive, including ppid 999999
    expect(findReapable(procs, { selfPid: 5, isAlive })).toHaveLength(0);
  });

  test("does NOT flag a non-MCP-signature process, even if orphaned", () => {
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 12, ppid: 999999, name: "notepad.exe", command: "notepad.exe C:\\file.txt" },
    ];
    const isAlive = (pid) => pid === 1;
    expect(findReapable(procs, { selfPid: 5, isAlive })).toHaveLength(0);
  });

  test("R2 FAIL-SAFE: no live claude process anywhere in the snapshot -> refuses to " +
    "produce ANY candidates, even for a textbook signature+dead-parent match", () => {
    const procs = [{ pid: 10, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC }];
    const isAlive = (pid) => pid !== 999999; // parent genuinely dead
    // No claude-like process anywhere -> census.size === 0 -> "unknown", refuse.
    expect(findReapable(procs, { selfPid: 5, isAlive })).toEqual([]);
  });

  test("R2/R3 cousin topology: an MCP server descending from a dead intermediate wrapper is " +
    "protected via the live-claude census, independent of the reaper's own position in the tree", () => {
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 900, ppid: 1, name: "node.exe", command: "node hook-runner.js" }, // the reaper — a COUSIN of the MCP server below, not its ancestor
      { pid: 2, ppid: 1, name: "node.exe", command: "node npx-cli.js" }, // wrapper, still present in this snapshot
      { pid: 901, ppid: 2, name: "node.exe", command: CACHE_CMD_GENERIC }, // MCP server, descends from the wrapper, not from the reaper
    ];
    // Only the claude root reports alive; the wrapper (901's immediate
    // parent) reports dead. The naive dead-parent-only rule — and the OLD
    // self-subtree-only exclusion rooted at selfPid=900 — would both flag
    // 901, since it is neither an ancestor nor a descendant of the reaper.
    const isAlive = (pid) => pid === 1;
    const result = findReapable(procs, { selfPid: 900, isAlive });
    expect(result).toEqual([]);

    // Prove computeSelfSubtree ALONE (the old mechanism) would NOT have
    // caught this — documenting why the census layer was necessary.
    const oldStyleSubtree = computeSelfSubtree(procs, 900);
    expect(oldStyleSubtree.has(901)).toBe(false);
  });

  test("R2/R3 live-ancestor-not-reaped: census protection overrides a dead-immediate-parent " +
    "read even multiple hops down a still-present chain", () => {
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 2, ppid: 1, name: "node.exe", command: "node npx-cli.js wrapper" }, // intermediate, still present in the snapshot
      { pid: 3, ppid: 2, name: "node.exe", command: CACHE_CMD_GENERIC }, // signature match, descends from the wrapper
    ];
    // isAlive reports pid 2 (the immediate parent of the target) as DEAD —
    // the naive dead-parent signal alone would flag pid 3 as orphaned — but
    // pid 3 is still structurally beneath the live claude root (pid 1) in
    // this snapshot, so the census must protect it regardless.
    const isAlive = (pid) => pid === 1;
    const result = findReapable(procs, { selfPid: 999, isAlive });
    expect(result).toEqual([]);
  });

  test("computeSelfSubtree still protects the reaper's own ancestor even when the census " +
    "doesn't recognize that ancestor as claude-like", () => {
    const procs = [
      LIVE_CLAUDE_ROOT, // makes census non-empty
      // The reaper's own parent process — happens to ALSO match the MCP
      // signature (contrived, but proves the point) and its own recorded
      // ppid is dead, so on signature+orphan alone it would be a
      // "candidate" — but it is the reaper's direct ancestor.
      { pid: 50, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC },
      { pid: 900, ppid: 50, name: "node.exe", command: "node mcp-reaper.js" }, // the reaper itself
    ];
    const isAlive = (pid) => pid === 1;
    const result = findReapable(procs, { selfPid: 900, isAlive });
    expect(result).toEqual([]); // pid 50 protected via computeSelfSubtree, not via census
  });

  test("computeSelfSubtree still protects the reaper's own descendant even when the census " +
    "doesn't recognize the reaper as claude-like", () => {
    const procs = [
      LIVE_CLAUDE_ROOT, // makes census non-empty, unrelated to the reaper below
      { pid: 900, ppid: 999999, name: "node.exe", command: "node mcp-reaper.js" }, // reaper, NOT a descendant of claude in this snapshot
      { pid: 901, ppid: 900, name: "node.exe", command: CACHE_CMD_GENERIC }, // reaper's own child, matches signature
    ];
    const isAlive = (pid) => pid === 1;
    const result = findReapable(procs, { selfPid: 900, isAlive });
    expect(result).toEqual([]); // pid 901 protected via computeSelfSubtree, not via census
  });

  test("R7: never flags a process whose command matches the reaper's own running script " +
    "path, independent of selfPid", () => {
    const procs = [
      LIVE_CLAUDE_ROOT,
      {
        pid: 950, ppid: 999999, name: "node.exe",
        command: "node C:\\Users\\jerry\\.claude\\plugins\\cache\\dotclaude\\devops\\0.119.1\\scripts\\mcp-reap.js",
      },
    ];
    const isAlive = (pid) => pid === 1;
    // selfPid deliberately WRONG/unrelated to prove the own-process guard
    // works independent of selfPid resolution.
    const result = findReapable(procs, {
      selfPid: 5,
      isAlive,
      ownSignature: "c:/users/jerry/.claude/plugins/cache/dotclaude/devops/0.119.1/scripts/mcp-reap.js",
    });
    expect(result).toEqual([]);
  });

  test("R6: POSIX is a documented no-op — dead-parent reparenting to a live PID 1 never fires", () => {
    const procs = [
      { pid: 1, ppid: 0, name: "systemd", command: "/sbin/init" }, // PID 1, always alive on POSIX
      { pid: 70, ppid: 1, name: "node", command: CACHE_CMD_GENERIC }, // orphan reparented to PID 1
    ];
    const isAlive = () => true; // this is what POSIX reparenting looks like
    const result = findReapable(procs, { selfPid: 5, isAlive, platform: "linux" });
    expect(result).toEqual([]);
  });

  test("empty process list -> empty result", () => {
    expect(findReapable([], { selfPid: 5 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseWin32ProcessJson — pure parser, incl. single-result object guard
// ---------------------------------------------------------------------------

describe("parseWin32ProcessJson", () => {
  test("parses a JSON array of results", () => {
    const json = JSON.stringify([
      { ProcessId: 10, ParentProcessId: 1, Name: "node.exe", CommandLine: CACHE_CMD_GENERIC, WorkingSetSize: 1048576 },
      { ProcessId: 11, ParentProcessId: 1, Name: "bun.exe", CommandLine: CACHE_CMD_DISCORD, WorkingSetSize: 2097152 },
    ]);
    const result = parseWin32ProcessJson(json);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ pid: 10, ppid: 1, name: "node.exe", rssBytes: 1048576 });
  });

  test("guards against ConvertTo-Json emitting a bare object (not an array) for a single result", () => {
    const json = JSON.stringify({ ProcessId: 42, ParentProcessId: 1, Name: "node.exe", CommandLine: CACHE_CMD_GENERIC, WorkingSetSize: 512 });
    const result = parseWin32ProcessJson(json);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ pid: 42, ppid: 1 });
  });

  test("empty/malformed input -> []", () => {
    expect(parseWin32ProcessJson("")).toEqual([]);
    expect(parseWin32ProcessJson("not json")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseWmicCsv — pure parser, embedded-comma robustness (R8)
// ---------------------------------------------------------------------------

describe("parseWmicCsv", () => {
  test("reconstructs a CommandLine containing embedded commas without corruption, and it " +
    "correctly resolves to an MCP signature match when it genuinely is one", () => {
    const csv = [
      "Node,CommandLine,Name,ParentProcessId,ProcessId,WorkingSetSize",
      "MYHOST,node.exe --config C:\\Users\\jerry\\.claude\\plugins\\cache\\discord\\config,json,node.exe,1234,5678,104857600",
    ].join("\r\n");
    const result = parseWmicCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ pid: 5678, ppid: 1234, name: "node.exe" });
    expect(result[0].command).toContain(".claude\\plugins\\cache\\discord\\config,json");
    expect(isClaudeMcpServer(result[0])).toBe(true);
  });

  test("a benign CommandLine with embedded commas does NOT spuriously match the MCP signature", () => {
    const csv = [
      "Node,CommandLine,Name,ParentProcessId,ProcessId,WorkingSetSize",
      'MYHOST,C:\\Program Files\\SomeApp\\app.exe --file "C:\\data,file.txt",app.exe,1,9999,20480',
    ].join("\r\n");
    const result = parseWmicCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ pid: 9999, ppid: 1, name: "app.exe" });
    expect(result[0].command).toBe('C:\\Program Files\\SomeApp\\app.exe --file "C:\\data,file.txt"');
    expect(isClaudeMcpServer(result[0])).toBe(false);
  });

  test("empty/malformed input -> []", () => {
    expect(parseWmicCsv("")).toEqual([]);
    expect(parseWmicCsv("Node,CommandLine,Name,ParentProcessId,ProcessId,WorkingSetSize")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reap — dry-run must never kill; apply mode kills via injected deps only;
// TOCTOU re-validation (R4)
// ---------------------------------------------------------------------------

describe("reap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("dry-run (default) never calls process.kill, even with reapable candidates", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 40, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC, rssBytes: 100 * 1024 * 1024 },
    ];
    const isAlive = (pid) => pid === 1;

    const result = await reap({ selfPid: 5, listProcs: () => procs, isAlive }); // dryRun defaults true

    expect(result.candidates).toHaveLength(1);
    expect(result.killed).toEqual([]);
    expect(killSpy).not.toHaveBeenCalled();
  });

  test("dry-run is the default even when dryRun is omitted entirely", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const result = await reap({ selfPid: 5, listProcs: () => [], isAlive: () => true });
    expect(result.killed).toEqual([]);
    expect(killSpy).not.toHaveBeenCalled();
  });

  test("apply mode (dryRun:false) kills candidates via SIGTERM only when it dies promptly", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 41, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC },
    ];
    // parent(999999) dead -> orphaned; pid 41 itself also reports dead after SIGTERM -> no SIGKILL needed
    const isAlive = (pid) => pid === 1 || (pid !== 999999 && pid !== 41);
    const listProcs = () => procs; // stable snapshot -> TOCTOU re-checks pass

    const result = await reap({ selfPid: 5, listProcs, isAlive, dryRun: false, graceMs: 0 });

    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(41, "SIGTERM");
    expect(result.killed).toEqual([41]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  test("apply mode escalates to SIGKILL if the process survives the grace period", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 42, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC },
    ];
    // parent(999999) dead (orphaned), but pid 42 itself still reports alive
    // post-SIGTERM, forcing the SIGKILL escalation.
    const isAlive = (pid) => pid === 1 || pid === 42;
    const listProcs = () => procs;

    const result = await reap({ selfPid: 5, listProcs, isAlive, dryRun: false, graceMs: 0 });

    expect(killSpy).toHaveBeenCalledWith(42, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(42, "SIGKILL");
    expect(result.killed).toEqual([42]);
  });

  test("guards kill errors in try/catch and reports them without throwing", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => { throw new Error("no such process"); });
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 43, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC },
    ];
    const isAlive = (pid) => pid === 1;
    const listProcs = () => procs;

    const result = await reap({ selfPid: 5, listProcs, isAlive, dryRun: false, graceMs: 0 });

    expect(result.killed).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ pid: 43, stage: "SIGTERM" });
  });

  test("never touches a live session's own MCP server even in apply mode (cousin topology)", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 900, ppid: 1, name: "node.exe", command: "node hook-runner.js" }, // reaper, cousin of the server below
      { pid: 2, ppid: 1, name: "node.exe", command: "node npx-cli.js" }, // wrapper, still present in this snapshot
      { pid: 901, ppid: 2, name: "node.exe", command: CACHE_CMD_GENERIC }, // live session's own MCP server, descends from the wrapper via the census
    ];
    const isAlive = (pid) => pid === 1;
    const listProcs = () => procs;

    const result = await reap({ selfPid: 900, listProcs, isAlive, dryRun: false, graceMs: 0 });

    expect(result.candidates).toHaveLength(0);
    expect(result.killed).toEqual([]);
    expect(killSpy).not.toHaveBeenCalled();
  });

  test("R4 TOCTOU: skips (does not kill) a candidate whose pid was reused before the SIGTERM " +
    "re-check — the initial scan still lists it as a candidate, but the kill never fires", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const orphanProc = { pid: 60, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC };
    const reusedProc = { pid: 60, ppid: 1, name: "notepad.exe", command: "notepad.exe unrelated.txt" };
    let call = 0;
    const listProcs = () => {
      call += 1;
      // call 1: initial scan (used to build `candidates`).
      // call 2+: TOCTOU re-check — pid 60 has been reused by an unrelated process.
      return call === 1 ? [LIVE_CLAUDE_ROOT, orphanProc] : [LIVE_CLAUDE_ROOT, reusedProc];
    };
    const isAlive = (pid) => pid === 1;

    const result = await reap({ selfPid: 5, listProcs, isAlive, dryRun: false, graceMs: 0 });

    expect(result.candidates).toHaveLength(1); // initial scan still flagged it
    expect(result.killed).toEqual([]);
    expect(killSpy).not.toHaveBeenCalled(); // TOCTOU pre-SIGTERM re-check caught the mismatch
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ pid: 60, stage: "pre-SIGTERM" });
  });

  test("R4 TOCTOU: skips the SIGKILL escalation if re-validation fails after the grace period " +
    "(e.g. the process's parent came back alive in a race)", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const orphanProc = { pid: 61, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC };
    let call = 0;
    const listProcs = () => {
      call += 1;
      // call 1: initial scan. call 2: pre-SIGTERM re-check (still orphaned).
      // call 3: pre-SIGKILL re-check — parent is now reported alive (race).
      if (call <= 2) return [LIVE_CLAUDE_ROOT, orphanProc];
      return [LIVE_CLAUDE_ROOT, { ...orphanProc, ppid: 1 }];
    };
    // pid 61 itself still reports ALIVE post-SIGTERM (forces the SIGKILL
    // escalation path); ppid 999999 (the dead parent) never reports alive.
    const isAlive = (pid) => pid === 1 || pid === 61;

    const result = await reap({ selfPid: 5, listProcs, isAlive, dryRun: false, graceMs: 0 });

    expect(killSpy).toHaveBeenCalledTimes(1); // only the SIGTERM, no SIGKILL
    expect(killSpy).toHaveBeenCalledWith(61, "SIGTERM");
    expect(result.killed).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ pid: 61, stage: "pre-SIGKILL" });
  });

  test("R6: reap() on a non-Windows platform never kills anything (findReapable no-op)", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const procs = [
      { pid: 1, ppid: 0, name: "systemd", command: "/sbin/init" },
      { pid: 70, ppid: 1, name: "node", command: CACHE_CMD_GENERIC },
    ];
    const result = await reap({
      selfPid: 5, listProcs: () => procs, isAlive: () => true, dryRun: false, graceMs: 0, platform: "linux",
    });
    expect(result.candidates).toEqual([]);
    expect(result.killed).toEqual([]);
    expect(killSpy).not.toHaveBeenCalled();
  });

  test("freedEstimateMb sums measured rssBytes when available", async () => {
    const procs = [
      LIVE_CLAUDE_ROOT,
      { pid: 50, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC, rssBytes: 200 * 1024 * 1024 },
      { pid: 51, ppid: 999999, name: "bun.exe", command: CACHE_CMD_DISCORD, rssBytes: 300 * 1024 * 1024 },
    ];
    const isAlive = (pid) => pid === 1;
    const result = await reap({ selfPid: 5, listProcs: () => procs, isAlive });
    expect(result.freedEstimateMb).toBe(500);
  });
});
