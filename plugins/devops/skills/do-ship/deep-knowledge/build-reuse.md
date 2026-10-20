# ship_build: green-result reuse, load signal, failure classes (#762)

## Green-result reuse

A green full-suite run is recorded as `{ treeHash, testCmd, passed, at, source, durationMs }`
in `<git common dir>/devops-test-results.json` (shared by all worktrees of the repo).
Writers: ship_build's own green test step (`source: "ship_build"`) and the qa / feature
agent through `mcp-server/ship/test-record-cli.js run` (`source: "agent"`).

**Tree key** — the git tree the working tree would commit to: `HEAD^{tree}` when
`git status --porcelain` is empty, otherwise `git write-tree` over a throwaway copy of the
index after `git add -A` (the real index is never touched). Staged, unstaged and untracked
non-ignored files count; git-ignored files (node_modules, runtime state) do not. A run is
recorded only when the key before and after the run is the same.

ship_build skips the test step when the key computed after the generators, build and lint
matches a green record of the same test command (`npm test` = `npm t` = `npm run test`)
younger than 24 h. The result then carries:

```
testsReused: { treeHash, at, source, testCmd }
steps[test]: { success: true, reused: true, output: "reused green run …" }
```

Say so on the card ("tests: reused green run from <at>"). `reuseGreen: false` forces a run.
A generator that rewrites tracked files (README roster, INDEX.md) changes the key, so the
suite runs again — commit regenerated files before the agent's run to keep the reuse.

## Load signal

`load` is returned when the test step waited ≥ 5 s on the machine-wide test lock
(vitest.suite-lock.mjs), found it held at start, ran more than 2x (and 30 s over) the usual
green duration net of the wait, or saw ≥ 85 % CPU busy before start:

```
load: { lockWaitMs, lockGaveUp, holder: { pid, cwd } | null, cpuBusyPct, loadAvg1, cores,
        durationMs, usualMs, slow, note }
```

Relay `load.note` to the user — it is the "why did this take so long" answer.

## Red test step

- An EPERM / EBUSY / ENOTEMPTY on a temp or cleanup path triggers one retry
  (`steps[test].retried: { reason, firstOutput, secondPassed }`).
- `failureKind`: `"environment"` when that pattern is present and no test failed by name,
  otherwise `"test"`. Environment failures are the machine, not the change — re-run later or
  on a quieter machine instead of debugging the code.
- `failingTests`: every failing test name from vitest's ` FAIL  file > suite > test` summary
  (fallback: inline `×` lines), never truncated. The step `output` keeps the last 4000
  characters of stdout + stderr.
- Harness stops (`failure: "timeout" | "output-overflow"`) carry neither field.
