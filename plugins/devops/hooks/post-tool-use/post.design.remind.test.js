import { describe, test, expect, vi, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Spawns the real hook; see post.flow.completion.test.js for why the timeout
// is generous under a full parallel run.
vi.setConfig({ testTimeout: 30_000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "post.design.remind.js");

const projects = [];
afterAll(() => {
  for (const dir of projects) fs.rmSync(dir, { recursive: true, force: true });
});

// Builds a temp project whose settings enable the plugin (plugin-guard) and
// carries its own private tmpdir, so the once-per-session marker file this
// hook writes to os.tmpdir() cannot collide with any other parallel test.
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "design-remind-"));
  projects.push(dir);
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".home"), { recursive: true });
  return dir;
}

let sidCounter = 0;
function nextSid() {
  sidCounter += 1;
  return `s-design-remind-${process.pid}-${sidCounter}`;
}

function runHook(dir, { toolName = "Write", filePath, sessionId } = {}) {
  const tmp = path.join(dir, ".tmp");
  const home = path.join(dir, ".home");
  for (let attempt = 0; ; attempt++) {
    const res = spawnSync(process.execPath, [HOOK], {
      cwd: dir,
      input: JSON.stringify({
        tool_name: toolName,
        tool_input: { file_path: filePath },
        session_id: sessionId,
        cwd: dir,
      }),
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, HOME: home, USERPROFILE: home },
    });
    if (res.status !== null || attempt >= 3) {
      if (res.status === null) {
        throw new Error(`hook never started after ${attempt + 1} attempts: ${res.error}`);
      }
      return res;
    }
  }
}

function writeOverride(dir, body) {
  const refDir = path.join(dir, ".claude", "skills", "tune-polish");
  fs.mkdirSync(refDir, { recursive: true });
  fs.writeFileSync(path.join(refDir, "reference.md"), `## UI rules\n${body}\n`);
}

describe("post.design.remind (hook)", () => {
  test("non-UI file produces no reminder", () => {
    const dir = project();
    const res = runHook(dir, {
      filePath: path.join(dir, "src", "service.ts"),
      sessionId: nextSid(),
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  test("UI file produces the reminder with R1..R4", () => {
    const dir = project();
    const res = runHook(dir, {
      filePath: path.join(dir, "src", "App.tsx"),
      sessionId: nextSid(),
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[ui-defaults]");
    expect(res.stdout).toContain("R1");
    expect(res.stdout).toContain("R2a");
    expect(res.stdout).toContain("R2b");
    expect(res.stdout).toContain("R3");
    expect(res.stdout).toContain("R4");
  });

  test("fires once per session, and again in a different session", () => {
    const dir = project();
    const sid = nextSid();
    const first = runHook(dir, { filePath: path.join(dir, "src", "Second.jsx"), sessionId: sid });
    expect(first.stdout).toContain("[ui-defaults]");

    const second = runHook(dir, { filePath: path.join(dir, "src", "Second.jsx"), sessionId: sid });
    expect(second.stdout).toBe("");

    const otherSid = nextSid();
    const third = runHook(dir, { filePath: path.join(dir, "src", "Second.jsx"), sessionId: otherSid });
    expect(third.stdout).toContain("[ui-defaults]");
  });

  test("project override disables rules, keeps a free-form bullet, and widens detection via files:", () => {
    const dir = project();
    writeOverride(
      dir,
      "- disable: R2b, R4\n" +
      "- files: .ts\n" +
      "- Icon-only buttons in the title bar are exempt from R1 (platform chrome)."
    );

    const res = runHook(dir, {
      filePath: path.join(dir, "src", "thing.ts"),
      sessionId: nextSid(),
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[ui-defaults]");
    expect(res.stdout).toContain("R1 ");
    expect(res.stdout).toContain("R2a ");
    expect(res.stdout).not.toMatch(/\bR2b\b .*/);
    expect(res.stdout).not.toContain("R2b uniform");
    expect(res.stdout).not.toContain("R4 every");
    expect(res.stdout).toContain("disabled by project override: R2b, R4");
    expect(res.stdout).toContain("Icon-only buttons in the title bar are exempt from R1 (platform chrome).");
  });

  test("excludes concept pages and plugin source markdown", () => {
    const dir = project();
    const conceptRes = runHook(dir, {
      filePath: path.join(dir, "docs", "concepts", "x.html"),
      sessionId: nextSid(),
    });
    expect(conceptRes.stdout).toBe("");

    const skillRes = runHook(dir, {
      filePath: path.join(dir, "plugins", "devops", "skills", "foo", "SKILL.md"),
      sessionId: nextSid(),
    });
    expect(skillRes.stdout).toBe("");
  });

  test("Bash tool produces no reminder", () => {
    const dir = project();
    const res = runHook(dir, { toolName: "Bash", filePath: undefined, sessionId: nextSid() });
    expect(res.stdout).toBe("");
  });
});
