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
    `#feedback-close`, and — for the optional annotation layer, when the
    iteration uses one — `.anno-pin` and `[data-anno-summary]` (the
    collapsed question row is a second, fully equivalent way to open the
    same bubble; it is a real `<button>` living inside
    `section[data-iteration]` and the click handler treats it exactly like
    the pin, so exempting the pin but not the summary leaves the layer
    half-navigable on a frozen tab). `#panel-toggle`, `#feedback-toggle` and
    `#anno-toggle` live OUTSIDE `section[data-iteration]` entirely (they are
    page-level chrome, not descendants of the iteration section the sweep
    walks) — their entries here are decorative, kept only so this list
    reads as the complete "controls that must survive freezing" set; the
    sweep itself never reaches them and needs no exemption for them.
    **When the iteration uses views (optional, see
    templates.md § Views (optional)), also skip `.view-switch-item` and
    `.screen-nav-view-item`** — switching to/between views must keep working
    on a frozen tab exactly like switching designs/screens does. Textareas
    (including annotation answers and view notes) still go `readonly`
    (never `disabled`, so their submitted text stays legible and copyable)
    and submit stays unarmed — only navigation controls are exempt, not the
    form/comment surface. A view's own `[data-decision]` bi-state radios are
    NOT exempt — they freeze `disabled` exactly like every other decision
    card on the page (see § Freezing Design Iterations below for how their
    submitted state is restored).
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
- `#panel-toggle` — the ☰ FAB that opens the panel/switcher. Lives OUTSIDE
  `section[data-iteration]` (page-level chrome), so the sweep never reaches
  it in the first place; listed here only for completeness.
- `#feedback-toggle` — the 💬 FAB that opens the feedback dock. Same
  outside-the-section caveat as `#panel-toggle` above — decorative entry.
- `#feedback-close` — the dock's minimise control
- `.anno-pin` — the (optional) annotation layer's pins, when the iteration
  uses one. Freezing must not strand the user unable to reopen a bubble to
  re-read their own past answer.
- `[data-anno-summary]` — the annotation layer's collapsed question row (the
  truncated-question button shown instead of the full pin+bubble in some
  layouts). It is a real `<button>` inside `section[data-iteration]` and the
  click handler treats it as fully equivalent to `.anno-pin` for opening a
  bubble — exempt it alongside the pin, or the row goes dead on a frozen tab
  while the pin next to it keeps working.
- `#anno-toggle` — the annotation layer's eye pill. It must keep toggling
  the layer on a frozen tab exactly as it does on the live one. Also lives
  OUTSIDE `section[data-iteration]`, same decorative caveat as
  `#panel-toggle`/`#feedback-toggle` above.
- `.view-switch-item` — the view segments in the top-centre switcher, when
  the iteration uses views (optional, templates.md § Views (optional)).
- `.screen-nav-view-item` — the view entries in the panel's second nav
  group. Their (non-interactive) `.screen-nav-views-heading` label needs no
  exemption — it was never disabled in the first place.

Everything else in a frozen `design` iteration follows the same rule as any
other frozen iteration: comment textareas become `readonly` (so the
submitted text stays visible but not editable), and the submit block is
inert — no re-arming iterate/implement from a frozen tab. `readonly`, not
`disabled`, is important here: a `disabled` textarea's value can render as
unreadable/greyed-out in some browsers, defeating the "revisit past
feedback" purpose that exists for every template. This applies to
annotation answer textareas (`textarea[data-annotation]`) the same as to
every other comment field — they go `readonly`, never `disabled`, and their
submitted answer is what the reader sees when they reopen the pin's bubble.

**The feedback dock needs explicit handling.** Its textareas are built by
JS and live OUTSIDE `section[data-iteration]`, so the freeze sweep never
reaches them — a frozen tab would otherwise show empty, editable fields and
imply the user submitted nothing. Freezing a `design` iteration therefore
also requires embedding the submitted comments in the frozen section:

```html
<script type="application/json" data-frozen-feedback>
  {"general": "…", "designs": {"dispatch": "…"}, "screens": {"d1-s1": "…"}, "views": {"nav-model": "…"}}
</script>
```

`applyDockFreezeState()` (templates.md § Layout JS) reads that blob whenever
`body.viewing-frozen` is set, fills the dock read-only, and restores the live
iteration's unsent text when the user switches back. `views` follows the
same rule as `designs`/`screens` — present (possibly `{}`) whenever the
iteration uses views, keyed by view id, and only needed because the
view-level dock textarea lives OUTSIDE `section[data-iteration]` just like
the general/design/screen ones.

**A frozen view's own `[data-decision]` bi-state and notes need no blob at
all.** Unlike the dock, a view's bi-state groups and their adjacent
`textarea[data-comment="{decisionId}-note"]` live INSIDE
`section[data-iteration]` (§ Views (optional), templates.md) — so the
generic freeze sweep already reaches them exactly the way it reaches every
other decision card on the page: the freeze step sets the `checked`
attribute on the radio matching the user's submitted `evaluation` and adds
`disabled` to both radios, and sets the note textarea's submitted value with
`readonly` (never `disabled`). Reopening a frozen tab and clicking into that
view shows the exact submitted bi-state and note, already rendered, with no
JS read step — same "no JSON blob, no JS read step" shortcut the annotation
layer gets, for the same DOM-location reason.

**The (optional) annotation layer needs no such blob.** Unlike the dock,
`[data-anno-layer]` and its `.anno` pins live INSIDE
`section[data-iteration]` (§ Annotation Layer (optional), templates.md), so
the freeze sweep already reaches their textareas the same way it reaches
every other comment field on the page. A frozen annotation's answer is
simply whatever text is already sitting in
`textarea[data-annotation]` in that section's static HTML — set it to the
user's submitted answer and mark it `readonly` (never `disabled`, same rule
as above), and it renders correctly the moment the user reopens that pin's
bubble on the frozen tab. No JSON blob, no JS read step, no extra freeze
step beyond "same as every other comment textarea".

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
