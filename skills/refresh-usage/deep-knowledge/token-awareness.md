# Token Awareness — Budget Management

## Per-operation Guard
- Avoid reading files >20,000 tokens unless absolutely necessary.
- Confirm with user before operations estimated to cost ≥2% of session limit.
- **Token cost = Claude processing cost only.** Commands Claude merely executes (git, rm, mkdir, etc.) have zero token cost and must never be blocked.
- The `precheck-cost.js` PreToolUse hook enforces this automatically for Read, Bash, Glob, Grep.

## Strategic Budget Awareness
- Before actions consuming >2% of weekly limit: evaluate if proportionate, ask if uncertain, choose cheaper approach if disproportionate.
- When 5h window >70%: prefer targeted over broad operations.
- When weekly limit >60%: mention budget state when proposing large tasks.
- **Never refuse work** — the user decides. Surface the cost trade-off.

## Implementation
- `precheck-cost.js` reads `scripts/config.json` (expensive files list) and `scripts/usage-live.json` (live token usage).
- First call blocks with warning + file list → user confirms → second call proceeds.
- `startup-summary.js` populates the expensive files list at session start.
