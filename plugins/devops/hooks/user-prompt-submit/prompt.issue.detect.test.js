import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("./prompt.issue.detect.js", import.meta.url));

/**
 * 2026-09-26: a task-chip prompt quoted "[issue-status] Tracked issues this
 * session: #530, #409, #431, #469" as an example; the hook tracked all four,
 * asked for In Progress, and every card of the session asked for Done/Todo
 * plus a comment on each. Only a request to work on an issue is tracked now.
 */

let cwd;
let tmp;

function run(prompt, session) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, session_id: session, prompt }),
    cwd,
    env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout || "" };
}

function stateList(prefix, session) {
  try { return JSON.parse(fs.readFileSync(path.join(tmp, `${prefix}-${session}`), "utf8")); }
  catch { return null; }
}
const tracked = (session) => stateList("dotclaude-devops-tracked-issues", session);
const asked = (session) => stateList("dotclaude-devops-asked-issues", session);

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "issue-detect-e2e-"));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "issue-detect-tmp-"));
  fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }),
  );
  execFileSync("git", ["init", "-q"], { cwd });
});

afterEach(() => {
  for (const d of [cwd, tmp]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

describe("prompt.issue.detect — quoted or example numbers are no reference", () => {
  test("numbers quoted as an example are neither tracked nor asked about", () => {
    const prompt =
      "A prompt that described a bug and quoted issue numbers as an EXAMPLE " +
      "(\"… got '[issue-status] Tracked issues this session: #530, #409, #431, #469'\") " +
      "was treated as work on those issues. Reports are excluded already (#473).";
    const r = run(prompt, "detect-quoted");
    expect(r.code).toBe(0);
    expect(tracked("detect-quoted")).toBeNull();
    expect(asked("detect-quoted")).toBeNull();
    expect(r.stdout).not.toMatch(/#\d/);
    expect(r.stdout).not.toContain("asked to work on");
  });

  test("a pasted hook line is no reference either", () => {
    const r = run("UserPromptSubmit hook success: User explicitly referenced issue #530.\nWoher kommt das?", "detect-log");
    expect(tracked("detect-log")).toBeNull();
    expect(r.stdout).not.toMatch(/#\d/);
  });

  // 2026-09-26: this kind of prompt put issues #7 and #8 In Progress, and the
  // session's cards then asked for Done/Todo plus a comment on both.
  test("hex colours in a prompt are neither tracked nor asked about", () => {
    const prompt =
      "#7d84a8 is the dim watermark: the pipeline line keeps it when every step is ✓.\n" +
      "The palette (green #8fae8f, red #e0a0a0, yellow #d9c58a) has no light counterpart; " +
      "color:#123456 and #000080 are colours too.";
    const r = run(prompt, "detect-hex");
    expect(r.code).toBe(0);
    expect(tracked("detect-hex")).toBeNull();
    expect(asked("detect-hex")).toBeNull();
    expect(r.stdout).not.toMatch(/#\d/);
  });
});

describe("prompt.issue.detect — a request to work on an issue is tracked", () => {
  test('a plain "fix #12" is still tracked and set In Progress', () => {
    const r = run("fix #12", "detect-fix");
    expect(r.code).toBe(0);
    expect(tracked("detect-fix")).toEqual(["12"]);
    expect(r.stdout).toContain("User asked to work on issue #12");
    expect(r.stdout).toContain('"In Progress"');
  });

  test("a tracked issue is not announced twice", () => {
    run("mach #12", "detect-twice");
    const again = run("arbeite an #12 weiter", "detect-twice");
    expect(again.stdout).toBe("");
    expect(tracked("detect-twice")).toEqual(["12"]);
  });
});

describe("prompt.issue.detect — a number only mentioned is asked about", () => {
  test("asks once, tracks nothing", () => {
    const first = run("Der Bug aus #12 ist zurück", "detect-mention");
    expect(first.stdout).toContain('"Arbeitest du an Issue #12?"');
    expect(first.stdout).not.toContain("asked to work on");
    expect(tracked("detect-mention")).toBeNull();
    expect(asked("detect-mention")).toEqual(["12"]);

    const again = run("Der Bug aus #12 ist immer noch da", "detect-mention");
    expect(again.stdout).toBe("");
  });

  test("a later request tracks the issue that was only asked about", () => {
    run("Der Bug aus #12 ist zurück", "detect-mention-then-fix");
    const r = run("ok, fix #12", "detect-mention-then-fix");
    expect(r.stdout).toContain("User asked to work on issue #12");
    expect(tracked("detect-mention-then-fix")).toEqual(["12"]);
  });
});
