import os from "node:os";
import { defineConfig } from "vitest/config";

// One worker here is never one process. These suites test hooks, the bridge
// server and git-sync by SPAWNING them — a single test file can hold several
// node/python/git children alive at once, and the git-sync worlds block their
// worker inside execFileSync for 30-40s straight. Vitest's default (~cores-1
// workers) therefore oversubscribes a 12-core machine to 30+ runnable
// processes, and the one that loses the scheduler is vitest's OWN main
// process: the workers' `onTaskUpdate` RPC then times out and the run exits 1
// with "Unhandled Errors" next to 2466 passing tests. That is a red ship gate
// caused by nothing but contention — the exact noise testTimeout below was
// already raised to absorb.
//
// A third of the cores leaves room for the children each worker spawns.
// Measured on this suite (12 cores): default = intermittent exit 1 across
// every reporter; this cap = three consecutive clean runs at the same ~50s.
const HEAVY_SPAWN_WORKERS = Math.max(2, Math.ceil(os.cpus().length / 3));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["plugins/**/*.test.js"],
    maxWorkers: HEAVY_SPAWN_WORKERS,
    minWorkers: 1,
    // Hook tests spawn real node processes (that IS the contract under test —
    // the harness invokes hooks as child processes). On Windows a single spawn
    // costs 1-20s once 70+ test files compete for the machine, so vitest's 5s
    // default fails on machine load rather than on behaviour: whole suites of
    // passing tests go red with "Test timed out", and the ship's test gate
    // blocks on noise. Individual files had started pinning 30_000 by hand;
    // this makes the real budget the default for all of them.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Hook tests spawn the real SessionStart / UserPromptSubmit hooks, and the
    // budget probe inside them starts a detached usage scraper (a real Edge
    // instance) when the developer's own snapshot is past its reset. Workers
    // inherit this into every child env — the same escape hatch the
    // completion-card tests use. Suites that test the refresh itself override
    // it per call.
    env: { DEVOPS_COMPLETION_NO_USAGE: "1" },
  },
});
