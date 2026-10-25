import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const { main } = require("./post.skill.overrides.js");
const { recordPath, readRecordFile } = require("../lib/skill-overrides.js");
const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "post.skill.overrides.js");

let tmp;
let home;
let project;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-skill-overrides-"));
  home = path.join(tmp, "home");
  project = path.join(tmp, "proj");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function override(text, dir = "do-ship") {
  const d = path.join(project, ".claude", "skills", dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "reference.md"), text);
}

const skill = (name, args) => ({ tool_name: "Skill", tool_input: { skill: name, args }, cwd: project, session_id: "s-post" });

describe("post.skill.overrides", () => {
  test("injects the [skill-overrides] block and records it for the card", () => {
    override("## Skip Step 3\nnot here\n");
    const reply = main(skill("devops:do-ship"), { home, dir: tmp });
    expect(reply.context.split("\n")[0]).toBe("[skill-overrides] do-ship: project reference.md");
    expect(reply.context).toContain("- SKIP Step 3 of do-ship (project override)");
    const rec = readRecordFile(recordPath("s-post", tmp));
    expect(rec.skills[0].entries[0].directives).toEqual([{ kind: "skip", step: "3" }]);
  });

  test("silent without an override file, for other tools, and for a bare user skill", () => {
    expect(main(skill("devops:do-ship"), { home, dir: tmp })).toBeNull();
    override("x", "notes");
    expect(main(skill("notes"), { home, dir: tmp })).toBeNull();
    expect(main({ tool_name: "Bash", tool_input: { command: "ls" }, cwd: project }, { home, dir: tmp })).toBeNull();
    expect(fs.existsSync(recordPath("s-post", tmp))).toBe(false);
  });

  function spawnHook(input) {
    const child = execFile(process.execPath, [HOOK], { env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: path.resolve(path.dirname(HOOK), "..", "..") } });
    const done = new Promise((resolve) => {
      let out = "";
      child.stdout.on("data", (d) => { out += d; });
      child.on("close", (code) => resolve({ out, code }));
    });
    child.stdin.end(input);
    return done;
  }

  test("end to end: the PostToolUse additionalContext envelope", async () => {
    override("## Add after Step 4\nrun e2e\n");
    const sid = `e2e-${process.pid}-${Date.now().toString(36)}`;
    const { out, code } = await spawnHook(JSON.stringify({ ...skill("devops:do-ship"), session_id: sid }));
    try { fs.unlinkSync(recordPath(sid)); } catch { /* none */ }
    expect(code).toBe(0);
    const env = JSON.parse(out);
    expect(env.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(env.hookSpecificOutput.additionalContext).toContain("- ADD after Step 4 of do-ship (project override)");
  });

  test("end to end: unusable stdin exits 0 silently", async () => {
    const { out, code } = await spawnHook("not json");
    expect(code).toBe(0);
    expect(out).toBe("");
  });
});
