import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../lib/strict-state.js";

const HOOK = fileURLToPath(new URL("./stop.strict.release.js", import.meta.url));

let cwd;

function runHook(payload = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, session_id: "sess-1", stop_hook_active: false, ...payload }),
    cwd,
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "strict-stop-"));
  fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }),
    "utf8",
  );
});

afterEach(() => {
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

test("no mode → silent", () => {
  const r = runHook();
  expect(r.code).toBe(0);
  expect(r.stderr).toBe("");
});

test("inline with no workflow → released", () => {
  S.activate(cwd, { reason: "inline", branch: null });
  expect(runHook().code).toBe(0);
  expect(S.readMode(cwd)).toBeNull();
});

test("inline while a concept session is open → bound to it", () => {
  S.activate(cwd, { reason: "inline", branch: null });
  fs.writeFileSync(path.join(cwd, ".claude", "concept-active.json"), "{}");
  const r = runHook();
  expect(r.stderr).toContain("concept");
  expect(S.readMode(cwd)).toMatchObject({ reason: "concept", boundTo: path.join(".claude", "concept-active.json") });
});

test("inline during an autonomous lockout → bound to it", () => {
  S.activate(cwd, { reason: "inline", branch: null });
  fs.writeFileSync(path.join(cwd, "AUTONOMOUS-LOCKOUT.flag"), "{}");
  runHook();
  expect(S.readMode(cwd)).toMatchObject({ reason: "autonomous", boundTo: "AUTONOMOUS-LOCKOUT.flag" });
});

test("bound mode whose file is gone → released", () => {
  S.activate(cwd, { reason: "inline", branch: null });
  fs.writeFileSync(path.join(cwd, ".claude", "concept-active.json"), "{}");
  runHook();
  fs.unlinkSync(path.join(cwd, ".claude", "concept-active.json"));
  const r = runHook();
  expect(r.stderr).toContain("released");
  expect(S.readMode(cwd)).toBeNull();
});

test("bound mode whose file still exists → kept", () => {
  S.activate(cwd, { reason: "inline", branch: null });
  fs.writeFileSync(path.join(cwd, ".claude", "concept-active.json"), "{}");
  runHook();
  runHook();
  expect(S.readMode(cwd)).toMatchObject({ reason: "concept" });
});

test("branch mode is never touched", () => {
  S.activate(cwd, { reason: "on", branch: null });
  const r = runHook();
  expect(r.stderr).toBe("");
  expect(S.readMode(cwd)).toMatchObject({ reason: "on" });
});

test("never blocks the stop (no JSON decision on stdout)", () => {
  S.activate(cwd, { reason: "inline", branch: null });
  expect(runHook().stdout).toBe("");
});
