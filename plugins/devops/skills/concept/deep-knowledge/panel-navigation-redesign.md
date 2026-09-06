# Decision Panel Redesign — Collapsible Navigation, Pinned CTAs, Status Strip

Design spec for `.concept-decision-panel` (240–360px sticky column, `height:
100vh`, dark/light via `--accent-color`, `--warning-color`,
`--success-color`, `--danger-color`, `--border-color`, `--panel-bg`,
`--text-color`, `--text-secondary`). Fixes the core problem: with 6–10
iterations and 10–25 TOC entries the panel becomes one long scroll and the
two CTA buttons sit below the fold. Target: CTAs are structurally pinned, not
"usually reachable."

## 1. Panel anatomy — pinned top/bottom, scrollable middle

The panel becomes a flex column with three regions, not one scrolling blob:

```
.concept-decision-panel {           /* flex column, height: 100vh */
  display: flex; flex-direction: column;
}
.panel-nav-scroll   { flex: 1 1 auto; min-height: 0; overflow-y: auto; }  /* middle */
.panel-status-strip { flex: 0 0 auto; }                                  /* pinned */
.panel-cta          { flex: 0 0 auto; }                                  /* pinned */
```

`min-height: 0` on the scroll region is load-bearing — without it a flex
child refuses to shrink below its content height and the pin breaks silently
under a long TOC. This is the one CSS fact the whole spec depends on.

Height budget for a 700px viewport (padding `1.5rem` top/bottom = 48px):

| Region | Budget | Notes |
|---|---|---|
| Panel padding (top) | 24px | fixed |
| Iteration group (collapsed) | ~40px | one line + one link |
| TOC accordion | flexible, **min ~120px** | shrinks first, never to 0 |
| `panel-nav-scroll` internal scrollbar | — | only the TOC/iteration region scrolls |
| Status strip | 40px | fixed row |
| Divider | 1px | border-top |
| CTA block (§5) | ~150px | fixed |
| Panel padding (bottom) | 24px | fixed |
| **Total fixed chrome** | **~280px** | leaves ≥420px for nav content before it needs to scroll |

Region order top→bottom: iteration group → TOC accordion (both inside
`.panel-nav-scroll`) → status strip → CTA block. Status strip sits directly
above the CTAs so the two things the user actually needs — "what's my
status" and "what can I do about it" — are read as one visual unit, always
on screen, never contested by menu length.

Why not sticky-position the CTA within the scroll region instead of a real
flex split? Position:sticky inside an overflow:auto ancestor still lets a
very tall TOC push the sticky block's *starting offset* below the viewport
before it activates — that is exactly today's bug. A structural pin (outside
the scroll container) is the only guarantee.

## 2. Iteration group

**Collapsed (default) state** — one line, no chip list:

```
┌────────────────────────────┐
│ Iteration 7 · aktiv         │
│ 6 vorherige ▸               │
└────────────────────────────┘
```

Markup — `<details>`/`<summary>`, not a custom disclosure widget, because the
group is a plain "show archive" toggle with no roving-tabindex requirement
(unlike the TOC, which behaves like a tablist and needs `aria-expanded` +
manual focus management, see §3):

```html
<div class="iteration-group">
  <p class="iteration-current">Iteration 7 · aktiv</p>
  <details class="iteration-archive">
    <summary>6 vorherige ▸</summary>
    <nav class="iteration-tabs" role="tablist" aria-label="Iterationen">
      <button class="iteration-tab" role="tab" data-iteration="1" aria-selected="false">Iteration 1</button>
      ...
      <button class="iteration-tab" role="tab" data-iteration="7" aria-selected="true">Iteration 7 · aktiv</button>
    </nav>
  </details>
</div>
```

Expanded: `<summary>` flips to "6 vorherige ▾", the existing `.iteration-tabs`
chip list renders below it, unchanged (same `role="tablist"`, same click
behavior). This reuses `.iteration-tab` CSS verbatim — no new chip styling.

**Reality-check / final-report chips** stay inside the same list (they are
iteration-shaped rows already), but get a small leading glyph so they read
as different in kind, not just numbered: `🔍 Realitäts-Check` and
`📄 Abschlussbericht`. No new CSS class needed — an `::before` on
`.iteration-tab[data-kind]` covers it.

