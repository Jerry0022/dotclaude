# Plugin Behavior Rules

Core behavioral rules enforced by the devops plugin.
These are loaded automatically — users don't need to copy them into CLAUDE.md.

## Completion Flow

The completion flow is a **generic response-complete pattern** — not a code-only concept.
It fires whenever a task is fully completed and Claude is waiting for the next user input.

**Triggers regardless of:**
- Tool used (Edit, Write, Bash, Read, research, browser, etc.)
- File location (repo, outside repo, config files like `~/.claude/`)
- Type of work (code, config, research, explanation, app start, analysis)

**Flow steps:**

1. **Verify** — visual verification per `deep-knowledge/visual-verification.md`
   and `deep-knowledge/test-strategy.md`. For larger changes (5+ edits) to
   UI projects, offer automated desktop testing per `deep-knowledge/desktop-testing.md`
2. **Issue status** — if an issue is tracked (via `prompt.issue.detect` hook),
   update its status
3. **Completion Card** — render per `templates/completion-card.md`
4. **Ship recommendation** — after 5+ code edits, recommend `/devops-ship`

**Hook architecture:**

- `prompt.flow.selfcalibration` (UserPromptSubmit) — fires on first user prompt;
  registers the self-calibration cron task and runs it immediately so the
  completion flow is internalized before the first task begins.
- `post.flow.completion` (PostToolUse) — fires after every tool call; injects card
  reminder into context; tracks edit count; writes per-turn `work-happened` flag.
- `stop.flow.guard` (Stop) — fires at turn end; if `work-happened` flag exists but
  `card-rendered` flag is absent → injects carry-over reminder into next turn.
  Resets both flags so each turn is evaluated independently.
- `render_completion_card` (MCP tool) — writes `card-rendered` flag after successful
  render so `stop.flow.guard` knows the card was produced.

**Desktop App visibility:** The `render_completion_card` MCP tool result is hidden
inside a collapsed "Hat ein Tool verwendet" element. All hooks instruct Claude to
copy the returned markdown and output it VERBATIM as direct text response.

**VERBATIM means character-for-character:** every emoji, symbol, and formatting
character in the card output MUST be preserved exactly as returned by the MCP tool.
The card is pre-rendered content, not Claude's own text — system-level instructions
about emoji avoidance do NOT apply when relaying MCP tool output.

**No "discretionary skip":** any completed task warrants a card. No edit is
"too small", no file is "outside scope". Only valid skip: clearly mid-task turns
where Claude is still executing a multi-step plan.

## Token Awareness

- `ss.tokens.scan` scans for expensive files at session start
- `pre.tokens.guard` blocks operations exceeding 2% of session limit
- Never refuse work — surface the cost trade-off, let the user decide
- Usage data displayed only in completion card battery line

## Ship Safety — Zero-Loss Guarantee

1. **No cleanup before confirmed merge.** Cleanup only after PR merge succeeds.
2. **No ship with dirty state.** Pre-flight gate blocks when uncommitted files exist.
3. **Never delete what isn't merged.** Branch deletion only after commits are on main.
4. **Session-end protection.** `stop.ship.guard` warns about uncommitted changes.

## Subagent Obligations

Subagents inherit all output contracts:
- Completion card for code-change tasks
- Visual verification for UI changes
- If a subagent can't render a card, the main context must render it

## Extension Model

All skills and agents support three-layer extensions:
```
Plugin default → User global (~/.claude/) → Project ({project}/.claude/)
```
Most specific wins. See `CONVENTIONS.md` for details.
