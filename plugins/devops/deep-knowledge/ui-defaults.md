# UI Defaults

Standing UI conventions every project using the devops plugin gets by default.
The same recurring defects — icon buttons without tooltips, dropdowns left at
the native look, spacing that differs between two identical cards, actions
that only a mouse can reach — show up in every new project. This file names
the outcome each rule expects so that it is in context **while the UI is
written**, and is checked **after** it is written by `/auto-polish`.

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

### 1 · Tooltips

- **Static:** every new or changed interactive element without visible text
  (icon button, toggle, chip action, drag handle) carries one of the project's
  tooltip mechanisms — see § Detection allowlist. A project with **zero**
  detected tooltip mechanisms makes this rule *not applicable*, never *failing*.
- **Runtime:** the tooltip appears after a short delay (300–700 ms), not on
  the first pixel of hover; it disappears on mouse-out and on Escape.
- **Fix policy:** report-only. An auto-fix may add a tooltip only when its text
  is mechanically derivable from an existing label (`aria-label`, visible
  neighbour label, i18n key). Never invent help text.

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
  `/auto-polish` viewport matrix.

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

## Common rules

- **New or changed elements only** on the ship path. Existing elements are the
  domain of a full `/auto-polish` (and, for spacing tokens, `/auto-harden`
  Step 8). This keeps the check inside the branch's own scope and away from
  `/auto-harden`'s hard-never rule ("add tooltips where none existed").
- **Skip silently** when the diff touches no UI file (§ UI file detection),
  when the project has no UI profile (`test-autonomy.md` profiles `cli-node`,
  `lib`, `generic`), or in `file-only` mode. A skipped check leaves **no**
  card entry.
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

## Detection allowlist (defaults)

The static halves need to know which constructs count as "has a tooltip" or
"has a hotkey". These defaults cover the common stacks; a project extends or
replaces them (§ Project override).

| Concern | Recognised by default |
|---|---|
| Tooltip mechanisms | `title="…"`, `aria-label="…"` (as a screen-reader fallback only when the element also has a visual tooltip route), `matTooltip`, `[tooltip]`, `v-tooltip`, `data-tooltip`, `data-tip`, `<Tooltip>` / `TooltipTrigger` wrappers (MUI, Radix, shadcn, Chakra, Ant), `title` prop on framework buttons |
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
- disable: R2b, R4          # rule ids: R1, R2a, R2b, R3, R4 (static halves) — a disabled rule is named on the ship card
- tooltip.mechanisms: appTooltip, <HelpHint>
- hotkey.mechanisms: useShortcut(, data-hotkey
- menu.components: <AppMenu>, <ContextMenu>
- files: src/renderer/**/*.ts   # extra UI file globs
- Icon-only buttons in the title bar are exempt from R1 (platform chrome).
- All list rows use `--space-3` vertical rhythm; `--space-2` only inside dense tables.
```

Free-form bullets after the keyed lines are additional rules in the
project's own words; they are checked like the built-in ones.
