import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseHookInput } = require("./hook-input.js");

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
