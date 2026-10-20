import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "permission-audit.js");

let home;
let project;

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}

function transcript(name, cwd, tools) {
  const file = path.join(home, ".claude", "projects", "p", `${name}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = tools.map((t) => JSON.stringify({
    cwd, timestamp: new Date().toISOString(),
    message: { role: "assistant", content: [{ type: "tool_use", name: t, input: {} }] },
  }));
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

function audit(...extra) {
  const res = spawnSync(process.execPath, [SCRIPT, "--quiet", ...extra], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  expect(res.status).toBe(0);
  return JSON.parse(res.stdout);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "perm-audit-home-"));
  project = fs.mkdtempSync(path.join(os.tmpdir(), "perm-audit-proj-"));
  writeJson(path.join(home, ".claude", "settings.json"), { permissions: { allow: ["mcp__global_ns"] } });
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

describe("permission-audit merges project-scope allow lists (H2)", () => {
  test("a namespace allowed in the project's settings.json or settings.local.json is not suggested", () => {
    writeJson(path.join(project, ".claude", "settings.json"), { permissions: { allow: ["mcp__proj_ns"] } });
    writeJson(path.join(project, ".claude", "settings.local.json"), { permissions: { allow: ["mcp__local_ns__*"] } });
    transcript("s1", project, ["mcp__proj_ns__read", "mcp__local_ns__write", "mcp__global_ns__x", "mcp__other_ns__y"]);
    const rules = audit().suggestions.map((s) => s.rule);
    expect(rules).toEqual(["mcp__other_ns"]);
  });

  test("a project's allow list only covers calls made in that project", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "perm-audit-other-"));
    try {
      writeJson(path.join(project, ".claude", "settings.json"), { permissions: { allow: ["mcp__proj_ns"] } });
      transcript("s1", other, ["mcp__proj_ns__read"]);
      expect(audit().suggestions.map((s) => s.rule)).toEqual(["mcp__proj_ns"]);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test("--apply rejects a namespace the project already allows", () => {
    writeJson(path.join(project, ".claude", "settings.json"), { permissions: { allow: ["mcp__proj_ns"] } });
    transcript("s1", project, ["mcp__proj_ns__read"]);
    const out = audit("--apply=mcp__proj_ns");
    expect(out.rejected).toEqual(["mcp__proj_ns"]);
    const global = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
    expect(global.permissions.allow).toEqual(["mcp__global_ns"]);
  });

  test("an entry without cwd inherits the transcript's last seen cwd", () => {
    writeJson(path.join(project, ".claude", "settings.json"), { permissions: { allow: ["mcp__proj_ns"] } });
    const file = path.join(home, ".claude", "projects", "p", "s2.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      JSON.stringify({ type: "user", cwd: project, timestamp: new Date().toISOString() }),
      JSON.stringify({ timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "tool_use", name: "mcp__proj_ns__a", input: {} }] } }),
    ].join("\n"));
    expect(audit().suggestions).toEqual([]);
  });
});
