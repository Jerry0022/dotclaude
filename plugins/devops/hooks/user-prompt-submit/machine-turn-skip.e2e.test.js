import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isNonUserPrompt } = require("../lib/non-user-prompt.js");

const APPSTART = fileURLToPath(new URL("./prompt.flow.appstart.js", import.meta.url));
const ISSUE = fileURLToPath(new URL("./prompt.issue.detect.js", import.meta.url));

/**
 * #473 / #474: task notifications and cron ticks arrive through
 * UserPromptSubmit. Neither hook may read their text as the user's words.
 */

let cwd;
let tmp;

function run(hook, prompt, session) {
  const res = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ cwd, session_id: session, prompt }),
    cwd,
    env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout || "" };
}

const NOTIFICATION =
  "<task-notification><task-id>a1</task-id><result>Red-team: PR #471 failed CI; " +
  "start the preview server again.</result></task-notification>";

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "machine-skip-e2e-"));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "machine-skip-tmp-"));
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

describe("isNonUserPrompt", () => {
  test("classifies notifications, cron ticks and scheduled tasks as machine turns", () => {
    expect(isNonUserPrompt(NOTIFICATION)).toBe(true);
    expect(isNonUserPrompt('Silently run via Bash: node "git-sync.js"')).toBe(true);
    expect(isNonUserPrompt('<scheduled-task name="x" file="y">go</scheduled-task>')).toBe(true);
    expect(isNonUserPrompt("mach Issue #12 fertig")).toBe(false);
  });
});

describe("prompt.issue.detect skips machine turns (#473)", () => {
  test("a task notification quoting #471 flips nothing to In Progress", () => {
    const r = run(ISSUE, NOTIFICATION, "issue-detect-machine");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("a user prompt with #N still asks for In Progress", () => {
    const r = run(ISSUE, "arbeite an #12 weiter", "issue-detect-user");
    expect(r.stdout).toContain("#12");
    expect(r.stdout).toContain("In Progress");
  });
});

describe("prompt.flow.appstart skips machine turns (#474)", () => {
  test("a task notification saying 'start the preview' sets no start intent", () => {
    const r = run(APPSTART, NOTIFICATION, "appstart-machine");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("a user asking to start the app still gets the card mandate", () => {
    const r = run(APPSTART, "starte die app", "appstart-user");
    expect(r.stdout).toContain("App start intent detected");
  });
});
