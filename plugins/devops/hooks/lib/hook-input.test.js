import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseHookInput, contextOutput } = require("./hook-input.js");

describe("parseHookInput", () => {
  test.each([
    ["empty", ""],
    ["whitespace", "  \r\n"],
    ["null", "null"],
    ["number", "42"],
    ["string", '"x"'],
    ["array", "[1,2]"],
    ["invalid", "{nope"],
    ["undefined input", undefined],
  ])("%s → null", (_name, raw) => {
    expect(parseHookInput(raw)).toBeNull();
  });

  test("object → object", () => {
    expect(parseHookInput('{"a":1}')).toEqual({ a: 1 });
  });

  test("BOM and CRLF are tolerated", () => {
    expect(parseHookInput('\uFEFF{\r\n"a": 1\r\n}\r\n')).toEqual({ a: 1 });
  });
});

describe("contextOutput", () => {
  test("is the one additionalContext envelope, named for the event", () => {
    expect(JSON.parse(contextOutput("PreToolUse", "hi"))).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "hi" },
    });
  });
});

// runHook owns stdin, the process streams and the exit code, so it is tested
// the way the harness runs a hook: as its own process.
describe("runHook (harden scan 2026-09-26)", () => {
  const LIB = fileURLToPath(new URL("./hook-input.js", import.meta.url));
  const run = (mainSrc, input, event = "PostToolUse") => {
    const script = `require(${JSON.stringify(LIB)}).runHook(${mainSrc}, { event: ${JSON.stringify(event)} });`;
    const r = spawnSync(process.execPath, ["-e", script], { input, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
  };
  const PAYLOAD = JSON.stringify({ tool_name: "Edit", n: 7 });

  test("{block} → the text on stderr, exit 2, nothing on stdout", () => {
    expect(run("() => ({ block: 'refused' })", PAYLOAD)).toEqual({ code: 2, stdout: "", stderr: "refused\n" });
  });

  test("{context} → the envelope for the given event on stdout, exit 0", () => {
    const r = run("(h) => ({ context: 'n=' + h.n })", PAYLOAD, "PreToolUse");
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(`${contextOutput("PreToolUse", "n=7")}\n`);
  });

  test("an empty {context} writes nothing", () => {
    expect(run("() => ({ context: '' })", PAYLOAD)).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("a string reply is written as is", () => {
    expect(run(`() => '{"continue":false}'`, PAYLOAD)).toEqual({ code: 0, stdout: '{"continue":false}', stderr: "" });
  });

  test.each([["null", "() => null"], ["undefined", "() => {}"], ["a bare number", "() => 2"]])(
    "%s → no output, exit 0",
    (_name, mainSrc) => {
      expect(run(mainSrc, PAYLOAD)).toEqual({ code: 0, stdout: "", stderr: "" });
    },
  );

  test("a throw inside main never surfaces: no output, exit 0", () => {
    expect(run("() => { throw new Error('boom'); }", PAYLOAD)).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test.each([["empty", ""], ["invalid", "not json"], ["null", "null"], ["array", "[1]"]])(
    "unusable stdin (%s) never reaches main",
    (_name, input) => {
      expect(run("() => ({ block: 'main ran' })", input)).toEqual({ code: 0, stdout: "", stderr: "" });
    },
  );

  test("a BOM-prefixed payload is parsed and handed to main", () => {
    const r = run("(h) => ({ context: h.tool_name })", `\uFEFF${PAYLOAD}`);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toBe("Edit");
  });
});
