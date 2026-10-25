# Frustrated Mode (alpha)

Gated feature `frustrated-mode` (`features.json`, minChannel `alpha`). On beta and stable nothing of it is visible: no hook, no skill alias, no doc.

## What it is

When a session looks stuck (repeated failed attempts, the user's growing frustration), Claude notices it, offers a way out, and only acts after the user agrees.

## Flow

detect -> offer -> read-only analysis -> plan -> approval -> hand-off

1. **Detect** - an alpha-only UserPromptSubmit hook (`prompt.frustrated.detect`) flags the signal and injects context telling Claude to offer the analysis. Claude itself judges from the transcript whether the session is really stuck.
2. **Offer** - one question, never an automatic start. Earlier sessions are read only after an explicit yes.
3. **Read-only analysis** - the `auto-frustrated` skill (entry on yes: `Read {PLUGIN_ROOT}/skills/auto-frustrated/SKILL.md`; also the explicit slash command). Tests may run and test artifacts, snapshots and caches may be written; the app's source and config must not change.
4. **Plan** - presented by the existing concept-vs-card rules: non-trivial -> `/auto-concept` page, trivial -> inline text above the completion card.
5. **Approval** - any interpretable yes in the next prompt, no fixed phrase.
6. **Hand-off** - preset run or fix; it never ships and never asks to ship.

## Config

| Key | Default | Meaning |
|---|---|---|
| `frustratedMode.suggest` | `true` | `false` silences the prompt detector: no stuck-session notice reaches Claude, nothing is offered. The explicit slash entry stays available. Set with `/devops-config` or in `.claude/devops-config.json` (project) / `~/.claude/devops-config.json` (global). |

## Never ships

The hand-off stops before ship. Only a concept close-out sheet may include a ship choice.

## Detector log

`~/.claude/devops-frustration.log` holds one marker line per non-silent verdict
(time, short session id, `suggest` or `band`, rounds, score, signal markers such
as `T1s`/`T2`) and never any prompt text. Every append cuts the file back to its
newest 300 lines, so the cleanup runs with the log itself. Delete it by hand any
time; it is removed with the feature when Frustrated Mode graduates or is
dropped (the log module goes with it). `scripts/frustration-replay.js
<transcript.jsonl|dir>` replays transcripts through the scorer for tuning.

## Session flag

The detector keeps per-session state in the temp dir (2 h expiry).
`isSessionFlagged(sessionId)` from `hooks/lib/frustration-state.js` answers
"is the session flagged right now" (>= 3 rounds, score >= 6, not snoozed).

## Plan record and approval recorder (`run-contract.js plan …`)

The frustrated analysis ends in a plan. The plan is recorded beside the run contract (`<project>/.claude/run-contract.plan.json`), and nothing executes until the user's approval of exactly that plan is recorded. A pending record is inert: "Nur Analyse" is the default, silence is never approval. Code: `hooks/lib/run-contract-plan.js`, CLI in `hooks/lib/run-contract-cli.js`. All subcommands exit 126 (`{"ok":false,"disabled":true,"error":"not available"}`) when the `frustrated-mode` feature is off.

Always pass `--cwd` when calling it from a script or a smoke test; a bare call acts on this session's live project.

| Call | Does | Output (JSON, one line) |
|---|---|---|
| `plan record [--file <plan.json>] [--id <fm-id>] [--from-concept-closeout]` (plan JSON on stdin when no `--file`) | Hashes the canonical plan, writes a `pending` record with a 2 h expiry | `{ok, recorded, plan:{id,version,hash,short,state,recordedAt,approvedAt,expiresAt,fromConceptCloseout}, display:"fm-… v1 · 3f9a1c2e"}` |
| `plan approve --id <fm-id> --hash <hash\|short>` | Records the approval after checking id, hash (8+ hex chars), expiry; replaces a running other contract | `{ok, approved, plan, replaced:{id,mode,flow,armedAt}\|null}`; on refusal `{ok:false, approved:false, error}`, exit 1 |
| `plan status` | Current record, and the contract an approval would replace | `{ok, active, plan\|null, steps, wouldReplace:{…}\|null}` |
| `plan clear` | Removes the record | `{ok, cleared}` |

Plan JSON: `{direction, steps:[{n, type: implement|concept|learn|webguide, goal, objects, payload}], out_of_scope, decisions, checks, base}`, at most 16 KB. The hash (sha256, keys sorted, strings NFC and whitespace-collapsed) covers the content only, never `id`, `version` or timestamps. Recording again under the same id with changed content raises `version` and drops an earlier approval; identical content keeps version and approval.

Rules:

- **Approval is any interpretable yes** in the user's next prompt (no fixed phrase). Claude judges the prompt, then calls `plan approve` with the id and hash it showed. The recorder only verifies id/hash/expiry; it does not read the prompt.
- **Announce the replacement.** Call `plan status` before asking: `wouldReplace` names a running contract that the approval will close (aborted, reason `replaced by approved plan …`). A refused approval leaves it untouched.
- **Own expiry.** The plan record expires 2 h after recording (and 2 h after approval), independent of the contract's expiry. An expired record is removed on read; approving it fails.
- **Never ships.** A step of type `ship`/`release`/`merge`/`push`/`deploy` (or `ship: true`) is rejected by `record`, and by `approve` for a hand-edited record, unless `--from-concept-closeout` was given. The plan path never arms a contract or a ship step itself.

Developer notes: `docs/dev/feature-flags.md`.
