import { test, expect } from "vitest";
import { createRequire } from "module";

// Evals bill to the API credit only when run from the user's own terminal:
// a run started inside a Claude Code session counts as Claude Code usage
// (measured 2026-10-19: it drew the purchased balance, not the credit).
const require = createRequire(import.meta.url);
const { resolveApiCredit, childEnv } = require("./ab-run.js");

const fakeSafe = (enabled, key) => ({
  loadSwitches: () => ({ enabled }),
  resolveKey: () => (key ? { key, source: "file" } : null),
});

test("auto: enabled + key + own terminal → key", () => {
  expect(resolveApiCredit("auto", {}, { safe: fakeSafe(true, "sk-x") }).key).toBe("sk-x");
});

test("auto: inside a Claude Code session → plan login, with the reason", () => {
  const r = resolveApiCredit("auto", { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" }, { safe: fakeSafe(true, "sk-x") });
  expect(r.key).toBeNull();
  expect(r.note).toMatch(/own terminal/);
});

test("--api-credit inside a session is refused", () => {
  expect(resolveApiCredit("on", { CLAUDECODE: "1" }, { safe: fakeSafe(true, "sk-x") }).error).toMatch(/Claude Code session/);
});

test("--no-api-credit and a disabled switch keep the plan login", () => {
  expect(resolveApiCredit("off", {}, { safe: fakeSafe(true, "sk-x") }).key).toBeNull();
  expect(resolveApiCredit("auto", {}, { safe: fakeSafe(false, "sk-x") }).key).toBeNull();
});

test("childEnv sets the key only in the child and still strips the parent's Claude vars", () => {
  const env = childEnv({}, { CLAUDE_CODE_ENTRYPOINT: "x", ANTHROPIC_API_KEY: "parent", DEVOPS_ANTHROPIC_API_KEY: "sk-devops", PATH: "/bin" }, [], "sk-child");
  expect(env.ANTHROPIC_API_KEY).toBe("sk-child");
  expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
  expect(env.DEVOPS_ANTHROPIC_API_KEY).toBeUndefined(); // the plugin under test must not spend the credit
});
