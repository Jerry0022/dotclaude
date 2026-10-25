# Frustrated Mode

## Config

| Key | Default | Meaning |
|---|---|---|
| `frustratedMode.suggest` | `true` | `false` silences the prompt detector (`prompt.frustrated.detect`): no stuck-session notice reaches Claude, nothing is offered. The explicit slash entry stays available. Set with `/devops-config` or in `.claude/devops-config.json` (project) / `~/.claude/devops-config.json` (global). |

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
"is the session flagged right now" (>= 3 rounds, score >= 6, not snoozed, past
the cooldown of an earlier offer).