**Viewing a frozen round.** The collapsed summary line becomes the
"where am I" readout — it must never just say "Iteration 7 · aktiv" while
the user reads iteration 3:

```
┌────────────────────────────┐
│ 🕘 Iteration 3 (Archiv)      │
│ ↩ Zur aktuellen Runde (7)   │
│ 6 vorherige ▾                │
└────────────────────────────┘
```

- `.iteration-current` swaps text via the existing `viewing-frozen` body
  class (already set by `showIteration()`) — no new JS state machine, just
  a new render branch reading `body.classList.contains('viewing-frozen')`.
- The archive `<details>` auto-opens (`open` attribute set by
  `showIteration()`) whenever a frozen tab is active, so the round the user
  is looking at is never hidden inside a collapsed disclosure — this is the
  concrete form of the "at least one group open" invariant for the
  iteration group specifically (§3 generalizes it to the TOC).
- The "back to current round" line reuses `#back-to-live-btn`'s existing
  handler; it now lives in the nav region instead of `#panel-frozen`, so it
  is visible without scrolling past the TOC. `#panel-frozen`'s copy
  ("Eingefroren", hint) can be trimmed to just the status-strip icon (§4) —
  the escape hatch no longer needs to live in the CTA area since it's now
  pinned in the nav header.
- The floating "Zurück zur aktuellen Runde" bar (content-column dimmer veil)
  stays as-is — it's a content-column affordance, out of scope here, and
  gives a second, impossible-to-miss way back for users who scrolled deep
  into the frozen content.

## 3. TOC accordion

**What is a sub-entry?** Proposal: **auto-group by section kind**, not a new
author-facing attribute. Today's `data-nav-label` already exists on every
navigable `<section>`; kind is already inferable from what's already there:

| Group | Membership rule (existing attributes) |
|---|---|
| Kontext | sections without `data-variant` and without `data-mockup` |
| Varianten | sections carrying `data-variant` (already renders the bi-state) |
| Screens / Views | sections carrying `data-mockup` or `id` prefixed `view-`/`screen-` (convention, not enforced) |

