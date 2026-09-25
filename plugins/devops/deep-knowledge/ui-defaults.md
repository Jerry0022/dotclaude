# UI Defaults

Standing UI conventions every project using the devops plugin gets by default.
The same recurring defects — tooltips and scrollbars left at the browser's
look, icon buttons without tooltips, dropdowns left at the native look,
spacing that differs between two identical cards, actions that only a mouse
can reach, layouts that only work on the developer's own desktop — show up
in every new project. This file names the outcome each rule expects so that
it is in context **while the UI is written**, and is checked **after** it is written by `/auto-polish`.

Three readers, one source:

| Reader | When | What it does with the rules |
|---|---|---|
| `post.design.remind` hook + `agents/frontend.md` / `agents/designer.md` | The moment a UI file is written | Prevention — the rules are in context before the element exists |
| `/auto-polish --invoked-by=ship` (called from `/do-ship` Step 1e) | Every ship whose diff touches UI files | Measurement — **static** halves only, diff files only, report-only |
| `/auto-polish` (direct, `/auto-agents`, `/do-run autonomous`) | A polish pass with a browser | Full check — static **and** runtime halves, whole scope |

## The rules

Each rule has a **static** half (checkable from the diff, no browser) and a
**runtime** half (needs the rendered app). The ship path checks only the
static half; the runtime half belongs to a full `/auto-polish` pass.

**R0 is part of every rule** — the built-in ones below and every rule a
project adds in its override — unless that rule explicitly says otherwise.
No rule repeats it.

### 0 · App style — part of every rule

- **Outcome:** every element the app shows is drawn in the app's own style —
  its tokens for surface, text colour, border, radius, typography, elevation
  and motion, in every theme the app ships. The browser's or OS's default
  look is never the finished state.
- **Static:** new or changed code draws no platform-native UI — a `title`
  tooltip (R1), a bare `<select>` / `<datalist>` popup (R2a), a default
  scrollbar (R5), `alert()` / `confirm()` / `prompt()`, an unstyled checkbox /
  radio / range / date / time / colour / file input, a focus ring removed
  (`outline: none`) without an app-styled `:focus-visible` replacement.
  Colours, radii, shadows and fonts in new styles come from tokens, not
  literals, and `color-scheme` follows the active theme so whatever the
  platform still draws matches light/dark. Where the app has no styled
  equivalent yet (no tooltip component, no dialog, no scrollbar style), the
  finding is raised **once per project** ("add an app-styled X"), never once
  per element.
- **Runtime:** each covered element in its visible state — tooltip open, menu
  open, scrollbar showing, dialog open, control focused — is screenshotted in
  every theme next to a card or dialog of the app: same surface, border,
  radius, type and shadow family; nothing renders in the platform's default
  look.
- **Fix policy:** a literal with a clean token equivalent is swapped
  (mechanical). Replacing a native construct with the app's own component is
  report-only on the ship path. The prevention readers (hook, `frontend` /
  `designer` agents) build or theme the missing component **before** they
  write the first element that needs it.

### 1 · Tooltips

- **Static:** every new or changed interactive element without visible text
  (icon button, toggle, chip action, drag handle) has a tooltip through the
  project's app-styled tooltip component — see § Detection allowlist. A native
  `title` attribute does not count: it renders in the OS look, its delay
  cannot be set and it never opens on keyboard focus. `aria-label` stays the
  accessible name; it is not a tooltip. A project without an app-styled
  tooltip component gets one project-level R0 finding, not one per element.
- **Delay — two tiers, long is the default:**

  | Tier | Delay | Use when |
  |---|---|---|
  | **Info** (default) | 1500 ms | The element can be understood and operated without the tooltip: descriptions, hotkey hints (R4), tips, tutorial-style explanations |
  | **Label** | 500 ms | Only when one criterion holds: (a) the tooltip is the element's only name — an icon-only control whose icon is not a universal convention; (b) it shows content that is cut off on screen (truncated text) or a value the user is inspecting (chart point); (c) it says why a control is disabled or unavailable |

  Both tiers: once a tooltip has closed, the next one opens **instantly** when
  another trigger is entered within 300 ms (skip delay); keyboard focus opens
  the tooltip instantly; the pointer can move onto the tooltip without it
  closing, and it stays until hover/focus leaves or Escape is pressed (WCAG
  2.2 SC 1.4.13 — dismissible, hoverable, persistent); on touch it opens on
  long-press, never on the tap that triggers the action. The tiers live in
  the tooltip component (default Info); call sites pick a tier, never a raw
  delay number. A project may change the two values (`tooltip.delay`, §
  Project override), not the rule that Info is the default and Label needs a
  criterion.

  Why these values: the tiers map the two schools of existing systems onto
  content. Systems that treat a tooltip as the label open fast (Windows
  `TTDT_INITIAL` 500 ms; NN/g: wait 0.3–0.5 s before revealing hover
  content); systems that treat it as supplementary help open late (React Aria
  `TooltipTrigger` 1500 ms). The skip delay is Radix's `skipDelayDuration`
  (300 ms). None of the checked systems uses 2 s.
