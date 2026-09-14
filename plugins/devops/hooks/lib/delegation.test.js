import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MODES, readDelegation, delegationLine } = require("./delegation.js");

/**
 * The kill-switch for proactive delegation. What must hold:
 *  - no record anywhere → auto, and the line tells the user where the switch lives;
 *  - project beats global beats default; env beats all (eval runs pin it);
 *  - a record that exists but is broken resolves to `ask`, visibly — never a
 *    silent `auto` (the user reached for the switch) and never a silent `off`
 *    (a typo must not read as "the agents stopped coming");
 *  - the hooks never write the record.
 */

function dir(files = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "delegation-"));
  fs.mkdirSync(path.join(d, ".claude"));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(d, ".claude", name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return d;
}

const read = (cwd, home, env = {}) => readDelegation({ cwd, home, env });

describe("readDelegation", () => {
  test("no record anywhere → auto, and the line names the switch file", () => {
    const d = read(dir(), dir());
    expect(d).toEqual({ mode: "auto", source: "default", scope: null });
    expect(delegationLine(d)).toBe(
      '[delegation] auto (default) — tiers as in the policy. Switch: .claude/delegation.json {"mode":"auto"|"ask"|"off"} (project) or ~/.claude/delegation.json.',
    );
  });

  test("project record wins over global, global over default", () => {
    const home = dir({ "delegation.json": { mode: "ask" } });
    expect(read(dir({ "delegation.json": { mode: "off" } }), home)).toMatchObject({ mode: "off", source: "project" });
    expect(read(dir(), home)).toMatchObject({ mode: "ask", source: "global" });
    expect(delegationLine(read(dir(), home))).toMatch(/^\[delegation\] ask \(~\/\.claude\/delegation\.json\) — no proactive spawn/);
  });

  test("env beats every record; EVAL_* form for eval runs; unknown env value is ignored", () => {
    const cwd = dir({ "delegation.json": { mode: "off" } });
    expect(read(cwd, dir(), { DOTCLAUDE_DELEGATION: "auto" })).toMatchObject({ mode: "auto", source: "env" });
    expect(read(cwd, dir(), { EVAL_DOTCLAUDE_DELEGATION: "ASK" })).toMatchObject({ mode: "ask", source: "env" });
    expect(read(cwd, dir(), { DOTCLAUDE_DELEGATION: "maybe" })).toMatchObject({ mode: "off", source: "project" });
  });

  test("a broken or unknown record resolves to ask and says so", () => {
    const home = dir();
    for (const body of ["{not json", { mode: "of" }, { consent: false }, "[]"]) {
      const d = read(dir({ "delegation.json": body }), home);
      expect(d).toEqual({ mode: "ask", source: "invalid", scope: "project" });
      expect(delegationLine(d)).toContain("(.claude/delegation.json invalid → ask)");
    }
    const g = read(dir(), dir({ "delegation.json": "{" }));
    expect(g).toEqual({ mode: "ask", source: "invalid", scope: "global" });
  });

  test("off line states what still spawns; every mode has a line", () => {
    const off = delegationLine(read(dir({ "delegation.json": { mode: "off" } }), dir()));
    expect(off).toContain('only an explicit run-* skill or "with agents" in the prompt spawns');
    for (const mode of MODES) {
      expect(delegationLine({ mode, source: "env", scope: null })).toMatch(new RegExp(`^\\[delegation\\] ${mode} \\(env\\) — `));
    }
  });

  test("reading never creates a record", () => {
    const cwd = dir(), home = dir();
    read(cwd, home);
    expect(fs.existsSync(path.join(cwd, ".claude", "delegation.json"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".claude", "delegation.json"))).toBe(false);
  });
});
