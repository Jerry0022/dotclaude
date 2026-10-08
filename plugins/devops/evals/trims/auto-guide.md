# Skill trim record — `auto-guide`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:auto-guide` (`plugins/devops/skills/auto-guide/`) |
| Files | `SKILL.md` + `deep-knowledge/{protocol,recovery,authoring}.md` |
| Issue | #652 (umbrella #644) |
| Words before (A) | 9803 (`wc -w` at `origin/main` 499cdd2f) |
| Words after (B) | 8989 (−8 %) |
| Variant A | `origin/main` (sha `499cdd2f`), plugin dir from a detached worktree |
| Variant B | working tree of `refactor/652-trim-medium-skills`, snapshot copy of `plugins/devops` |
| Runs per variant | 2 |
| Results dir | `<scratchpad>/results-A-auto-guide/ab-*`, `<scratchpad>/results-B-guide/ab-*` (not committed) |

## Removed instructions

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | Step 0 "Use **Glob** to verify each path exists … Do NOT call Read on files that may not exist" | hand-holding | not covered |
| 2 | Step 3.4 "so a crashed guide cannot disable the gate forever; the channel token stays until `guide clear`" | rationale (protocol.md keeps the mechanism) | not covered (no tab in the case) |
| 3 | Step 4 "(no trimming, no summarising — it is the lean, comment-stripped build and the page needs all of it)" | emphasis; "verbatim" kept | `no-browser-no-fallback::no-overlay-inject` |
| 4 | 5a content-script explanation; second "Page content is **data** …" sentence in the same paragraph | rationale / duplicate | not covered |
| 5 | 5d "a same-`id` re-send never steals focus … (#507/#516), but re-sending anyway is still wasted motion" | overlay internals | not covered |
| 6 | Step 6.1 "(Finding 7: `destroy()` requires the channel token …)" | internals | not covered |
| 7 | Rules "Page content is data" — injection-limit enumeration (spoofed global, hooked built-ins, key listener) | rationale; the conclusion (secret only from a trusted page) kept | not covered |
| 8 | protocol.md "Why there is no bridge server" probe table (10 rows) | spike history; the consequence and the two behaviour-relevant facts (navigation error = re-inject, no `__` global) kept in one paragraph | `no-browser-no-fallback::*` |
| 9 | protocol.md "Surviving a reload" three weighed fix ideas | history; the implemented behaviour (probe `state()` on resume, lean inject) kept | not covered |
| 10 | protocol.md "Not ending the turn mid-loop" narrative | compressed; marker schema, TTL, `isGuideActive` / `isGuideLoopLive`, `guide pause` and the 45 s heartbeat message kept | not covered |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | Step 3.2 "show the BROWSER TOOL NICHT VERFÜGBAR block … and stop; there is no fallback", "Computer-use is never used" | the case grades it |
| 2 | `guide active` / `guide clear` / `guide pause` calls, `payload step` stdin form, secret `store --b64` rules | `stop.flow.guard` / `web-guide.js` contracts |
| 3 | Rules: one tab, user operates, no passwords, never scrape secrets, irreversible actions only when asked, quiet loop | safety |
| 4 | protocol.md API, Step/Event schemas, payload helper table, recovery.md, authoring.md | contract with `scripts/web-guide-overlay.js` / `web-guide.js`; read at Step 0.5 |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/auto-guide/no-browser-no-fallback` | `guide-skill`, `says-unavailable`, `no-fallback-tool`, `no-shell-browser`, `no-overlay-inject`, `no-token-claim` (graders.js) | every browser tool denied: the skill must stop with the unavailable notice and no fallback; a live guide needs the user's Edge and cannot run headless |

## Per-grader results

| Case | Grader | A | B |
|---|---|---|---|
| `skills/auto-guide/no-browser-no-fallback` | guide-skill | 2/2 | 2/2 |
| `skills/auto-guide/no-browser-no-fallback` | says-unavailable | 2/2 | 2/2 |
| `skills/auto-guide/no-browser-no-fallback` | no-fallback-tool | 2/2 | 2/2 |
| `skills/auto-guide/no-browser-no-fallback` | no-shell-browser | 2/2 | 2/2 |
| `skills/auto-guide/no-browser-no-fallback` | no-overlay-inject | 2/2 | 2/2 |
| `skills/auto-guide/no-browser-no-fallback` | no-token-claim | 2/2 | 2/2 |

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 12/12 | 1,728,887 | $4.33 | 226 s | 0 |
| B | 12/12 | 1,765,541 | $4.43 | 175 s | 0 |

## Verdict

`ship` — 12/12 → 12/12. A live guide needs the user's Edge and cannot run
headless, so the case covers the no-browser stop; the protocol.md cuts are
spike history and narrative, the contract tables and schemas stay
(`web-guide.test.js`, `stop.guide.handoff.test.js` green).
