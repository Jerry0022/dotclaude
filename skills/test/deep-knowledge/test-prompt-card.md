# Test Prompt Card

When the app is started, **always** show a test prompt card — regardless of whether changes were made. This is the counterpart to the completion card — short, consistent, recognizable.

## Variants

### After changes — with test steps

```markdown
---

## 🧪 <build-id> · App gestartet

\
Bitte testen:
1. First test step
2. Second test step
3. ...

---
```

### Standalone start — no prior changes

When the user simply asks to start the app without prior code changes in this session, show the card without test steps:

```markdown
---

## 🧪 <build-id> · App gestartet

---
```

## Title line logic
- **Always** include the build ID (`git write-tree | cut -c1-7`).
- Summary is always `App gestartet` — no port, no URL, no extra detail.

## Test steps (only for "after changes" variant)
- Numbered list, concrete and executable (click X, observe Y).
- Cover the happy path first, then the most likely failure modes.
- Scale to scope: 2-3 for a small change, up to 6 for a larger feature.
- Each step one sentence. Use `→` to separate action from expected result.
- Steps are in German (user's language).

## Rules
- Use `##` heading for the title line — consistent with completion card.
- Use `\` on its own line after the title for visual break (only when test steps follow).
- Plain text only for test steps — no bold, no inline code, no bullet markers.
- No file list, no status line, no usage line — this is a lightweight prompt, not a completion card.
- The card is the **last thing** in the response when starting the app.
- Keep it factual — no commentary or praise.
- Omit the card entirely for non-runtime changes (per test-strategy.md skip rules).

## When to show
- **Every time** the app is started via `preview_start` or Bash — with or without prior changes.
- With test steps: when there are user-visible changes to verify.
- Without test steps: when the user simply requests an app start (e.g., "starte die App", "run it", "start the dev server").
- Not after automated tests — only when the **app** is running and accessible.
