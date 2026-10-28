# Ship — Codex review gate details (Step 2)

Referenced by `/do-ship` Step 2. The gate itself (mandatory when
codex-plugin-cc is installed, `codex-safe.sh` only, the rc table, the lockout
BLOCK) stays in SKILL.md.

## rc 75

- **rc=75** (Codex usage limit — stored per user, or just hit) → continue to Step 3 immediately; card `tests` line `{ method: "Codex-Review", result: "übersprungen — Limit bis <reset time from stderr>" }`. The wrapper skips Codex on its own until that time; the first ship after it runs Codex again. Do NOT retry. If the user says Codex is usable again before then (plan bought, limit raised), run `bash "{PLUGIN_ROOT}/scripts/codex-safe.sh" --reset-limit` once, then call the gate normally.

## Claude API fallback

**Claude API fallback (opt-in):** when Codex gave rc 75 / 124 / 127 (or is not installed), run the same review prompt once through `node "{PLUGIN_ROOT}/scripts/claude-api-safe.js" -` (stdin) and evaluate rc 0 exactly like a Codex rc 0 (same lockout rule). rc 126 (switch off) → silent; any other rc → card line `Claude-API-Review → übersprungen — <reason>`, continue. Never retry. **The fix / ask / BLOCK triage applies in full** — fallback findings are not advisory: an in-scope defect is fixed with a regression test before the merge, never parked as an `open` point (`manual-pipeline.md`, Codex Review Gate step 5). Details: `{PLUGIN_ROOT}/deep-knowledge/api-credits.md`.
