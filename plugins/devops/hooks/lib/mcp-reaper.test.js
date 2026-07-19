import { describe, test, expect, vi, afterEach } from "vitest";
import { isClaudeMcpServer, findReapable, reap } from "./mcp-reaper.js";

const CACHE_CMD_DISCORD =
  'C:\\Users\\jerry\\.claude\\plugins\\cache\\discord\\bin\\bun.exe run server.ts';
const CACHE_CMD_GENERIC =
  'node "C:\\Users\\jerry\\.claude\\plugins\\cache\\github\\mcp-server\\index.js"';

// ---------------------------------------------------------------------------
// isClaudeMcpServer — signature matching only
// ---------------------------------------------------------------------------

describe("isClaudeMcpServer", () => {
  test("matches a bun launcher for a plugin-cache MCP server (discord)", () => {
    expect(isClaudeMcpServer({ pid: 100, ppid: 1, name: "bun.exe", command: CACHE_CMD_DISCORD }))
      .toBe(true);
  });

  test("matches a node plugin-cache stdio MCP server", () => {
    expect(isClaudeMcpServer({ pid: 101, ppid: 1, name: "node.exe", command: CACHE_CMD_GENERIC }))
      .toBe(true);
  });

  test("matches a node npx MCP server (_npx cache path)", () => {
    const proc = {
      pid: 102, ppid: 1, name: "node.exe",
      command: "node C:\\Users\\jerry\\AppData\\Local\\npm-cache\\_npx\\abc123\\node_modules\\.bin\\playwright-mcp",
    };
    expect(isClaudeMcpServer(proc)).toBe(true);
  });

  test("matches node running npx-cli.js", () => {
    const proc = {
      pid: 103, ppid: 1, name: "node.exe",
      command: "node C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js @modelcontextprotocol/server-github",
    };
    expect(isClaudeMcpServer(proc)).toBe(true);
  });

  test("does NOT match an unrelated bun dev server (user project, not plugin cache)", () => {
    const proc = {
      pid: 200, ppid: 1, name: "bun.exe",
      command: "bun run dev --cwd C:\\Users\\jerry\\projects\\my-app",
    };
    expect(isClaudeMcpServer(proc)).toBe(false);
  });

  test("does NOT match a random node process outside plugins cache", () => {
    expect(isClaudeMcpServer({ pid: 201, ppid: 1, name: "node.exe", command: "node index.js" }))
      .toBe(false);
  });

  test("does NOT match Claude Desktop itself or its renderer processes", () => {
    const proc = {
      pid: 202, ppid: 1, name: "Claude.exe",
      command: '"C:\\Users\\jerry\\AppData\\Local\\Programs\\Claude\\Claude.exe" --type=renderer',
    };
    expect(isClaudeMcpServer(proc)).toBe(false);
  });

  test("handles missing/empty command safely", () => {
    expect(isClaudeMcpServer({ pid: 1, ppid: 0, name: "x", command: "" })).toBe(false);
    expect(isClaudeMcpServer({ pid: 1, ppid: 0, name: "x" })).toBe(false);
    expect(isClaudeMcpServer(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findReapable — signature + dead-parent rule + self-subtree exclusion
// ---------------------------------------------------------------------------

describe("findReapable", () => {
  test("flags an MCP-signature process whose parent is dead", () => {
    const procs = [{ pid: 10, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC }];
    const isAlive = (pid) => pid !== 999999;
    const result = findReapable(procs, { selfPid: 5, isAlive });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ pid: 10, ppid: 999999 });
  });

  test("does NOT flag an MCP-signature process whose parent is alive", () => {
    const procs = [{ pid: 11, ppid: 5, name: "node.exe", command: CACHE_CMD_GENERIC }];
    const isAlive = () => true; // everything alive
    expect(findReapable(procs, { selfPid: 5, isAlive })).toHaveLength(0);
  });

  test("does NOT flag a non-MCP-signature process, even if orphaned", () => {
    const procs = [{ pid: 12, ppid: 999999, name: "notepad.exe", command: "notepad.exe C:\\file.txt" }];
    const isAlive = (pid) => pid !== 999999;
    expect(findReapable(procs, { selfPid: 5, isAlive })).toHaveLength(0);
  });

  test("self-subtree exclusion: never flags the live session's own MCP server, " +
    "even under a pathological isAlive stub that says everything is dead", () => {
    // selfPid=5 is the live claude-code session; pid 20 is its own MCP-server
    // child. isAlive is stubbed to always report "dead" to prove the subtree
    // exclusion — not liveness alone — protects the live session's own tree.
    const procs = [
      { pid: 5, ppid: 1, name: "node.exe", command: "claude-code" },
      { pid: 20, ppid: 5, name: "node.exe", command: CACHE_CMD_GENERIC },
    ];
    const isAlive = () => false;
    expect(findReapable(procs, { selfPid: 5, isAlive })).toHaveLength(0);
  });

  test("self-subtree exclusion also protects ancestors of selfPid", () => {
    const procs = [
      { pid: 1, ppid: 0, name: "node.exe", command: CACHE_CMD_GENERIC }, // ancestor, matches signature
      { pid: 5, ppid: 1, name: "node.exe", command: "claude-code" }, // self
    ];
    const isAlive = () => false;
    expect(findReapable(procs, { selfPid: 5, isAlive })).toHaveLength(0);
  });

  test("excludes selfPid itself even if it matches the MCP signature and looks orphaned", () => {
    const procs = [{ pid: 5, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC }];
    const isAlive = (pid) => pid !== 999999;
    expect(findReapable(procs, { selfPid: 5, isAlive })).toHaveLength(0);
  });

  test("a sibling session's orphaned MCP server (unrelated subtree) IS flagged", () => {
    const procs = [
      { pid: 5, ppid: 1, name: "node.exe", command: "claude-code" }, // self, alive chain
      { pid: 30, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC }, // unrelated orphan
    ];
    const isAlive = (pid) => pid !== 999999;
    const result = findReapable(procs, { selfPid: 5, isAlive });
    expect(result.map((r) => r.pid)).toEqual([30]);
  });

  test("empty process list -> empty result", () => {
    expect(findReapable([], { selfPid: 5 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reap — dry-run must never kill; apply mode kills via injected deps only
// ---------------------------------------------------------------------------

describe("reap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("dry-run (default) never calls process.kill, even with reapable candidates", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const procs = [{ pid: 40, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC, rssBytes: 100 * 1024 * 1024 }];
    const isAlive = (pid) => pid !== 999999;

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
    const procs = [{ pid: 41, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC }];
    // parent(999999) dead -> orphaned; pid 41 itself also reports dead after SIGTERM -> no SIGKILL needed
    const isAlive = (pid) => pid !== 999999 && pid !== 41;

    const result = await reap({ selfPid: 5, listProcs: () => procs, isAlive, dryRun: false, graceMs: 0 });

    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(41, "SIGTERM");
    expect(result.killed).toEqual([41]);
    expect(result.errors).toEqual([]);
  });

  test("apply mode escalates to SIGKILL if the process survives the grace period", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const procs = [{ pid: 42, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC }];
    // parent dead (orphaned), but pid 42 itself still reports alive post-SIGTERM
    const isAlive = (pid) => pid !== 999999;

    const result = await reap({ selfPid: 5, listProcs: () => procs, isAlive, dryRun: false, graceMs: 0 });

    expect(killSpy).toHaveBeenCalledWith(42, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(42, "SIGKILL");
    expect(result.killed).toEqual([42]);
  });

  test("guards kill errors in try/catch and reports them without throwing", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => { throw new Error("no such process"); });
    const procs = [{ pid: 43, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC }];
    const isAlive = (pid) => pid !== 999999;

    const result = await reap({ selfPid: 5, listProcs: () => procs, isAlive, dryRun: false, graceMs: 0 });

    expect(result.killed).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ pid: 43, stage: "SIGTERM" });
  });

  test("never touches the live session's own MCP server even in apply mode", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const procs = [
      { pid: 5, ppid: 1, name: "node.exe", command: "claude-code" },
      { pid: 20, ppid: 5, name: "node.exe", command: CACHE_CMD_GENERIC },
    ];
    const isAlive = () => false; // pathological: everything looks dead

    const result = await reap({ selfPid: 5, listProcs: () => procs, isAlive, dryRun: false, graceMs: 0 });

    expect(result.candidates).toHaveLength(0);
    expect(result.killed).toEqual([]);
    expect(killSpy).not.toHaveBeenCalled();
  });

  test("freedEstimateMb sums measured rssBytes when available", async () => {
    const procs = [
      { pid: 50, ppid: 999999, name: "node.exe", command: CACHE_CMD_GENERIC, rssBytes: 200 * 1024 * 1024 },
      { pid: 51, ppid: 999999, name: "bun.exe", command: CACHE_CMD_DISCORD, rssBytes: 300 * 1024 * 1024 },
    ];
    const isAlive = (pid) => pid !== 999999;
    const result = await reap({ selfPid: 5, listProcs: () => procs, isAlive });
    expect(result.freedEstimateMb).toBe(500);
  });
});