- **Static (delay):** a finding when a tooltip that meets none of (a)–(c) uses
  the Label tier or a short delay, when a call site sets a raw delay number,
  or when the tooltip component does not carry the two tiers.
- **Runtime:** an Info tooltip opens at ~1.5 s and a Label tooltip at ~0.5 s
  (±150 ms); the next tooltip opens instantly within the skip window; focus
  opens it; the pointer can move onto it; Escape closes it.
- **Fix policy:** report-only. An auto-fix may add a tooltip only when its text
  is mechanically derivable from an existing label (`aria-label`, visible
  neighbour label, i18n key) — through the app's tooltip component, never
  `title`. Never invent help text; the tier is a design judgement.

### 2 · Dropdowns and menus

- **Static (a) — styled, not native:** when the project has a menu/select
  component, no new or changed dropdown uses the bare native `<select>` /
  OS-default menu, and no menu is "themed" by changing a single colour while
  trigger and items ignore the tokens the rest of the app uses (background,
  border, radius, hover surface).
- **Static (b) — uniform item structure:** within one menu, every item shares
  the same slot structure — icon on all items or on none, description line on
  all or none, the same item component/class throughout. One item that
  deviates is a finding.
- **Runtime:** the open menu visually belongs to the app (surface, border,
  radius, hover state match other elevated surfaces); the information depth
  per item matches the item's complexity — a designer judgement, reported,
  never auto-fixed.

### 3 · Spacing

- **Static:** the same component type (card, list row, form row, dialog
  footer, toolbar) uses the same spacing tokens/values as its siblings in the
  diff files. A deviation without a justification comment is a finding.
  Math and thresholds come from `harden-polish-shared.md` § 3 (median + IQR
  for ordinal values, token-anchoring first). Only the diff files form the
  histogram — never the whole repository. Auto-snap only with a token catalog
  and ≤ 3 outliers; otherwise report.
- **Runtime:** interactive targets keep a minimum hit area (44 px on touch
  form factors) and adjacent actions do not touch; verified across the
  R6 platform matrix.

### 4 · Hotkeys and keyboard operability

- **Static:** every new or changed interaction or selection (button, tab,
  menu item, dialog action, list selection) has a key binding through one of
  the project's hotkey mechanisms (§ Detection allowlist) **and** shows it
  discreetly where it visually fits — a `<kbd>` badge, an underlined
  mnemonic letter, a right-aligned `⌘K` in the control — or, where that does
  not fit, states it clearly in the tooltip. Two elements in one view bound
  to the same key is a finding. **Fix policy: report-only** — choosing the
  key is design.
- **Runtime:** every flow is completable without a mouse: sensible focus
  order, Escape closes, Enter confirms, arrow keys move within lists and
  menus, a visible focus ring. Checked by a tab-walk + accessibility snapshot
  in a full `/auto-polish` pass. The goal is an app that is fully keyboard
  operable wherever the platform allows.

### 5 · Scrollbars

- **Static:** the project styles its scrollbars once, globally, from tokens —
  `scrollbar-color` (thumb, track) and `scrollbar-width`, a
  `::-webkit-scrollbar` block as fallback for engines without the standard
  properties, and `color-scheme` per theme. New or changed scroll containers
  (`overflow: auto` / `scroll`, virtual lists, code blocks, textareas, menus,
  dialogs) inherit it; a local scrollbar style that diverges from it, or
  scrollbar colours as literals, is a finding. No global scrollbar style yet
  → one project-level R0 finding the first time a diff adds a scroll
  container.