This is the least-intrusive option of the three the brief raises: nested
`<section>`-in-`<section>` would force Claude to restructure content it
already emits flat; a bespoke `data-nav-group="…"` attribute is more
flexible but is one more thing Claude must remember to set correctly, and
gets it wrong silently (typo'd group name → orphan entry, no error). Kind
inference from attributes Claude is already required to emit (`data-variant`
is mandatory for evaluable sections per the existing bi-state contract) means
the TOC groups correctly with **zero new authoring burden** and degrades
safely: an unrecognized section always falls into "Kontext" rather than
vanishing. If a future kind needs a real opt-out, add `data-nav-group`
*only* as an override, not as the primary contract — the fallback stays
auto-inference.

**Rendered accordion**, one `<details>` per non-empty kind, in this fixed
order (Kontext, Varianten, Screens/Views) so group position is predictable
across concepts:

```html
<nav class="section-nav-accordion" id="section-nav" aria-label="Abschnitte">
  <details class="nav-group" data-nav-group="context" open>
    <summary>Kontext <span class="nav-group-count">3</span></summary>
    <div class="section-nav" role="group">
      <a class="section-nav-item" href="#ist-zustand" data-nav-label>Ist-Zustand</a>
      ...
    </div>
  </details>
  <details class="nav-group" data-nav-group="variants">
    <summary>Varianten <span class="nav-group-count">12</span>
      <span class="nav-group-badge" aria-hidden="true"></span></summary>
    <div class="section-nav" role="group">...</div>
  </details>
  <details class="nav-group" data-nav-group="screens">
    <summary>Screens <span class="nav-group-count">6</span></summary>
    <div class="section-nav" role="group">...</div>
  </details>
</nav>
```

`<details>`/`<summary>` again, for the same reason as §2: this is a
show/hide disclosure, not a tab panel — the browser gives correct keyboard
(Enter/Space toggles, native focus ring), correct AT semantics
(`role="group"` implicit, expanded state announced), and free
print/no-JS fallback (everything renders open), all without hand-rolled
`aria-expanded` bookkeeping. The one place a real `button[aria-expanded]`
would be preferable — synchronized open/close across groups for the
one-open rule — is handled in JS below without fighting the native element.

**One-open rule**, scoped to the TOC only, not across iteration + TOC (see
below for why): a `toggle` listener on each `.nav-group` closes its siblings:

```js
document.querySelectorAll('.nav-group').forEach(d => {
  d.addEventListener('toggle', () => {
    if (!d.open) return;
    document.querySelectorAll('.nav-group').forEach(o => { if (o !== d) o.open = false; });
  });
});
```

**Does "one open" span the iteration group too?** No — scope it to TOC
groups only. The iteration archive answers a different question ("which
round am I on") than the TOC ("where in this round am I"). Forcing them into
one shared exclusivity means opening the archive to check an old round's
context always collapses the current TOC, so the user loses their reading
position for no reason connected to their actual intent. Two independent
single-open zones (iteration group: 0-or-1 open; TOC: exactly 1 open) keep
each accordion's invariant legible on its own terms.

**"At least one group open" invariant** — for the TOC, guarantee it
structurally rather than defensively: whichever kind contains the current
scroll-spy target is opened by default (Kontext first if none has content
yet), and the toggle handler above only ever closes siblings, never the one
being opened — there is no code path that closes the last open group,
because closing happens exclusively as a side effect of opening another one.

**Scroll-spy into a collapsed group.** The brief's tension — auto-expand
fights "user collapsed it on purpose" — is real but asymmetric: a user who
deliberately collapsed "Varianten" did so to stop seeing *entries*, not to
stop the page from telling them where they are. Resolution: auto-expand on
scroll, but only when the user did not just manually collapse that specific
group in the last few seconds — track `data-user-collapsed-at` (timestamp)
per group, set on manual toggle, and have the spy's auto-open skip a group
whose timestamp is <4s old. Practically: scrolling naturally through the
content always keeps the TOC honest; a deliberate collapse-then-immediately-
scroll-past doesn't get overridden mid-gesture. The active item's badge
(bi-state) still updates even while its group is collapsed — see next
paragraph — so nothing is silently stale even in the rare case auto-expand
is suppressed.

**Bi-state badge when active section's group is collapsed.** Move the
live-state pill from the entry onto the group `<summary>` as an aggregate
dot, so collapsing never hides a decision the user needs to see was already
made:

```
▸ Varianten (12)  ● 3 offen
```

`.nav-group-badge` renders a count of un-decided (`state-undecided`) entries
in that group; 0 remaining renders nothing (quiet by default — only surface
what needs attention). This is a strict improvement over today's flat list,
where an undecided variant 20 rows down is invisible until scrolled to.

## 4. Status strip

A single fixed-height row, 3–5 icon slots, each `button[aria-describedby]`
or plain `span[title][aria-label]` (no click target unless the slot itself
is actionable, e.g. "reconnect"). Order left→right = rough causal order
(editing → saved → connection → submission); frozen is a modifier that
replaces the row content entirely rather than adding a 5th slot, since it
excludes editing/submission concerns.

```
┌────────────────────────────┐
│ ✎ ✓ ● ⏳                     │  ← normal, unsubmitted, connected, idle
└────────────────────────────┘
```

| Slot | Glyph | Shown when | Hidden when |
|---|---|---|---|
| Edit/dirty | `✎` (dirty) / `✓` (clean, draft saved) | always — swaps between the two | never; this is the "is my work safe" anchor |
| Storage target | `☁` (bridge-synced) / `⌫` (local-only, bridge unreachable) | draft exists | no draft yet (fresh page) |
| Connection | `●` connected / `◐` connecting (pulsing) / `○` disconnected | always | replaced by frozen glyph in frozen view |
| Submission | `⏳` working / `🔍` reality-check / `✅` implemented | after first submit | before first submit (no noise pre-submission) |
| Frozen | `🕘` | viewing an old round | live round |

Concretely this collapses to **at most 4 visible slots at once** (frozen
replaces connection+submission, since neither applies to read-only history):

- **Editing / unsaved**: dirty (`✎`) vs. clean (`✓`). Title/aria-label:
  DE "Ungespeicherte Änderungen" / "Alle Änderungen gespeichert"; EN
  "Unsaved changes" / "All changes saved".
- **Draft saved (local vs. bridge)**: `☁` vs `⌫`. DE "Im Hintergrund an
  Claude gesendet" / "Nur lokal gespeichert — Verbindung fehlt"; EN
  "Synced to Claude in the background" / "Saved locally only — no
  connection". This is the slot that answers "is it safely saved" — the
  brief's #1 complaint — so it's the one guaranteed to always render a
  non-neutral state (never blank).
- **Connection**: `●`/`◐`/`○`, replaces `.connection-pill`'s role 1:1, same
  `[data-state]` values so `checkClaudeConnection()` needs no rewrite — only
  its render target changes. DE "Verbunden" / "Verbinde…" / "Getrennt"; EN
  "Connected" / "Connecting…" / "Disconnected".
- **Submission**: `⏳`→`🔍`→`✅`, replacing the vertical `.status-steps` list's
  *summary* only — the full step list still exists, but as the tooltip
  content (`title`) of this one slot rather than 4 always-visible rows.
  DE "Claude verarbeitet" / "Realitäts-Check läuft" / "Implementierung
  abgeschlossen"; EN "Claude is working" / "Reality check running" /
  "Implementation complete".
- **Frozen**: `🕘`, replaces connection+submission slots while active. DE
  "Nur Ansicht — historische Runde"; EN "Read-only — historical round".

Why icon strip over single-line text: in a 240px-wide column, one text
status can only ever say one thing at a time, and the brief names at least
three independent axes (saved? connected? submitted?) that can be true or
false in any combination — e.g. "saved locally, disconnected, still
editing" is a real, common state a single sentence would have to either
truncate or rotate through, both worse than four always-visible glyphs with
on-demand detail in the tooltip. Icons carry the "at a glance" read; the
`title`/`aria-label` carries the "what exactly" read for anyone who hovers,
tabs to it, or uses a screen reader — nothing is icon-only.

```css
.status-strip { display: flex; gap: .6rem; align-items: center;
  padding: .5rem 0; border-top: 1px solid var(--border-color); font-size: 1rem; }
.status-strip [data-state="disconnected"] { color: var(--warning-color); }
.status-strip [data-state="connected"] { color: var(--success-color); }
.status-strip [data-dirty="true"] { color: var(--warning-color); }
```

## 5. CTA block — compressed

Today: `submit-btn` + hint paragraph + mandatory `2rem` gap + `implement-btn`
+ warn hint = ~4 stacked text lines plus a bare 2rem spacer, easily 180px+.

Compressed layout, same two buttons, hints collapsed to one shared line and
the misclick gap kept but *earned* by real content instead of a bare
spacer:

```
┌────────────────────────────┐
│ [ Zur nächsten Iteration ] │  ← primary, full width
│  ⓘ kein Code wird geschrieben
│                             │
│ [ ⚠ Mit Feedback           │  ← secondary, outline
│    implementieren ]        │
└────────────────────────────┘
```

- Primary button keeps its one-line hint (`class="hint"`, ~14px) directly
  under it — this is the hint users read *before* clicking, so it must
  stay visible, not become a tooltip.
- The secondary button's hint ("Claude setzt die Auswahl jetzt in echte
  Änderungen um.") moves into the button's own `title` + `aria-label` and a
  `⚠` glyph already inside the button label — the warning is already
  encoded in the button's own text and color (`--warning-color` outline),
  so the paragraph was reinforcing, not adding, information. Screen reader
  users still get it via `aria-label` on the button.
- The gap shrinks from a bare `2rem`/`32px` spacer to `1.25rem`/`20px` — the
  primary hint line above the secondary button now occupies visual space
  that used to be dead air, so the *effective* distance the mouse travels
  from "primary button center" to "secondary button top" is roughly
  unchanged even though the raw CSS gap value is smaller. The deliberate
  barrier is preserved by geometry, not by an oversized empty div.
- Disconnected cache hint (`hint-cache`) becomes a single inline badge
  appended to whichever button was just clicked: `⏳ gecached` next to the
  button label, rather than a separate paragraph — same information, one
  fewer line.

```css
.panel-cta { padding-top: .75rem; }
.panel-cta .hint { margin: .3rem 0 0; font-size: .78rem; color: var(--text-secondary); }
.panel-cta .submit-gap { height: 1.25rem; }
```

Net: CTA block goes from ~5 text nodes across ~180px to 2 buttons + 1 hint
line across ~140px, while keeping every piece of information (just moved
into `title`/`aria-label` or inline badges instead of stacked paragraphs).

## 6. Smallest case (1 iteration, 3 sections)

With one iteration and three sections the accordion machinery must not
manufacture chrome that isn't earned:

- **Iteration group**: the `<details class="iteration-archive">` is **not
  rendered at all** when iteration count is 1 — `showIteration()`/page
  build already knows the count. "Iteration 1 · aktiv" renders as plain
  text, no summary/toggle, no `▸`. Empty disclosures that expand to nothing
  are worse than no disclosure.
- **TOC accordion**: with 3 sections, if they're all one kind (e.g. all
  "Kontext", no variants), render **zero** `<details>` wrapper — just the
  flat `.section-nav` list, exactly like today. The accordion only appears
  once there are ≥2 non-empty kinds; one group with a toggle that always
  shows everything is a toggle that does nothing, so it's suppressed by the
  same "only render if it groups something" rule as the iteration group.
- Net effect: the smallest case's nav region is a 3-line flat list, ~90px —
  the whole panel above the status strip is under 150px tall, i.e. the
  redesign doesn't add a single pixel of chrome for a case that never had
  a scrolling problem to begin with. This is the direct rebuttal to "does
  this over-engineer the small case" — the anatomy degrades by omission,
  governed by one shared rule (§3/§2: "a group renders only if it has ≥2
  siblings to distinguish"), not by two separate special cases.

```
┌────────────────────────────┐
│ Iteration 1 · aktiv         │
│ Ist-Zustand                 │
│ Ziel                        │
│ Vorschlag                   │
├────────────────────────────┤
│ ✎ ☁ ●                       │
├────────────────────────────┤
│ [ Zur nächsten Iteration ] │
│  ⓘ kein Code wird geschrieben
│ [ ⚠ Mit Feedback impl. ]   │
└────────────────────────────┘
```

## 7. Mobile (<768px)

Today the panel already collapses to a sticky bottom bar (`position: sticky;
bottom: 0`, full width). At that width, only two things survive as
always-visible chrome; everything else becomes an on-demand sheet:

- **Status strip** — stays, unchanged, as the top row of the bar. It's the
  cheapest, highest-value signal and fits in one row at any width.
- **CTA block** — stays, but the two buttons go side-by-side
  (`flex-direction: row`) instead of stacked, since vertical space is now
  the scarce resource, not horizontal. The misclick gap becomes a `1px`
  vertical divider between the two buttons plus distinct colors (accent
  fill vs. warning outline) — on mobile a horizontal gap of the desktop's
  size would push the bar past a comfortable thumb-reach height, so the
  barrier shifts from "distance" to "visually distinct target + explicit
  warning icon," which is the same trade browsers make for iOS destructive-
  action sheets.
- **Iteration group + TOC accordion** — collapse into a single "▸ Navigation"
  disclosure row between the status strip and the CTAs; tapping it expands
  the bar upward (`max-height` transition, scrollable) to show the same
  two accordions stacked, capped at ~60vh so the CTAs never leave the
  screen even mid-navigation. This is the mobile-specific form of §1's
  invariant: nav content is the thing that yields, chrome (status + CTA)
  never does.
- **Frozen-view back link** — surfaces as a full-width banner replacing the
  status strip row while frozen (not an extra row — mobile has no budget
  for both), reusing the same `viewing-frozen` class check as desktop.

```
┌──────────────────────────────┐
│ ✎ ☁ ●            ▸ Navigation │
│ [ Nächste It. ] │ [ ⚠ Impl. ] │
└──────────────────────────────┘
```

## Summary of contract changes for Claude (page author)

1. No new required attribute. TOC grouping is inferred from `data-variant`
   / `data-mockup` / `id` prefix, already-required or already-conventional.
2. Iteration count and TOC-kind count each gate whether their accordion
   wrapper renders at all (§6) — page-build logic, not a new template
   variable.
3. `.status-steps` list markup is unchanged; it moves to living inside the
   status-strip submission slot's `title`, so JS that sets `data-state` on
   `<li>` elements (`submitWithAction`, `checkClaudeConnection`) needs no
   rewrite — only the render target of the *summary* state changes.
4. `.connection-pill`'s `[data-state]` contract is reused verbatim by the
   status-strip connection slot.
