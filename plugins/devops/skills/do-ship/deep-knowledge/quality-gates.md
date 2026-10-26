# Quality Gates

Run during Step 2 of the ship flow.

## Build

Run the project's build command. Default: `npm run build`.
Project extensions can override with custom commands.

If build fails → Completion Card Variant 4 (Blocked). Do not continue.

## Lint

Run `npm run lint` (or project-specific linter). If available and configured.
Lint failures → fix before proceeding.

## Tests

### Task-specific tests (default)

Run only tests related to the shipped changes:
- Target the specific test file for the changed module
- Example: `npm run test:unit -- --grep "pattern"`

### Full suite (only when needed)

Run the full test suite only if:
- Build-ID changed since last full run (source code changed)
- No prior full run in this session

### Test deduplication

If the full suite already passed on the **same build-ID** earlier in the
session → skip. Log: `Tests skipped — already passed on build <hash>`.

### Full suite: CI check first, local fallback on quota exhaustion

Hard invariant: **never merge without one full green suite on the exact tree** —
either the CI `suite` check (`.github/workflows/ci-suite.yml`: 4 `suite (shard N/4)`
jobs + the aggregate `suite`) or a local full run recorded for that tree.

- CI suite declared + Actions quota not exhausted: `ship_build` runs lint + only the
  tests related to the diff and returns `testScope: "related"`, `fullSuiteVia: "ci"`;
  the PR's `suite` check is the full-suite gate.
- No CI suite, quota exhausted (GitHub Actions minutes ran out — it happens regularly),
  or the diff touches package.json / lockfiles / vitest config: `ship_build` runs the full
  suite locally (`testScope: "full"`, `fullSuiteVia: "local"`) and records it.
- If the `suite` check never ran or failed because of an account limit, a related-only
  build is not enough: the merge needs `findFullGreen(cwd, { treeHash })` for HEAD's tree
  (lib/test-results.js); without a record, run the full suite locally first.

Details and result fields: [build-reuse.md](build-reuse.md) § Test scope.

### Step time limit

`ship_build` stops each step (build, lint, test) after `stepTimeoutSec`
(default **300 s**, 30–1800). A stopped step fails with `failure: "timeout"`
and the result carries `timeoutHit: { step, limitSec, note }` — a harness stop,
not a red test. Re-run with a higher `stepTimeoutSec`, or run the full suite
separately and pass a narrower `testCmd`; name the limit on the card.

## Deploy-Parity Build (Step 2.5)

The gates above run in the warm working copy. The deploy host does not: it
clones fresh, installs from the lockfile and runs its own build command with
the npm `pre`/`post` hooks. Step 2.5 repeats exactly that in a temporary clean
worktree (`scripts/deploy-parity.js`) and blocks on `failed`; `inconclusive`
(missing host secrets, missing tool, time budget) and `skipped` only add a card
line. Reference: `{PLUGIN_ROOT}/deep-knowledge/deploy-parity.md`.

## Pre-Merge CI Checks Gate

After the PR is created (or reused) and before the merge, `ship_release`
calls `gh pr checks --watch --fail-fast` on the PR number. Default timeout:
**600s** (10 min), configurable via `checksTimeoutSec`.

Outcomes:
- **all green** → merge proceeds. Result includes `checks: { status: "passed", passed: N }`.
- **no checks configured** → silent skip (e.g. new repos without CI). `checks: { status: "no-checks" }`.
- **at least one failure** → `success: false`, `checksBlocked: true`, `failedChecks: [...]`. PR stays open, branch not deleted. Skill → ship-blocked card.
- **timeout** → `success: false`, `checksBlocked: true`. PR stays open. Skill → ship-blocked card with retry hint.

### Bypass (hot-fix only)

Two ways to skip the gate when CI itself is broken and a hot-fix must land:

1. Pass `skipChecks: true` to `ship_release`.
2. Set `DEVOPS_SHIP_SKIP_CHECKS=1` in the environment.

Either path records `checks: { status: "skipped", reason: "..." }` in the result
so the completion card can flag the bypass.

## Build-ID

After a successful build, generate the build-ID:

```bash
node {PLUGIN_ROOT}/scripts/build-id.js
```

This is a content hash over source files (excludes config, docs, build
artifacts). Same source = same hash. Used for:
- Test deduplication
- Completion card title
- Build log entry

## Early CI-quota probe (before the test scope is chosen)

Exhausted GitHub Actions minutes are detected up front, not after a 10-minute
wait. `lib/ci-quota-probe.js` (`probeCiQuota`) runs as the first stage of
`ship_run` after preflight, before `ship_build` picks its test scope:

- It reads the repo's newest workflow runs (`actions/runs?per_page=5`), their
  jobs and each failed job's annotations, and classifies them with the same
  markers `ship_release` uses after the wait (`ci-account-limits.js`
  `LIMIT_PATTERNS`, kind `actions-minutes`: "job was not started because",
  spending limit, failed account payments, billing lock).
- **exhausted** → `recordBlock` in the shared CI-quota store
  (`~/.claude/devops-ci-quota.json`). `ship_build` then runs the FULL local
  suite (`testScope: "full"`, `fullSuiteVia: "local"`), and `ship_release`
  does not sit in the CI watch (see release-results.md § Account-limited CI).
- **healthy** → a run that started normally. When it is newer than a recorded
  block, the block is cleared: CI comes back on its own (the monthly reset in
  `ci-quota.js` still applies too).
- **unknown** → `gh` missing, offline, no runs, any API error: never a block.
- The verdict is cached 10 minutes per account (`readProbe` / `writeProbe`).
  `DEVOPS_CI_QUOTA_PROBE=0` switches the probe off.
- **Early-push re-probe.** When the build ran related-only tests
  (`fullSuiteVia: "ci"`) and preflight opened the early draft PR, `ship_run`
  probes again (cache bypassed, that branch's runs only). If the draft PR's
  first runs came back billing-blocked, the block is recorded and the build
  reruns as the full local suite before release.
- The billing endpoint is not used: it needs a user-scoped token and cannot
  see spending limits, so run evidence is the only reliable signal.

## Full-suite invariant at the merge

Never a merge without one green full suite on the exact tree. When
`ship_build` reported `fullSuiteVia: "ci"` (param `fullSuiteVia` of
`ship_release`, else the checkpoint's build step), `ship_release` requires
the PR's aggregator check `suite` to have run and passed. Absent, skipped,
neutral or pending, `skipChecks`, or a quota bypass → only `findFullGreen`
for HEAD's tree lets the merge through; otherwise `reason:
"full-suite-required"`, PR left open. `ship_run` answers that once itself
(one full local build, then release again).
