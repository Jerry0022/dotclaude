import { describe, test, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HOOK = path.join(import.meta.dirname, "post.test.record.js");
const { main } = require("./post.test.record.js");
const { main: guard, MESSAGE } = require("../pre-tool-use/pre.test.fullguard.js");
const { containsFullSuite, trailingFullSuite } = require("../lib/full-suite-cmd.js");

const bash = (command, extra = {}) => ({ tool_name: "Bash", cwd: "/repo", tool_input: { command }, tool_response: { stdout: "ok" }, ...extra });

describe("full-suite-cmd", () => {
  test.each(["npm test", "npm run test", "npm t", "npx vitest run", "vitest run --reporter=dot", "cd x && npm test", "npm test -- --reporter=dot"])(
    "full: %s", (c) => expect(containsFullSuite(c)).toBe(true));
  test.each(["npm test -- a.test.js", "npx vitest run a.test.js", "npx vitest related a.js --run", "npx vitest", "echo \"npm test\"", "npm run lint", "node x.js run"])(
    "not full: %s", (c) => expect(containsFullSuite(c)).toBe(false));
  test("trailingFullSuite needs the suite to end a pure && chain", () => {
    expect(trailingFullSuite("git pull && npm test")).toMatchObject({ segment: "npm test" });
    expect(trailingFullSuite("npm test && git commit")).toBeNull();
    expect(trailingFullSuite("npm test || true")).toBeNull();
    expect(trailingFullSuite("npm test; echo hi")).toBeNull();
    expect(trailingFullSuite("npm test | tail -5")).toBeNull();
    expect(trailingFullSuite("cd sub && npx vitest run")).toMatchObject({ cdTo: "sub" });
  });
});

describe("post.test.record main", () => {
  const spawned = [];
  const spawn = (...a) => { spawned.push(a); return { status: 0 }; };

  test("hands a green full run to the recorder", () => {
    spawned.length = 0;
    expect(main(bash("npm test"), { spawn })).toMatchObject({ cmd: "npm test" });
    expect(spawned).toHaveLength(1);
    expect(spawned[0][1]).toEqual(expect.arrayContaining(["record-now", "--cwd", "/repo", "--cmd", "npm test"]));
  });

  test.each([
    ["filtered run", bash("npx vitest run a.test.js")],
    ["non-zero exit code", bash("npm test", { tool_response: { exit_code: 1 } })],
    ["interrupted", bash("npm test", { tool_response: { interrupted: true } })],
    ["suite not last", bash("npm test && git commit -m x")],
    ["swallowed failure", bash("npm test || true")],
    ["other tool", { tool_name: "Edit", tool_input: { command: "npm test" } }],
  ])("records nothing: %s", (_n, hook) => {
    spawned.length = 0;
    expect(main(hook, { spawn })).toBeNull();
    expect(spawned).toHaveLength(0);
  });
});

describe("post.test.record e2e", () => {
  test("a green `npm test` lands in the store as a full-suite record for the tree", () => {
    const d = mkdtempSync(path.join(tmpdir(), "rec-hook-"));
    try {
      const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, windowsHide: true, encoding: "utf8" });
      git("init", "-q", "-b", "main");
      mkdirSync(path.join(d, ".claude"), { recursive: true });
      writeFileSync(path.join(d, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
      writeFileSync(path.join(d, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
      git("add", "-A");
      git("commit", "-q", "-m", "x");
      const store = path.join(d, "store.json");
      const env = { ...process.env, DEVOPS_TEST_RESULTS_FILE: store };
      delete env.CLAUDE_PLUGIN_ROOT;
      const r = spawnSync(process.execPath, [HOOK], { cwd: d, env, encoding: "utf8", windowsHide: true, input: JSON.stringify(bash("npx vitest run", { cwd: d })) });
      expect(r.status).toBe(0);
      const rec = JSON.parse(readFileSync(store, "utf8")).records;
      expect(rec).toHaveLength(1);
      expect(rec[0]).toMatchObject({ testCmd: "npm run test", passed: true, source: "manual" });
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("pre.test.fullguard", () => {
  const active = { isActive: () => true };
  const idle = { isActive: () => false };

  test("blocks a full suite during a ship, with the documented message", () => {
    for (const c of ["npm test", "npm run test", "npx vitest run", "cd x && npm test"]) {
      expect(guard(bash(c), active)).toEqual({ block: MESSAGE });
    }
    expect(MESSAGE).toContain("ship_build runs the suite on this tree; a filtered run (vitest run <files>) is fine");
  });

  test("filtered runs pass during a ship", () => {
    for (const c of ["npx vitest run a.test.js b.test.js", "npx vitest related a.js --run", "npm test -- a.test.js", "npm run lint"]) {
      expect(guard(bash(c), active)).toBeNull();
    }
  });

  test("everything passes outside a ship, for other tools, and with the override", () => {
    expect(guard(bash("npm test"), idle)).toBeNull();
    expect(guard({ tool_name: "Read", tool_input: { command: "npm test" } }, active)).toBeNull();
    expect(guard(bash("DEVOPS_ALLOW_FULL_SUITE=1 npm test"), active)).toBeNull();
  });

  test("e2e: exits 2 with the message while the sentinel exists", () => {
    const d = mkdtempSync(path.join(tmpdir(), "guard-hook-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: d, windowsHide: true });
      mkdirSync(path.join(d, ".claude"), { recursive: true });
      writeFileSync(path.join(d, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
      const run = () => spawnSync(process.execPath, [path.join(import.meta.dirname, "..", "pre-tool-use", "pre.test.fullguard.js")],
        { cwd: d, encoding: "utf8", windowsHide: true, input: JSON.stringify({ tool_name: "Bash", cwd: d, tool_input: { command: "npm test" } }),
          env: { ...process.env, DEVOPS_ALLOW_FULL_SUITE: "" } });
      expect(run().status).toBe(0);
      writeFileSync(path.join(d, ".claude", ".ship-in-progress"), JSON.stringify({ ts: Date.now(), pid: 1 }));
      const blocked = run();
      expect(blocked.status).toBe(2);
      expect(blocked.stderr).toContain("ship_build runs the suite on this tree");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
