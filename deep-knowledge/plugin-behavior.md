# Plugin Behavior Rules

Core behavioral rules enforced by the dotclaude-dev-ops plugin.
These are loaded automatically — users don't need to copy them into CLAUDE.md.

## Completion Flow

After completing code changes, the `post.flow.completion` hook triggers
automatically. The flow is:

1. **Verify** — visual verification per `deep-knowledge/visual-verification.md`
   and `deep-knowledge/test-strategy.md`
2. **Issue status** — if an issue is tracked (via `prompt.issue.detect` hook),
   update its status
3. **Completion Card** — render per `templates/completion-card.md`
4. **Ship recommendation** — after 5+ code edits, recommend `/ship`

This replaces the old manual `/start` → `/test` → completion card sequence.
Hooks handle the orchestration automatically.

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
