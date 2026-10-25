import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const hook = require("./prompt.frustrated.detect.js");
const { isSessionFlagged } = require("../lib/frustration-state.js");

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompt.frustrated.detect.js");
let dir, root, opts;

function pluginRoot(minChannel) {
  const r = fs.mkdtempSync(path.join(dir, "plugin-"));
  fs.writeFileSync(path.join(r, "features.json"), JSON.stringify({ features: { "frustrated-mode": { minChannel, summary: "x", docs: [], scripts: [] } } }));
  return r;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "frus-hook-"));
  root = pluginRoot("alpha");
  opts = { features: { pluginRoot: root, channel: "alpha", home: dir }, home: dir, stateFile: path.join(dir, "state"), logFile: path.join(dir, "log"), evidence: { claimedDone: true, iterativeSkill: false } };
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const prompt = (p, extra = {}) => ({ prompt: p, session_id: "sess-1", cwd: dir, ...extra });
const loop = ["that's still wrong in app.js", "still wrong, app.js again not working", "I already said it is wrong, immer noch app.js"];

describe("prompt.frustrated.detect", () => {
  test("flags on the third bad round with the judge-yourself instruction", () => {
    expect(hook.decide(prompt(loop[0]), opts)).toBeNull();
    expect(hook.decide(prompt(loop[1]), opts)).toBeNull();
    const out = hook.decide(prompt(loop[2]), opts);
    expect(out).toBe(hook.OFFER_TEXT);
    expect(out).toMatch(/Judge from the conversation yourself/);
    expect(out).toMatch(/Read \{PLUGIN_ROOT\}\/skills\/auto-frustrated\/SKILL\.md/);
    expect(isSessionFlagged("sess-1", { file: opts.stateFile })).toBe(true);
    expect(fs.readFileSync(opts.logFile, "utf8")).toMatch(/suggest rounds=3/);
    expect(fs.readFileSync(opts.logFile, "utf8")).not.toMatch(/app\.js/);
  });

  test("never offers twice for the same episode", () => {
    loop.forEach((p) => hook.decide(prompt(p), opts));
    expect(hook.decide(prompt("still wrong again in app.js"), opts)).toBeNull();
    expect(hook.decide(prompt("immer noch falsch in app.js"), opts)).toBeNull();
  });

  test("silent on stable and beta channels, writes nothing", () => {
    for (const channel of ["stable", "beta"]) {
      const o = { ...opts, features: { pluginRoot: root, channel, home: dir } };
      loop.forEach((p) => expect(hook.decide(prompt(p), o)).toBeNull());
    }
    expect(fs.existsSync(opts.stateFile)).toBe(false);
    expect(fs.existsSync(opts.logFile)).toBe(false);
  });

  test("silent when the feature is not registered", () => {
    const empty = fs.mkdtempSync(path.join(dir, "empty-"));
    const o = { ...opts, features: { pluginRoot: empty, channel: "alpha", home: dir } };
    loop.forEach((p) => expect(hook.decide(prompt(p), o)).toBeNull());
    expect(fs.existsSync(opts.stateFile)).toBe(false);
  });

  test("frustratedMode.suggest=false silences it", () => {
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "devops-config.json"), JSON.stringify({ frustratedMode: { suggest: false } }));
    loop.forEach((p) => expect(hook.decide(prompt(p), opts)).toBeNull());
    expect(fs.existsSync(opts.stateFile)).toBe(false);
  });

  test("skips machine prompts, slash commands and subagents", () => {
    for (const h of [prompt("AUTONOMOUS_RESUME: still wrong"), prompt("<command-name>/x</command-name> still wrong"), prompt(loop[0], { agent_id: "a1" })]) {
      for (let i = 0; i < 4; i += 1) expect(hook.decide(h, opts)).toBeNull();
    }
    expect(fs.existsSync(opts.stateFile)).toBe(false);
  });

  test("transcriptEvidence reads the done-claim and iterative skill from the tail", () => {
    const f = path.join(dir, "t.jsonl");
    fs.writeFileSync(f, [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "devops:auto-concept" } }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Fixed, should work now." }] } }),
    ].join("\n"));
    expect(hook.transcriptEvidence(f)).toEqual({ claimedDone: true, iterativeSkill: true });
    expect(hook.transcriptEvidence(path.join(dir, "missing"))).toEqual({ claimedDone: false, iterativeSkill: false });
  });

  test("process entry point exits 0 silently with unusable stdin", () => {
    const r = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8", env: { ...process.env, HOME: dir, USERPROFILE: dir } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
