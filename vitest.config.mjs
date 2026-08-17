import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["plugins/**/*.test.js"],
    // Hook tests spawn real node processes (that IS the contract under test —
    // the harness invokes hooks as child processes). On Windows a single spawn
    // costs 1-20s once 70+ test files compete for the machine, so vitest's 5s
    // default fails on machine load rather than on behaviour: whole suites of
    // passing tests go red with "Test timed out", and the ship's test gate
    // blocks on noise. Individual files had started pinning 30_000 by hand;
    // this makes the real budget the default for all of them.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
