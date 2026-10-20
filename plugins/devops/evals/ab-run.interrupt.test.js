import { test, expect } from "vitest";
import { createRequire } from "module";

// The run loop is synchronous, so Ctrl-C is detected from the child's exit,
// not from a SIGINT listener (that only fires after the loop).
const require = createRequire(import.meta.url);
const { wasInterrupted } = require("./ab-run.js");

test("child killed by SIGINT / SIGTERM → abort", () => {
  expect(wasInterrupted({ exitCode: null, signal: "SIGINT" })).toBe(true);
  expect(wasInterrupted({ exitCode: null, signal: "SIGTERM" })).toBe(true);
});

test("exit 130 and Windows STATUS_CONTROL_C_EXIT → abort", () => {
  expect(wasInterrupted({ exitCode: 130, signal: null })).toBe(true);
  expect(wasInterrupted({ exitCode: 3221225786, signal: null })).toBe(true);
  expect(wasInterrupted({ exitCode: -1073741510, signal: null })).toBe(true);
});

test("normal success, failure and timeout keep the loop going", () => {
  expect(wasInterrupted({ exitCode: 0, signal: null })).toBe(false);
  expect(wasInterrupted({ exitCode: 1, signal: null })).toBe(false);
  // --timeout-min kills with spawnSync's default SIGTERM — recorded, not an abort.
  expect(wasInterrupted({ exitCode: null, signal: "SIGTERM", timedOut: true })).toBe(false);
  expect(wasInterrupted({ exitCode: null, signal: null })).toBe(false);
  expect(wasInterrupted(null)).toBe(false);
});
