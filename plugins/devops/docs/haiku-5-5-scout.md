# Haiku 5.5 as the scout model

Why `scout` runs on `haiku · medium` since 2026-10, and how that was measured.
Rule text: `deep-knowledge/agent-orchestration.md` § Model override rules.

## Facts (Anthropic, October 2026)

| | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| API price in/out per MTok | $0.10 / $0.50 (prompt > 100K: $0.50 / $2.50) | $2 / $10 |
| Terminal-Bench 4.0 | 39.2 % | 70.6 % |
| Effort default | medium | high |

Anthropic positions Haiku 5.5 for narrowly scoped work: classification,
routing, extraction, sub-agents next to Opus or Sonnet. At `low` it warns of
skipped searches and early stops under long agent system prompts; `low` →
`medium` roughly halves early stopping and doubles output tokens.

## Measurement (2026-10-13)

Six locate questions on this repo with a grep-verified answer each, every one
run in three configurations (18 runs). Twelve `path:line` claims from the
Haiku answers were checked against the code: all correct, no invented paths.

| Question | sonnet · low (scout) | haiku · low (scout + override) | haiku · session effort (general-purpose) |
|---|---|---|---|
| Q1 readers of `usage-live.json` (10 files) | 10/10 · 9.9 s · 1 call | 10/10, headline "21" ✗ · 8.8 s · 1 | 10/10 · 22.9 s · 2 |
| Q2 hooks naming `concept-active.json` (5) | 5/5, headline "4" ✗ · 6.2 s · 1 | 5/5, headline "8" ✗ · 8.0 s · 1 | 5/5, headline "6" ✗ · 10.9 s · 1 |
| Q3 concept-infra pattern of `stop.flow.guard` | pattern ✓, link to the guard missing · 15.9 s · 3 | complete · 13.1 s · 5 | complete · 23.4 s · 7 |
| Q4 Max 20x budget thresholds | ✓ · 18.5 s · 4 | ✓ · 16.6 s · 5 | ✓ · 24.4 s · 8 |
| Q5 `render_completion_card` registration | ✓ · 12.1 s · 1 | ✓ · 11.6 s · 2 | ✓ · 16.0 s · 3 |
| Q6 model gate and its callers | ✓ · 21.8 s · 6 | ✓ · 19.1 s · 7 | ✓ · 21.0 s · 8 |
| **Total** | 5/6 complete · 1 count error · Ø 14.1 s | 6/6 complete · 2 count errors · Ø 12.9 s | 6/6 complete · 1 count error · Ø 19.8 s |

Reading:

- Haiku matched Sonnet on recall and searched more thoroughly (more tool
  calls, no early stop). Speed gained only ~9 %: wall time is tool latency.
- Every configuration got a headline count wrong at least once — hence the
  count line in the scout's output rules.
- `haiku · medium` itself could not be run in that session (an agent file's
  effort loads only on a session restart); the third column ran with the
  session's effort and a larger system prompt, so its token counts are not
  comparable.
- Six questions show a direction, not a proof.

## Effort choice

Only `low` and `medium` are sensible for a locator. Third-party numbers
(Artificial Analysis, Cognition FrontierCode run in Claude Code):

| Effort | AA Intelligence Index | Output tokens | TTFT | FrontierCode 1.1 | Cost / rollout |
|---|---|---|---|---|---|
| medium | 34 | 54M | 13.4 s | 41.6 % | $0.13 |
| high | 38 | 97M | 24.6 s | 41.9 % | $0.26 |
| xhigh | 41 | 180M | — | 45.8 % | $0.63 |
| max | 43 | 440M | ~315 s | 46.4 % | $1.33 |

`medium` is Anthropic's recommended start and avoids the `low` failure modes
at a token cost that stays roughly a tenth of `sonnet · low`. `high` doubles
tokens and time to first token for +0.3 points on agentic coding; nobody has
measured it on search recall. `xhigh` / `max` are out (cost, empty replies at
`xhigh`, Anthropic points to Sonnet 5.5 for that tier).

## Re-measurement after the ship

A scheduled task (`haiku-scout-remeasure`, Desktop app) repeats the six
questions with the shipped `scout` (haiku · medium) once the installed plugin
carries it, adds the column here, and reverts the scout to `sonnet · low` in
the same PR when it falls behind (fewer complete answers or any invented
path). It ran on 2026-10-17 — see below.

## Re-measurement 2026-10-17 (shipped scout, haiku · medium)

Installed plugin 0.268.7 (`scout`: `model: haiku`, `effort: medium`). The six
questions again, ground truth grep-verified first; each run `devops:scout`,
once with `model: "haiku"` and once with `model: "sonnet"`. The Agent tool has
no effort parameter, so the Sonnet baseline also ran at the frontmatter's
`medium` — not the former `sonnet · low`. Every `path:line` the Haiku answers
cite (95 lines, range ends included) was checked against the code: all
correct, no invented path or line.

| Question | haiku · medium (scout) | sonnet · medium (scout, baseline) |
|---|---|---|
| Q1 readers of `usage-live.json` (10 files) | ✓ 10/10 · 16.5 s · 1 call | ✓ 10/10, headline "8 read / 2 comment-only" ✗ (7 / 3) · 16.4 s · 3 |
| Q2 hooks naming `concept-active.json` (6) | ✓ 6/6, headline "two comment-only" ✗ (1) · 8.8 s · 1 | ✓ 6/6 (counts only, no lines) · 5.8 s · 1 |
| Q3 concept-infra pattern of `stop.flow.guard` | ✓ complete (+ an unverified aside on silent ticks) · 25.6 s · 8 | ✓ complete · 16.4 s · 6 |
| Q4 Max 20x budget thresholds | ✓ · 18.0 s · 4 | ✓ · 17.0 s · 4 |
| Q5 `render_completion_card` registration | ✓ `index.js:2682` · 15.8 s · 3 | ✓ `index.js:2683` · 7.1 s · 1 |
| Q6 model gate and its callers | ✓ · 16.6 s · 4 | ✓ · 14.8 s · 5 |
| **Total** | 6/6 complete · 1 count error · Ø 16.9 s · 21 calls | 6/6 complete · 1 count error · Ø 12.9 s · 20 calls |

Reading:

- No regression: Haiku · medium is complete on all six, like the Sonnet
  baseline, with zero invented citations — the scout stays on `haiku · medium`.
- Haiku is ~30 % slower in wall time here (Q3, Q5 cost extra reads) at a
  fraction of the token price; both still got one headline count wrong.
- Sonnet ran at `medium`, not `low`, so this column is not the old baseline.
