# Test Prompt Card

After every app start, show a test prompt card — the counterpart to the completion card.

## Variants

### Standalone start — no prior code changes in this session

```markdown
---

## 🧪 <build-id> · App gestartet

---
```

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

## Build ID

Always computed via `node ~/.claude/scripts/build-id.js` (source code + assets only).

## Title line

- Always `App gestartet` — no port, no URL, no extra detail.
- Use `##` heading — consistent with completion card.

## Test steps (only after code changes)

- Numbered list, concrete and executable (click X, observe Y).
- Each step one sentence. Use `→` to separate action from expected result.
- Scale: 2-3 for small changes, up to 6 for larger features.
- Steps are in German (user's language).
- Plain text only — no bold, no inline code, no bullet markers.

## Rules

- `\` on its own line after the title for visual break (only when test steps follow).
- No file list, no status line, no usage line.
- The card is the **last thing** in the response.
- Keep it factual — no commentary.
