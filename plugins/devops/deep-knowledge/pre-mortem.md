# Pre-Mortem / Red-Team Self-Critique

Cross-cutting rule for reducing blind spots before non-trivial changes.

## Purpose

A short adversarial self-critique — "how would I sabotage this without
anyone noticing?" — surfaces failure modes before they reach production.
Runs **inline in reasoning**, never as a separate artifact. Cap: ~30 seconds
of thought, stop as soon as 1-2 concrete risks are identified and folded
into the implementation.

## When to Apply (Triggers)

Apply the pre-mortem before starting implementation when the task involves:

- **Security-relevant code paths** — authentication, session handling,
  permissions, cryptography, input validation, secret handling
- **State or schema migrations** — DB migrations, data backfills, schema
  changes that touch existing rows
- **Breaking changes to public contracts** — API shapes, IPC messages,
  exported function signatures, config keys
- **Refactors spanning more than 3 files** — any change broad enough that
  a silent regression could hide in an untouched caller
- **Concurrency / race-sensitive code** — async chains, shared mutable
  state, locks, request ordering, retry logic
- **Destructive operations** — `delete`, `drop`, `rm -rf`, force-push,
  irreversible file moves, cache invalidation
- **External integrations** — new 3rd-party API calls, webhook handlers,
  auth against external providers

## When NOT to Apply (Skip)

- Typos, copy changes, pure CSS tweaks
- Adding a log line, renaming a local variable
- Pure Q&A or explanation with no code change
- Single-file trivial edits (one function, clear scope)

Strictly respect the skip list. Pre-mortem on trivia is noise.

## What to Ask (Question Set)

Pick the 2-3 most relevant questions for the change at hand:

1. How would I implement this so it looks correct but silently fails in
   production?
2. Which race condition or ordering change breaks this?
3. What happens on partial failure mid-operation — half-written state,
   interrupted transaction, retry after crash?
4. Which edge case (empty, null, very large, negative, concurrent,
   duplicate) flips the behaviour?
5. Which existing assumption in the codebase am I violating — invariants,
   contracts, data shape, ordering?
6. What looks fine in the happy path but is already broken elsewhere?
7. What is the rollback story if this is wrong?

## Output Rule

Results flow **inline into the implementation** — as guard clauses, targeted
tests, explicit error handling, or a narrower scope. **Do not** emit:

- A separate markdown summary of the pre-mortem
- A concept page or artifact file
- A long prose block explaining what was considered

Mention a concrete risk in a sentence only if it changes what you implement
or what you ask the user.

## Stop Criterion

As soon as 1-2 concrete risks are identified and addressed, proceed with
implementation. The pre-mortem is a scan, not an audit — do not spiral into
hypothetical failure modes with no actionable response.

## Relationship to the Red-Team Agent

For larger or higher-stakes work, escalate to the `redteam` agent in a wave
(parallel to `po`). The agent produces a list of concrete risks with
file/line references; the implementing agent folds them in. The inline
pre-mortem above is the always-on lightweight version.
