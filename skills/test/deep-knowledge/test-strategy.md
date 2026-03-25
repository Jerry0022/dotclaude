# Test Execution Strategy

## Non-runtime changes — skip preview
Skip the `/test` preview skill entirely when changes are **not visible in the running dev server**. There is nothing to preview or screenshot — verification = CI pipeline or a rebuild/reinstall, not the preview panel.

**Categories that skip preview:**
- **Config/docs/scripts**: CLAUDE.md, shell scripts, `package.json`, `settings.json`, skill files, hook scripts
- **Build/installer assets**: icon files (`.ico`, `.png`), installer code (e.g., `InstallerBridge.cs`, shortcut creation), static design-system assets — these take effect only after a fresh build (`dotnet publish`, `rcedit`, installer run), not in the dev server
- **CI/CD**: workflow files, release scripts, Dockerfile changes

## Task-specific tests (run immediately)
After every code change, run only the tests directly related to the current task — e.g., the specific test file for the changed module, or a targeted `npm run test:unit -- --grep "pattern"`. This verifies the change works without the cost of a full regression suite.

## Full regression suite (run only at ship time)
The full test suite (`npm run test:unit` + `npm run precommit`) runs as part of the `/ship` quality gates (Step 4). Do **not** run the full suite after every implementation pass — this burns tokens on context (test output) and terminal windows without proportional value. The ship flow catches regressions before they reach `main`.

## Test deduplication at ship time
If the full test suite already passed on the **same code state** (same `git write-tree` hash) earlier in the session — e.g., task-specific tests covered the full suite, or the user explicitly ran all tests — the `/ship` quality gates skip redundant test execution. This saves tokens and avoids unnecessary terminal windows. Tests always re-run if the tree hash changed (e.g., due to rebase picking up new commits from main).

## Milestone regression (run before closing a milestone)
After implementing **all issues in a milestone**, run a comprehensive regression test before closing issues or raising a PR:
1. Run the full unit test suite: `npm run test:unit`
2. Run the syntax and contract lints: `npm run precommit`
3. Verify all modules start without errors (check logs, no uncaught exceptions)
4. Confirm all UI content loads (Angular components render, no blank screens)
5. Confirm all UI interactive elements work (toggles, buttons, navigation)
6. If any failures are found: fix them, re-run from step 1, repeat until clean
7. Only after a clean pass: close milestone GitHub issues and open the milestone PR

## User-facing test plan (after implementation)

After completing a unit of work that has user-visible effects, **always include a test plan** — a numbered checklist of concrete steps the user can follow to verify the change. Do not just say "it works" — prove it with actionable steps.

**Format:**
```
## Test Plan

> [Pre-conditions: app started, specific state needed, etc.]

1. [Concise test step — what to do and what to verify]
2. ...
```

**Rules:**
- Steps must be concrete and executable (click X, observe Y, enter Z).
- Cover the happy path first, then the most likely failure modes.
- Scale the number of steps to the scope: 1-2 for a trivial patch, up to 10 for a large feature.
- If hot-reload (HMR) is sufficient, note that a full restart is not required.
- Keep each step to one sentence.
- Skip the test plan for non-visible changes (pure refactors, internal config, documentation).
