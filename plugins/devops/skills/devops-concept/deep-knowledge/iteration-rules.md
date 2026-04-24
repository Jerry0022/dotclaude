# Iteration Tabs (single file, many iterations)

Every concept page is a stack of iteration tabs. The **tab bar lives at the
top of the right-side decision panel** (a compact vertical chip list, above
the section TOC and submit block). It must NEVER render inside the left-hand
content area — the content area is reserved for the actual concept. Each
chip represents exactly one iteration; the active one is interactive, all
earlier ones are frozen (disabled inputs showing the user's submitted
selections, read-only comments).

| Situation | Action | Result |
|-----------|--------|--------|
| First generation | Write the file with `<section data-iteration="1" data-active>` and one tab "Iteration 1" | Tab 1 active |
| Feedback loop iteration (Step 5c) | Append `<section data-iteration="N+1" data-active>` to the same file, remove `data-active` from the previous section, freeze it, add a new tab and make it active | New tab "Iteration N+1" auto-active, old tab selectable and read-only |
| Fundamental rework ("nochmal neu") | Same as a feedback iteration — just another tab. The full history stays visible. | Another tab appended |

**Rules:**
- **Never create a second file** for iterations of the same concept — always
  append a section to the existing file and POST `/reload` (see Step 5c).
- The active iteration is the only one that accepts input. Submit sends
  decisions for the active iteration only.
- Freeze previous iterations visually: disabled tri-state buttons showing
  which state the user submitted, read-only comment fields with the text
  the user entered. Users can click back to earlier tabs to review their
  own past feedback at any time.
- Only the active tab runs the heartbeat / submit UI ("music"). Clicking
  an older tab shows its frozen snapshot but does not re-arm submit.
- Tab bar must stay compact — vertical chip list in the panel header.
  Falls back to horizontal scroll only when the panel collapses to the
  bottom on narrow screens.

See `templates.md` § Iteration Tabs for the reference HTML/CSS/JS.

## Iteration append checklist

When appending a new iteration section (Step 5c of `SKILL.md`), verify
**before** posting `/reload`:

1. ☐ All new form elements live inside the new
      `<section data-iteration="N">`.
2. ☐ Each form element has either a `name`, `id`, or `data-*` attribute
      that `collectAllFormFields()` can use as a key.
3. ☐ No new `data-*` attributes are introduced without checking the
      collection function picks them up (the catch-all should, but
      verify — see `validation-gate.md` § Generic Form Collection).
4. ☐ Locally test: open the page, submit, inspect `#concept-decisions`.
      Every input/select/textarea in the active iteration MUST appear in
      the JSON. If any is missing → the catch-all is broken, fix BEFORE
      reload.

## Procedure on every iteration — coverage gate (Step 5c, Step 2.5)

Before appending the new iteration section, insert this verification step
between "freeze previous" (step 2 of the SKILL.md procedure) and "append
new section" (step 3):

**2.5. Verify form collection coverage.** Read the existing JS for
`collectDecisions()` (or its template-specific variant). Confirm it uses
a generic `querySelectorAll('input, select, textarea')` scoped to
`[data-active]`. If it uses hand-listed selectors instead, fix it NOW
before appending the new iteration — otherwise the new section's fields
will silently fail to upload at submit time.

This gate exists because hand-listed selectors written for iteration N
will not pick up new fields introduced in iteration N+1, and the failure
is silent: the user sees the panel turn green, but Claude receives a
truncated payload.
