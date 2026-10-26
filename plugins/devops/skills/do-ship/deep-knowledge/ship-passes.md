# Ship — Ship passes (Step 1e)

Referenced by `/do-ship` Step 1e. The two calls, the composed-ship `--cwd`
rule, "never blocks", strict mode and the skip rule stay in SKILL.md; this is
what each pass checks and how its findings reach the card.

## Pass details

1. `node "{PLUGIN_ROOT}/scripts/ship-harden.js" --invoked-by=ship --base=<base> [--cwd=<path>] <files of the diff>` — every
   changed file; checks H1–H7 on the added lines and applies the mechanical
   H1/H2 fixes itself (`auto-harden` § Ship path as a script, same JSON). Add
   `--strict` under strict mode.
2. `/auto-polish --invoked-by=ship [--cwd=<path>] <ui files of the diff>` — only when the
   diff has UI files (`{PLUGIN_ROOT}/deep-knowledge/ui-defaults.md` § Detection
   allowlist (row *UI file detection*), plus the project's `## UI rules` override in
   `.claude/skills/auto-polish/reference.md`, pre-PR-2 fallback `tune-polish/`);
   the static halves of the standing UI rules (`auto-polish` § Rules-only path).
3. **Workflow hygiene** — `ship_preflight` returns `workflowHygiene.findings`
   (`file`, `line`, `rule`, `fix`) for every `.github/workflows/*.yml`, not
   only the diff: `upload-artifact-fatal`, `upload-artifact-retention`,
   `pr-concurrency`. Apply each `fix` in this ship (mechanical: add
   `continue-on-error: true`, `retention-days:` — 7, or 1 for a job hand-off —
   and a `concurrency` group with `cancel-in-progress: true`), commit it with
   the ship and list it under `changes`. A shared GitHub account limit
   (artifact quota, Actions minutes) then can no longer turn a green job red
   in any repo. A fix the workflow's own comments argue against → a
   `userFinalTest` item instead.

### Order: harden fixes come BEFORE ship_build

Step 1e (these passes and their fixes) runs before `ship_build`, so the build
and the test run validate the tree that is merged — a fix applied after the
build would force a second full build. If the build still goes red because of
a harden/polish fix, revert exactly that fix (`git checkout -- <file>` of the
files the pass changed, listed under `changes`) and re-run the build with the
previous green tree key — the test-result cache answers it without a second
full run. Keep the finding on the card instead of the fix.

## Early gates (fewer repeats)

- `ship_preflight` accepts the same `validation` array as `ship_release` and
  returns `validationGaps` (plus a warning) at once: close an open own
  requirement BEFORE the build instead of learning it at release time.
  `ship_release` stays the final authority.
- `ship_preflight earlyPush: true` pushes the branch and opens a draft PR
  (`earlyPr { number, url }`) so CI starts while lint/tests/Codex run.
  `ship_release` marks it ready (`draftPrReady`) before the checks wait. A ship
  that ends blocked leaves that PR open: the release result says so in
  `prLeftOpen { number, url }` — mention it on the ship-blocked card.

## Findings on the card

Treat what they return like the other 1d findings:
- `applicable: false` → nothing; no card entry.
- harden `fixed` items (it applied them) and polish findings with
  `mechanical: true` (apply the one-line `fix` yourself) → commit with this
  ship, list under `changes`.
- every other finding → a `userFinalTest` item naming id/rule, file:line and
  what to check; a harden H3 (secret-shaped literal) goes first.
- one `tests` line per pass that ran: `{ method: "Harden (Ship)", result: "1 Fix · 2 Hinweise" }`,
  `{ method: "UI-Regeln", result: "2 Findings · R2b deaktiviert (Projekt-Override) · R4b n/a" }`.
