import { describe, test, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "post.flow.debug.js");
const SESSION = "flow-debug-e2e";
const { classify, isProbeExit, lastCommandWord } = require("./post.flow.debug.js");

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowdebug-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  fs.mkdirSync(dir + "-tmp", { recursive: true });
  return dir;
}

function cleanup(dir) {
  for (const d of [dir, dir + "-tmp"]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}

function runRaw(dir, stdin) {
  const tmp = dir + "-tmp";
  const res = spawnSync(process.execPath, [HOOK], {
    input: stdin,
    cwd: dir,
    env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function run(dir, payload) {
  return runRaw(dir, JSON.stringify({ session_id: SESSION, cwd: dir, tool_name: "Bash", ...payload }));
}

/** The real failure payload: Claude Code fires PostToolUseFailure, error = "Exit code N\n…". */
const failure = (command = "npm run build", code = 1, extra = {}) => ({
  hook_event_name: "PostToolUseFailure",
  tool_input: { command },
  tool_use_id: "t1",
  error: `Exit code ${code}\nsomething broke`,
  ...extra,
});

/** The real success payload: PostToolUse with tool_response, no exit code. */
const success = (command = "npm run build") => ({
  hook_event_name: "PostToolUse",
  tool_input: { command },
  tool_response: { stdout: "ok", stderr: "", interrupted: false, isImage: false },
});

describe("post.flow.debug — real payload shapes", () => {
  test("1st failure → no instruction yet", () => {
    const dir = project();
    try {
      expect(run(dir, failure()).stdout).toBe("");
    } finally { cleanup(dir); }
  });

  test("2nd consecutive PostToolUseFailure → mandates fix via additionalContext", () => {
    const dir = project();
    try {
      run(dir, failure());
      const r = run(dir, failure());
      const out = JSON.parse(r.stdout);
      expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUseFailure");
      expect(out.hookSpecificOutput.additionalContext).toContain("fix");
      expect(out.hookSpecificOutput.additionalContext).toContain("mandatory");
      expect(out.hookSpecificOutput.additionalContext).toContain("orchestrator");
    } finally { cleanup(dir); }
  });

  test("a PostToolUse success in between resets the counter", () => {
    const dir = project();
    try {
      run(dir, failure());
      run(dir, success());
      expect(run(dir, failure()).stdout).toBe("");
    } finally { cleanup(dir); }
  });

  test("interrupted call is neutral (neither counts nor resets)", () => {
    const dir = project();
    try {
      run(dir, failure());
      run(dir, failure("npm test", 130, { is_interrupt: true }));
      expect(run(dir, failure()).stdout).not.toBe("");
    } finally { cleanup(dir); }
  });

  test("exit 1 of grep/test/diff probes does not count", () => {
    const dir = project();
    try {
      run(dir, failure("grep -r foo src", 1));
      run(dir, failure("test -f x.txt", 1));
      expect(run(dir, failure("diff a b", 1)).stdout).toBe("");
      expect(run(dir, failure()).stdout).toBe("");
    } finally { cleanup(dir); }
  });

  test("counter is keyed per agent_id", () => {
    const dir = project();
    try {
      run(dir, failure("npm test", 1, { agent_id: "a1" }));
      expect(run(dir, failure("npm test", 1, { agent_id: "a2" })).stdout).toBe("");
      expect(run(dir, failure("npm test", 1)).stdout).toBe("");
      expect(run(dir, failure("npm test", 1, { agent_id: "a1" })).stdout).not.toBe("");
    } finally { cleanup(dir); }
  });

  test("silent when the fix skill already ran this turn", () => {
    const dir = project();
    try {
      const t = path.join(dir, "t.jsonl");
      fs.writeFileSync(t, [
        { type: "user", message: { role: "user", content: [{ type: "text", text: "build is broken" }] } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Skill", input: { skill: "devops:auto-fix" } }] } },
      ].map((l) => JSON.stringify(l)).join("\n") + "\n");
      run(dir, failure("npm run build", 1, { transcript_path: t }));
      expect(run(dir, failure("npm run build", 1, { transcript_path: t })).stdout).toBe("");
    } finally { cleanup(dir); }
  });

  test("a BARE fix (consumer extension under the old name) is not auto-fix — still mandates (R8)", () => {
    const dir = project();
    try {
      const t = path.join(dir, "t.jsonl");
      fs.writeFileSync(t, [
        { type: "user", message: { role: "user", content: [{ type: "text", text: "build is broken" }] } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Skill", input: { skill: "fix" } }] } },
      ].map((l) => JSON.stringify(l)).join("\n") + "\n");
      run(dir, failure("npm run build", 1, { transcript_path: t }));
      const out = run(dir, failure("npm run build", 1, { transcript_path: t })).stdout;
      expect(out).toContain('Skill(\\"devops:auto-fix\\")');
    } finally { cleanup(dir); }
  });

  test("PowerShell failures count as well", () => {
    const dir = project();
    try {
      run(dir, { ...failure("npm run build"), tool_name: "PowerShell" });
      expect(run(dir, { ...failure("npm run build"), tool_name: "PowerShell" }).stdout).not.toBe("");
    } finally { cleanup(dir); }
  });

  test("legacy/numeric shapes still count (tool_response.exit_code, top-level exit_code)", () => {
    const dir = project();
    try {
      run(dir, { tool_response: { exit_code: 2, stdout: "" }, tool_input: { command: "make" } });
      expect(run(dir, { exit_code: 1, tool_input: { command: "make" } }).stdout).not.toBe("");
    } finally { cleanup(dir); }
  });

  test("non-shell tool is ignored", () => {
    const dir = project();
    try {
      run(dir, { ...failure(), tool_name: "Edit" });
      expect(run(dir, { ...failure(), tool_name: "Edit" }).stdout).toBe("");
    } finally { cleanup(dir); }
  });

  test.each([
    ["empty", ""],
    ["null", "null"],
    ["string", '"x"'],
    ["array", "[1]"],
    ["invalid JSON", "{nope"],
    ["BOM + object", "\uFEFF" + JSON.stringify({ tool_name: "Bash", hook_event_name: "PostToolUse" })],
    ["CRLF object", '{\r\n"tool_name": "Bash",\r\n"hook_event_name": "PostToolUseFailure",\r\n"error": "Exit code 1"\r\n}'],
    ["tool_input not an object", JSON.stringify({ tool_name: "Bash", hook_event_name: "PostToolUseFailure", tool_input: 5, error: 7 })],
  ])("odd stdin (%s) → exit 0, no stderr", (_name, stdin) => {
    const dir = project();
    try {
      const r = runRaw(dir, stdin);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
    } finally { cleanup(dir); }
  });
});

describe("post.flow.debug — classification helpers", () => {
  test("lastCommandWord takes the last segment and strips env/prefixes", () => {
    expect(lastCommandWord("cd x && FOO=1 grep -r a .").cmd).toBe("grep");
    expect(lastCommandWord("npm test | tee log").cmd).toBe("tee");
    expect(lastCommandWord("C:\\tools\\rg.exe foo").cmd).toBe("rg");
  });

  test("probe exits are exit 1 only", () => {
    expect(isProbeExit("grep a b", 1)).toBe(true);
    expect(isProbeExit("grep a b", 2)).toBe(false);
    expect(isProbeExit("git diff --exit-code", 1)).toBe(true);
    expect(isProbeExit("git push", 1)).toBe(false);
  });

  test.each([
    ["timeout", "Command timed out after 2m 0s"],
    ["permission denial", "Permission to use Bash with command rm -rf x has been denied."],
    ["hook denial", "PreToolUse:Bash hook error: BLOCKED: Raw GitHub issue write detected"],
    ["exit code 0", "Exit code 0"],
    ["negative exit code", "Exit code -1"],
    ["no error text", undefined],
  ])("PostToolUseFailure without a real non-zero exit code (%s) is neutral (R7)", (_name, error) => {
    expect(classify({ hook_event_name: "PostToolUseFailure", error, tool_input: { command: "npm test" } })).toBe("neutral");
  });

  test("PostToolUseFailure with Exit code N ≥ 1 is a failure", () => {
    expect(classify({ hook_event_name: "PostToolUseFailure", error: "Exit code 2\nboom", tool_input: { command: "npm test" } })).toBe("fail");
    expect(classify({ hook_event_name: "PostToolUseFailure", error: "Exit code 127", tool_input: { command: "npm test" } })).toBe("fail");
  });

  test("timeouts neither count nor reset the streak (R7)", () => {
    const dir = project();
    try {
      run(dir, failure());
      run(dir, { hook_event_name: "PostToolUseFailure", tool_input: { command: "npm test" }, error: "Command timed out" });
      expect(run(dir, failure()).stdout).not.toBe("");
    } finally { cleanup(dir); }
  });

  test("PostToolUse without any exit code is a success", () => {
    expect(classify({ hook_event_name: "PostToolUse", tool_response: { stdout: "x" } })).toBe("success");
  });
});
