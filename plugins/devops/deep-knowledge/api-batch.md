# API Batch Mode (alpha)

A cheaper path for LARGE, unattended, read-only jobs on the API credit: the Message Batches API bills 50 % of input and output (cache multipliers stack). It is only a preferred alternative — the normal path is always the fallback and the job finishes exactly as it would without batch.

## The 5 rules (`scripts/batch-policy.js`, all must hold)

| Rule | Condition | Why |
|---|---|---|
| R1 | feature flag `batch` allowed (alpha channel) | alpha-only feature |
| R2 | `apiCredit.enabled`, key stored, no rc-75 limit marker, month budget (if known) >= estimated cost | no credit, no batch; never spend what is not there |
| R3 | `unattended: true` | a batch returns in minutes to hours; an interactive caller cannot wait |
| R4 | >= 5 requests AND estimated saving >= $1 (normal cost >= $2) | below that the 50 % is not worth the polling and the split |
| R5 | deadline >= 30 min (default 2 h) | batches usually end within 1 h; too little time means a cancel for nothing |

`node scripts/batch-policy.js --requests N --est-input-tokens T --est-output-tokens O --model M --unattended [--deadline-min 120]` prints `{useBatch, reason, estUsd, estSavingUsd}`; exit 0 = batch, 3 = normal path (never an error for "no"), 126 = feature off.

## Qualifying jobs

| Job | How it decides |
|---|---|
| Month-end audit | automatic: `api-credit-audit.js` asks the policy on its own (no flag); one request per module pack, shared 1 h-cached system prefix. `--no-batch` skips the attempt |
| Any other big unattended read-only job (plugin audit, overnight web-only research) | ask the policy first with the CLI above; exit 0 → `runBatch()`, else the normal path. Server tools (web search/fetch) work inside a batch; client tool loops do not |

Not a batch job: do-run's backlog triage. It runs in the Präsenz phase with the user present (fails R3) and its agents are what the run contract counts.

## Fallback guarantee

`runBatch()` (`scripts/claude-api-batch.js`) never throws. Submit failure, 4xx/5xx, expiry, repeated poll failures: everything is returned as `unfinished`. At the deadline it cancels, salvages what finished, and returns the rest as `unfinished`; the caller runs those on the normal path. A credit-limit error on submit stores the usual rc-75 marker.

## Seeing results

`node scripts/claude-api-safe.js --usage` — batch lines have `tool: "batch"`, the $ at 50 %, `savingUsd`, and `done`/`unfinished` counts.

## Switch

Feature flag = channel (alpha). Plus `apiCredit.enabled` and a stored key. Optional month budget: `DEVOPS_API_MONTH_BUDGET_USD` (remaining = budget minus this month's usage log).
