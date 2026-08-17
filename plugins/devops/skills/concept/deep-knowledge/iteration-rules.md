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
| Implementation finished (Step 5b implement branch) | Append `<section data-iteration="N+1" data-final-report data-active>` with the Abschlussbericht structure. Add a new tab carrying `data-final-report` and label `{{iteration.final_tab}}` ("Abschlussbericht" / "Final report") — NEVER "Iteration N+1". Freeze the previous section the same way. | New tab "Abschlussbericht" auto-active. Right panel switches to `panel-final-report` (no iterate/implement buttons). At most one final-report section per concept session. |
| Close-out from final report (`action: "finalize"`) | Do NOT append a new section. Rewrite the existing final-report HTML in place: for routed issues add `disabled` to the `[data-open-questions]` checkboxes and append an `.oq-issue-link` `<a>` with the GitHub issue URL; for a successful ship add the version note to the Zusammenfassung. Keep `data-active` on the final-report section. | Same final-report tab stays active; routed items become read-only audit entries. `refreshFinalizeWizard()` drops the wizard's issues step once every checkbox in the section is disabled. |

**Rules:**
- **Never create a second file** for iterations of the same concept — always
  append a section to the existing file and POST `/reload` (see Step 5c).
- The active iteration is the only one that accepts input. Submit sends
  decisions for the active iteration only.
- Freeze previous iterations visually: disabled tri-state buttons showing
  which state the user submitted, read-only comment fields with the text
  the user entered. Users can click back to earlier tabs to review their
  own past feedback at any time.
  - **Exemption for `design` iterations:** freezing must NOT disable
    navigation — the user still has to be able to revisit the mockups. The
    `disabled`-everything sweep MUST skip `.design-switch-item`,
    `.screen-nav-item`, `.screen-nav-design-heading`, `[data-screen-link]`,
    `#panel-toggle`, `#feedback-toggle`, and `#feedback-close`. Textareas
    still go `readonly` (never `disabled`, so their submitted text stays
    legible and copyable) and submit stays unarmed — only navigation
    controls are exempt, not the form/comment surface.
    See § Freezing Design Iterations below.
- Only the active tab runs the heartbeat / submit UI ("music"). Clicking
  an older tab shows its frozen snapshot but does not re-arm submit.
- Tab bar must stay compact — vertical chip list in the panel header.
  Falls back to horizontal scroll only when the panel collapses to the
  bottom on narrow screens.

See `templates.md` § Iteration Tabs for the reference HTML/CSS/JS.

## Freezing Design Iterations

A frozen `design` iteration (`data-iteration-template="design"`, legacy
alias `prototype`) is navigable, not inert. When freeze logic walks the
section applying `disabled` to every interactive descendant, it MUST
explicitly skip these selectors so the user can still browse the mockups
and revisit their own submitted notes:

- `.design-switch-item` — the design switcher segments (switching between
  competing designs must keep working)
- `.screen-nav-item` — per-screen navigation entries in the panel
- `.screen-nav-design-heading` — the design-level entries those items are
  nested under; disabling them while their children stay live makes the
  nav half-navigable
- `[data-screen-link]` — click-dummy navigation INSIDE the mockup. These
  are ordinary `<button>`s living inside `section[data-iteration]`, so a
  naive sweep hits them and kills exactly the walkthrough the frozen tab
  exists to preserve
- `#panel-toggle` — the ☰ FAB that opens the panel/switcher
- `#feedback-toggle` — the 💬 FAB that opens the feedback dock
- `#feedback-close` — the dock's minimise control

Everything else in a frozen `design` iteration follows the same rule as any
other frozen iteration: comment textareas become `readonly` (so the
submitted text stays visible but not editable), and the submit block is
inert — no re-arming iterate/implement from a frozen tab. `readonly`, not
`disabled`, is important here: a `disabled` textarea's value can render as
unreadable/greyed-out in some browsers, defeating the "revisit past
feedback" purpose that exists for every template.

**The feedback dock needs explicit handling.** Its textareas are built by
JS and live OUTSIDE `section[data-iteration]`, so the freeze sweep never
reaches them — a frozen tab would otherwise show empty, editable fields and
imply the user submitted nothing. Freezing a `design` iteration therefore
also requires embedding the submitted comments in the frozen section:

```html
<script type="application/json" data-frozen-feedback>
  {"general": "…", "designs": {"dispatch": "…"}, "screens": {"d1-s1": "…"}}
</script>
```

`applyDockFreezeState()` (templates.md § Layout JS) reads that blob whenever
`body.viewing-frozen` is set, fills the dock read-only, and restores the live
iteration's unsent text when the user switches back.

**The panel itself switches to `#panel-frozen`** on any non-live tab — a short
"this is an earlier round, it is read-only" note plus a back-link to the live
iteration. It applies to every template, not just `design`. Without that block
the panel's lower half is simply empty on a frozen tab, and the only way back
is guessing which chip is live — which is not the last one once a final report
exists. See templates.md § Common Structure.

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
