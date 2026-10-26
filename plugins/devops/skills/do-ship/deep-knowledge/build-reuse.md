# ship_build: green-result reuse, load signal, failure classes (#762)

## Green-result reuse

A green full-suite run is recorded as `{ treeHash, testCmd, passed, at, source, durationMs }`
in `<git common dir>/devops-test-results.json` (shared by all worktrees of the repo).
Writers: ship_build's own green test step (`source: "ship_build"`), the qa / feature
agent through `mcp-server/ship/test-record-cli.js run` (`source: "agent"`), and the
`post.test.record` hook (`source: "manual"`): a green hand-run full suite (`npm test`,
`npx vitest run`, no file filter, ending the `&&` chain, exit 0) is recorded for the current
tree automatically — `npx vitest run` is stored under the project's `npm run test` key when
`scripts.test` is itself an unfiltered `vitest run`. During a ship the `pre.test.fullguard`
hook refuses such a run ("ship_build runs the suite on this tree; a filtered run
(vitest run <files>) is fine"); inline `DEVOPS_ALLOW_FULL_SUITE=1` overrides.

`findFullGreen(cwd, { treeHash, now })` (lib/test-results.js) returns the green record of
the project's full command (`npm run test`) for exactly that tree, or null — the release
merge gate's proof of a local full run when the CI check is unavailable.

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

Before the suite starts, a live foreign lock holder or CPU ≥ 85 % busy yields
`preRunWarning: { holder, heldMs, cpuBusyPct, usualMs, eta, note }` (also on the server's
stderr; `test-record-cli.js run` prints the same note to stderr). The ETA is the usual green
duration plus "remaining time unknown, holder up for N s". No load → no field, no output.

## Scoped runs (agent loops only)

qa / feature iterate with `npx vitest related <files> --run` (`test-record-cli.js scope`) and
do one recorded full run before handoff. Scoped runs are never recorded and a different
command never matches `findGreen`. A changed file no test imports (hooks, JSON, Markdown,
`execFile`-spawned scripts) → `scope` answers `full`.

## Test scope: related locally, full suite in CI (M6)

When the repo has a CI check that runs the FULL suite (`.github/workflows/*.yml` declares a job
`suite` — dotclaude: `ci-suite.yml`, 4 shards + aggregate — and `origin` is on github.com, or
`ciSuite: true`) and the account's Actions quota is not recorded as exhausted
(`ci-quota.js readRecord(quotaKey(cwd))`), ship_build runs lint + only the tests related to the
diff vs the merge-base: `npx vitest related <changed JS/TS files + sibling .test files> --run
--passWithNoTests`. Non-JS files are not testable locally (the CI suite covers them); a docs-only
diff skips the local test step. Result:

```
testScope: "related", fullSuiteVia: "ci", relatedFiles: [...], testScopeReason
```

It falls back to the full suite (`testScope: "full"`, `fullSuiteVia: "local"`, recorded in the
store as above) when: no CI suite, `ciSuite: false`, an explicit `testCmd`, quota exhausted, the
diff cannot be computed or is empty, a file was deleted/renamed, the diff touches
package.json / lockfiles / vitest* config, or the related command line would exceed ~6000
characters. A related run is never recorded and never reused as a full run. Reusing a recorded
green full run still wins over both modes (`testsReused`, `testScope: "full"`).

The invariant: never merge without one full green suite on the exact tree — the CI `suite`
check (`fullSuiteVia: "ci"`) or `findFullGreen` (`"local"`).

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
