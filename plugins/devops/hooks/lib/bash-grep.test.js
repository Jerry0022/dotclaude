import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const { parseBashGrep } = createRequire(import.meta.url)("./bash-grep.js");

describe("parseBashGrep", () => {
  test.each([
    ["grep -rn authService .", { pattern: "authService", path: ".", tool: "grep" }],
    ["grep -r 'auth service' src", { pattern: "auth service", path: "src", tool: "grep" }],
    ["grep -R --include=*.js -e renderCard", { pattern: "renderCard", path: undefined, tool: "grep" }],
    ["rg -n renderCard hooks", { pattern: "renderCard", path: "hooks", tool: "rg" }],
    ["rg -t js renderCard", { pattern: "renderCard", path: undefined, tool: "rg" }],
    ["git grep -n renderCard", { pattern: "renderCard", path: undefined, tool: "git grep" }],
    ["grep -rn renderCard . 2>/dev/null | head -20", { pattern: "renderCard", path: ".", tool: "grep" }],
    ['grep -rn "a \\"b\\"" .', { pattern: 'a "b"', path: ".", tool: "grep" }],
  ])("%s", (cmd, want) => {
    expect(parseBashGrep(cmd)).toEqual(want);
  });

  test.each([
    "grep foo file.txt",               // not recursive
    "grep -rn foo . | sort",           // other pipe
    "grep -rn foo . && echo done",     // chained
    "grep -rn $(cat x) .",             // substitution
    "grep -rn foo a b",                // two paths
    "cat file | grep foo",             // not a grep head
    "grep -rn 'unterminated .",        // broken quote
    "",
  ])("null for %s", (cmd) => {
    expect(parseBashGrep(cmd)).toBeNull();
  });
});
