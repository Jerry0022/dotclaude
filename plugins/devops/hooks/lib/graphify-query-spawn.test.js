import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnGraphifySync, quoteForCmdExe } from "./graphify-query-spawn.js";

// A real, directly-executable stub: node.exe itself is a native binary, so
// `spawnGraphifySync(process.execPath, [ECHO_SCRIPT, ...args])` exercises the
// TRUE shell:false primary path on every platform — unlike a `.cmd`/`.bat`
// file, which forces the ENOENT-shell fallback on Windows and is tested
// separately below.
let dir, ECHO_SCRIPT, MARKER;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gqspawn-"));
  ECHO_SCRIPT = path.join(dir, "echo-argv.js");
  fs.writeFileSync(ECHO_SCRIPT, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  MARKER = path.join(dir, "marker");
});
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("spawnGraphifySync — shell:false primary path (real executable)", () => {
  test("every argv element — including one containing a space and one containing shell metacharacters — survives as ONE element", () => {
    const args = ["query", "authService userRepo", "--budget", "400", "--graph", "C:\\a path\\graph.json", "&echo PWNED>marker&"];
    const res = spawnGraphifySync(process.execPath, [ECHO_SCRIPT, ...args], { encoding: "utf8" });
    expect(res.error).toBeFalsy();
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual(args);
  });

  test("shell metacharacters in an argument never reach a shell — no injected side effect", () => {
    try { fs.unlinkSync(MARKER); } catch { /* absent already */ }
    const res = spawnGraphifySync(process.execPath, [ECHO_SCRIPT, "&echo PWNED>" + MARKER + "&"], { encoding: "utf8" });
    expect(res.error).toBeFalsy();
    expect(fs.existsSync(MARKER)).toBe(false);
  });

  test("a real spawn error (nonexistent binary) reports on .error, never throws", () => {
    const res = spawnGraphifySync(path.join(dir, "does-not-exist-binary"), ["x"], { encoding: "utf8" });
    expect(res.error).toBeTruthy();
  });
});

describe("quoteForCmdExe", () => {
  test("wraps in double quotes", () => {
    expect(quoteForCmdExe("authService")).toBe('"authService"');
  });

  test("escapes an embedded double quote", () => {
    expect(quoteForCmdExe('say "hi"')).toBe('"say \\"hi\\""');
  });

  test("a space stays inside the quoted span (one shell token)", () => {
    expect(quoteForCmdExe("two words")).toBe('"two words"');
  });
});

// The ENOENT-shell fallback only ever engages for an explicit `.cmd`/`.bat`
// override on win32 — the real `graphify` binary is a `.exe`, so this path
// never activates in production. It IS activated by test stubs that are
// `.cmd` files (see pre.tokens.guard.graphgate.test.js), which is a feature:
// it proves the fallback's strict quoting neutralises shell metacharacters
// too, not just the primary shell:false path.
describe("spawnGraphifySync — ENOENT shell fallback (explicit .cmd/.bat only)", () => {
  test("a non-.cmd/.bat binary that genuinely does not exist never falls back to a shell", () => {
    const res = spawnGraphifySync(path.join(dir, "nope.exe"), ["x"], { encoding: "utf8" });
    expect(res.error).toBeTruthy();
    // No shell means no shell-specific error shape (e.g. no `.signal` from a
    // cmd.exe wrapper) — the direct ENOENT from the failed exec passes through.
    expect(res.error.code).toBe("ENOENT");
  });

  if (process.platform === "win32") {
    test("a .cmd stub receives shell-metacharacter args safely quoted, one element intact", () => {
      const stub = path.join(dir, "argv-echo.cmd");
      // Emits one JSON-ish line per arg via a tiny inline node call, quoting
      // %* is unreliable for exact argv reconstruction in batch, so this
      // stub instead proves the concrete injection property directly: it
      // only ever creates MARKER2 if cmd.exe actually parsed `&`/`>` as
      // command separators/redirection rather than literal text.
      const marker2 = path.join(dir, "marker2");
      fs.writeFileSync(stub, "@echo off\r\necho ran: %*\r\n");
      try { fs.unlinkSync(marker2); } catch { /* absent */ }
      const res = spawnGraphifySync(stub, ["query", `&echo PWNED>${marker2}&`], { encoding: "utf8" });
      expect(res.error).toBeFalsy();
      expect(fs.existsSync(marker2)).toBe(false);
      expect(res.stdout).toContain("ran:");
    });
  }
});