- **Runtime:** every visible scrollbar — page, side panels, menus, dialogs,
  code blocks, textareas — matches the app in every theme (no light default
  bar inside a dark UI), the thumb stays visible against the track (with a
  hover state where the engine draws one — engines that honour
  `scrollbar-color` ignore `::-webkit-scrollbar-thumb:hover`), nested
  containers never show two bars side by side, and content does not jump
  when a bar appears (`scrollbar-gutter: stable` where the content height
  toggles).
- **Fix policy:** report-only — thumb and track colours are design.
  Mechanical only when the project already has scrollbar tokens.

### 6 · Platform matrix — every target, every change

- **Outcome:** design **and** interactions are tuned — visually, in UX and in
  function — for every platform the app runs on, not just the one it was
  built on. A change is not done until it has been checked on each target of
  the matrix:

  | Target | Viewport (`responsive-testing.md` preset) | Primary input |
  |---|---|---|
  | Windows desktop | `desktop` 1280 × 800 | mouse + keyboard (hover, right-click, `Ctrl` shortcuts) |
  | Linux desktop | `desktop` 1280 × 800 | mouse + keyboard; other font stack and scrollbar/GTK look than Windows |
  | Android tablet | `tablet-android` 800 × 1280, plus landscape | touch, optional hardware keyboard |
  | iOS tablet (iPad) | `tablet-ios` 768 × 1024, plus landscape | touch, optional hardware keyboard / pointer |
  | Android phone | `mobile-android` 393 × 851 | touch, on-screen keyboard |
  | iOS phone | `mobile-ios` 375 × 667 | touch, on-screen keyboard, safe-area insets |

  A project that provably does not ship to a target (a desktop-only Electron
  tool, a phone-only PWA) narrows the matrix through the override
  (`platforms:`, § Project override); the narrowed matrix is named on the
  card like a disabled rule.
- **Static:** new or changed UI has no construct that only works on one row
  of the matrix: an action reachable **only** by hover, right-click,
  double-click or a keyboard shortcut without a touch path (tap, long-press,
  visible button); hover styles outside `@media (hover: hover)`; a fixed
  width / `min-width` wider than the phone viewport without a breakpoint;
  `100vh` for a full-height layout (use `100dvh` / `svh`); no
  `<meta name="viewport">` on a web entry page; iOS form inputs below 16 px
  font size (Safari zooms on focus); edge-anchored bars without
  `env(safe-area-inset-*)`; a font stack that names only a Windows or macOS
  font without a generic fallback (Linux renders the default serif);
  shortcut hints hard-coded to one OS (`Ctrl` vs `⌘`) instead of derived from
  the platform.
- **Runtime:** every changed view is walked on each target of the matrix —
  layout (no horizontal page scroll, nothing clipped, hit areas per R3,
  readable type), interactions (tap, long-press, swipe, drag on touch;
  hover, right-click, keyboard per R4 on desktop; the on-screen keyboard
  never covers the focused input) and function (the flow completes, same
  result on every target). Emulate with the browser tool's viewport/touch
  emulation (`responsive-testing.md`); what emulation cannot show — real
  Linux font rendering and scrollbars, iOS Safari quirks, native share /
  file pickers — goes to `userFinalTest` with the target named, never
  silently assumed.
- **Fix policy:** mechanical only for a missing viewport meta tag,
  `100vh` → `100dvh` and a hover style wrapped in `@media (hover: hover)`;
  everything else (a touch path for a hover-only action, a breakpoint
  layout) is report-only — it is design.

## Common rules

- **New or changed elements only** on the ship path. Existing elements are the
  domain of a full `/auto-polish` (and, for spacing tokens, `/auto-harden`
  Step 8). This keeps the check inside the branch's own scope and away from
  `/auto-harden`'s hard-never rule ("add tooltips where none existed").
- **Skip silently** when the diff touches no UI file (§ UI file detection),
  when the project has no UI profile (`test-autonomy.md` profiles `cli-node`,
  `lib`, `generic`), or in `file-only` mode. A skipped check leaves **no**
  card entry. A `files:` glob in the project override counts as a UI profile
  for the files it names — that is how a CLI or plugin repo opts its own UI
  sources in.
- **Priority on conflict:** a more recent project-specific convention from
  merged PRs (the `/do-ship` Step 1d purpose-alignment sources) beats a generic
  rule from this file. "Tooltips removed from the toolbar because they got in
  the way" is a decision, not a defect.
