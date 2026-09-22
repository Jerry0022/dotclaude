import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { queryDone } from "../lib/graphify-state.js";

// Spawns the real hook per test — see the timeout note in
// pre.tokens.guard.graphgate.test.js for why 30s under a full parallel run.
vi.setConfig({ testTimeout: 30_000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUERY_HOOK = path.join(__dirname, "post.graphify.query.js");
const SEARCH_HOOK = path.join(__dirname, "post.graphify.search.js");

/** A temp project (git work tree, plugin enabled) so plugin-guard lets the hook run. */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "graphq-"));
  fs.mkdirSync(path.join(dir, ".git"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  return dir;
}

function run(hook, dir, home, payload) {
  return spawnSync(process.execPath, [hook], {
    cwd: dir,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

/** Parsed events from the isolated metrics file (HOME-scoped, never the real one). */
function events(home) {
  const f = path.join(home, ".claude", "graphify-metrics.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("post.graphify.query — query detection across shells", () => {
  let dir, home;
  beforeEach(() => {
    dir = project();
    home = fs.mkdtempSync(path.join(os.tmpdir(), "graphq-home-"));
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  });
  afterEach(() => {
    for (const d of [dir, home]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  });

  test("Bash: a real `graphify query` marks the session and records query_ran with its size", () => {
    const sid = "s-bash-" + Date.now();
    const r = run(QUERY_HOOK, dir, home, {
      tool_name: "Bash", session_id: sid,
      tool_input: { command: 'graphify query "who calls foo?"' },
      tool_response: { stdout: "x".repeat(400), stderr: "" },
    });
    expect(r.status).toBe(0);
    expect(queryDone(sid, dir)).toBe(true);
    const ev = events(home).filter((e) => e.event === "query_ran");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ tool: "Bash", responseChars: 400, sid });
  });

  test("PowerShell: the Desktop-app default shell is recognised too (was Bash-only → gate never relented)", () => {
    const sid = "s-pwsh-" + Date.now();
    const r = run(QUERY_HOOK, dir, home, {
      tool_name: "PowerShell", session_id: sid,
      tool_input: { command: 'graphify query "least privilege role grants" --graph "C:\\repo\\graphify-out\\graph.json"' },
      tool_response: "Traversal: BFS depth=2 | 33 nodes found",
    });
    expect(r.status).toBe(0);
    expect(queryDone(sid, dir)).toBe(true);
    const ev = events(home).filter((e) => e.event === "query_ran");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ tool: "PowerShell", responseChars: 39 });
  });

  test("a `--budget N` flag on the query command is recorded", () => {
    const sid = "s-budget-" + Date.now();
    run(QUERY_HOOK, dir, home, {
      tool_name: "Bash", session_id: sid,
      tool_input: { command: 'graphify query "who calls foo?" --budget 400' },
      tool_response: { stdout: "x".repeat(120), stderr: "" },
    });
    const ev = events(home).filter((e) => e.event === "query_ran");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ budget: 400, responseChars: 120 });
  });

  test("no --budget flag → no budget field on the event", () => {
    const sid = "s-nobudget-" + Date.now();
    run(QUERY_HOOK, dir, home, {
      tool_name: "Bash", session_id: sid,
      tool_input: { command: 'graphify query "who calls foo?"' },
      tool_response: { stdout: "x", stderr: "" },
    });
    const ev = events(home).filter((e) => e.event === "query_ran");
    expect(ev[0].budget).toBeUndefined();
  });

  test("a command that merely MENTIONS graphify query (grep -c 'graphify query') is not a query", () => {
    const sid = "s-mention-" + Date.now();
    run(QUERY_HOOK, dir, home, {
      tool_name: "Bash", session_id: sid,
      tool_input: { command: "grep -c 'graphify query' transcript.jsonl" },
      tool_response: { stdout: "11" },
    });
    expect(queryDone(sid, dir)).toBe(false);
    expect(events(home)).toHaveLength(0);
  });

  test("other tools are ignored (exit 0, no state, no event)", () => {
    const sid = "s-other-" + Date.now();
    const r = run(QUERY_HOOK, dir, home, {
      tool_name: "Grep", session_id: sid, tool_input: { pattern: "graphify query" }, tool_response: "",
    });
    expect(r.status).toBe(0);
    expect(queryDone(sid, dir)).toBe(false);
    expect(events(home)).toHaveLength(0);
  });
});

describe("post.graphify.search — raw-search cost telemetry", () => {
  let dir, home;
  beforeEach(() => {
    dir = project();
    home = fs.mkdtempSync(path.join(os.tmpdir(), "graphs-home-"));
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  });
  afterEach(() => {
    for (const d of [dir, home]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  });

  test("a broad Grep (no path) records search_ran with broad:true and the result size", () => {
    const r = run(SEARCH_HOOK, dir, home, {
      tool_name: "Grep", session_id: "s-grep",
      tool_input: { pattern: "site_routine|least privilege", output_mode: "files_with_matches" },
      tool_response: { filenames: ["a.sql", "b.sql"], numFiles: 2 },
    });
    expect(r.status).toBe(0);
    const ev = events(home);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ event: "search_ran", tool: "Grep", broad: true, pattern: "site_routine|least privilege" });
    expect(ev[0].responseChars).toBeGreaterThan(0);
  });

  test("a path-scoped Glob records broad:false", () => {
    run(SEARCH_HOOK, dir, home, {
      tool_name: "Glob", session_id: "s-glob",
      tool_input: { pattern: "**/*.md", path: dir },
      tool_response: "docs/a.md\ndocs/b.md",
    });
    const ev = events(home);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ tool: "Glob", broad: false, responseChars: 19 });
  });

  test("records outputMode, pathKind and eligible", () => {
    const r = run(SEARCH_HOOK, dir, home, {
      tool_name: "Grep", session_id: "s-fields",
      tool_input: { pattern: "authService", output_mode: "content" },
      tool_response: "src/auth.js:1:authService",
    });
    expect(r.status).toBe(0);
    const ev = events(home);
    expect(ev[0]).toMatchObject({ outputMode: "content", pathKind: "none", eligible: true });
  });

  test("a Grep scoped to a directory records pathKind 'dir' and eligible true", () => {
    run(SEARCH_HOOK, dir, home, {
      tool_name: "Grep", session_id: "s-dir",
      tool_input: { pattern: "authService", path: dir },
      tool_response: "x",
    });
    const ev = events(home);
    expect(ev[0]).toMatchObject({ pathKind: "dir", eligible: true });
  });

  test("a Grep scoped to a file records pathKind 'file' and eligible false", () => {
    const f = path.join(dir, "a.js");
    fs.writeFileSync(f, "x");
    run(SEARCH_HOOK, dir, home, {
      tool_name: "Grep", session_id: "s-file",
      tool_input: { pattern: "authService", path: f },
      tool_response: "x",
    });
    const ev = events(home);
    expect(ev[0]).toMatchObject({ pathKind: "file", eligible: false });
  });

  test("non-search tools are ignored", () => {
    const r = run(SEARCH_HOOK, dir, home, { tool_name: "Read", session_id: "s-read", tool_input: { file_path: "x" }, tool_response: "…" });
    expect(r.status).toBe(0);
    expect(events(home)).toHaveLength(0);
  });
});
