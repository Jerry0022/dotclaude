# Iteration Tabs (single file, many iterations)

Every concept page is a stack of iteration tabs. The **tab bar lives in the
decision panel at the top** of the content area (a slim strip above the
variants, not in the right sidebar — the sidebar stays reserved for submit
controls). Each tab shows exactly one iteration; the active one is interactive,
all earlier ones are frozen (disabled inputs showing the user's submitted
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
- Tab bar must stay compact (one line, horizontally scrollable if many
  iterations) so it does not push variant content out of view.

See `templates.md` § Iteration Tabs for the reference HTML/CSS/JS.