- **Never blocks a ship.** Findings feed `/do-ship` Step 1e's semantics:
  mechanically fixable → fixed, listed under `changes`; everything else →
  `userFinalTest`. Under `$SHIP_LOCKOUT` findings are recorded and the ship
  continues.
- **A disabled rule is visible.** When a project override disables a rule,
  the ship card's `tests` line names it ("UI rules: R2 disabled by project
  override") so a silent opt-out cannot hide.
- **The plugin's own surfaces too.** Concept pages (`auto-concept`
  templates.md § App Tooltips and § Layout CSS → Scrollbars), the
  completion-card widget and the `/auto-guide` overlay follow every rule
  here. The reminder hook covers generated concept pages like any page, and
  the plugin-source repo opts the templates that generate them in through its
  own `## UI rules` override.

## Detection allowlist (defaults)

The static halves need to know which constructs count as "has a tooltip",
"has a hotkey" or "looks native". These defaults cover the common stacks; a
project extends or replaces them (§ Project override).

| Concern | Recognised by default |
|---|---|
| Tooltip mechanisms (app-styled) | `matTooltip`, `[tooltip]`, `v-tooltip`, `<Tooltip>` / `TooltipTrigger` wrappers (MUI, Radix, shadcn, Chakra, Ant, React Aria), a project tooltip component under `components/`; `data-tooltip` / `data-tip` only when a project stylesheet or script renders them |
| Tooltip delay props | `delay` / `closeDelay` (React Aria), `delayDuration` / `skipDelayDuration` (Radix), `enterDelay` / `enterNextDelay` (MUI), `matTooltipShowDelay`, `showDelay` / `hideDelay` (Fluent), `openDelay` (Chakra) |
| Native look (R0 findings) | `title="…"` — or a framework `title` prop that renders it — as the only tooltip route, bare `<select>` / `<datalist>`, `alert(` / `confirm(` / `prompt(`, unstyled `<input type="checkbox\|radio\|range\|date\|time\|color\|file">`, `outline: none` / `outline: 0` without a `:focus-visible` replacement |
| Scrollbar styling | `scrollbar-color`, `scrollbar-width`, `scrollbar-gutter`, `::-webkit-scrollbar*`, `color-scheme`, a scroll-area component (Radix / shadcn `ScrollArea`, OverlayScrollbars, SimpleBar) |
| Hotkey mechanisms | `accesskey`, `useHotkeys(` / `useKeyboardShortcut(`, `@HostListener('window:keydown` / `document:keydown`, `v-hotkey`, `Mousetrap.bind(`, `hotkeys(`, a project shortcut registry (`registerShortcut(`, `shortcuts.ts`, `keymap.*`), `<kbd>` inside the control |
| Menu components | `<mat-menu>`, `<Menu>` / `DropdownMenu` / `Popover` (MUI, Radix, shadcn, Headless UI, Ant), `<v-menu>`, `<el-dropdown>`, `<Dropdown>` (Bootstrap), a project `Menu`/`Dropdown` component under `components/` |
| UI file detection | `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.html`, `*.css`, `*.scss`, `*.sass`, `*.less`, `*.styled.*`, `*.component.*`, `*.razor`, `*.xaml`, `*.axaml` |

## Project override

Consumers extend or replace any of the above through the `/auto-polish`
extension — `{project}/.claude/skills/auto-polish/reference.md` (project) or
`~/.claude/skills/auto-polish/reference.md` (user-global), section `## UI
rules`. The hook, the ship path and the full polish pass all read the same
section:

```markdown
## UI rules
- disable: R2b, R4          # rule ids: R0, R1, R2a, R2b, R3, R4, R5, R6 (static halves) — a disabled rule is named on the ship card
- tooltip.mechanisms: appTooltip, <HelpHint>
- tooltip.delay: info 1200, label 400   # ms, the two R1 tier values; project beats user-global
- hotkey.mechanisms: useShortcut(, data-hotkey
- platforms: windows, linux, android-tablet, ios-tablet   # narrows the R6 matrix; default: windows, linux, android-tablet, ios-tablet, android-phone, ios-phone
- menu.components: <AppMenu>, <ContextMenu>
- files: src/renderer/**/*.ts   # extra UI file globs
- Icon-only buttons in the title bar are exempt from R1 (platform chrome).
- All list rows use `--space-3` vertical rhythm; `--space-2` only inside dense tables.
```

Free-form bullets after the keyed lines are additional rules in the
project's own words; they are checked like the built-in ones — and R0 is
part of them too.
