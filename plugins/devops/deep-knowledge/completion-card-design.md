# Completion Card — Design Specification (v2, "one page, three lines, one decision")

Single source of truth for how a completion card looks and reads, on every
client, for every variant. Decided on the concept page
`docs/concepts/2026-09-20-completion-card-one-page.html` (11 rounds,
2026-09-20). The renderer (`mcp-server/index.js`), the Desktop widget
(`mcp-server/lib/card-widget.js`), the guards (`hooks/lib/card-guard.js`,
`hooks/stop/stop.flow.guard.js`) and the session-title hook implement this
document; when they disagree with it, this document wins.

## 1. Why

The old card had to be scrolled to be read: a `Changes` block with file
names, a `Geprüft` block with five checkmarks, `⚠ OFFEN` in the middle,
the usage meter between body and footer, a build line, a state line, a CTA
heading — and buttons *above* it all. At the end nobody read more than
three lines, and those were technical. The new card is built for the reader:
one page, three result lines that answer the prompt, one decision.

## 2. Anatomy (top to bottom)

Two visual blocks. Nothing between them, nothing under the second one.

```
&nbsp;
---
### **✨✨✨ {title} ✨✨✨**                 ← markdown, every client (card-guard marker)
› result line 1                            ┐
› result line 2                            │  Block 1 · "what happened"
› result line 3                            │  (Desktop: top of the one surface)
✓ 3/3 Anforderungen  ✓ 3464 Tests grün  ✓ 4 Live-Checks ok     ← evidence row
○ commit → ○ push → ○ PR → ○ merge · branch · Build 176c57d       ← pipeline line
5h [time bar | usage marker] 3 h 39 m   Wk [...] 6 d 20 h   🧠 1180 Calls · /compact  ┘ budget (footer)
## 📦 {decision as a question}?            ┐
› one context line (optional)              │  Block 2 · "what to decide"
1. reservation / test step                 │  (Desktop: quiet accent-tinted box)
2. reservation / test step                 │
[Ship ↗] [Ändern ↗]                        ┘  (Desktop widget only; terminal: nothing)
---
```

### 2.1 Title

- `### **✨✨✨ … ✨✨✨**` stays exactly as today in the terminal — it is the
  marker the card-guard detects. Bold H3. On Desktop, where the widget is the
  whole card, no markdown is output at all (§ 4): the guard reads the
  card-body `show_widget` call instead. (Both hidden markers tried before —
  an HTML comment, #443, and a `[//]: #` definition, #470 — rendered as
  literal text in the Desktop chat.)
- Content: the **outcome** of the turn, ≤ 60 chars. Never status ("agents
  running", "waiting", "pending", "noch nicht") — status belongs in the
  decision heading. Never a version or pipeline word ("gemergt", "shipped").
- When something was NOT achieved the title says so: "… — Resume-Pfad noch offen".

### 2.2 Result lines (`›`)

- **Max three**, each ≤ 120 chars, written as `› ` + text (no bullets, no
  blockquote). A fourth line becomes `+1 weitere` on the last line, never dropped silently.
- Each line names an **effect for the user**, never a file, function or hook
  as subject. Names may appear as `code` at the END of a line
  ("… steht als `stale`"). "budget.js → Refresh-Zyklus" is forbidden.
- Wording by intent class: Feature → new behaviour · Fix → symptom gone, cause
  in a half-sentence · Analysis → finding + recommendation · Ship → what is
  live where.
- **A deviation is line 1**, bright, prefixed `**Nicht erreicht:**` /
  `**Not achieved:**` (red tests, unbuilt part, cut scope, aborted reason).
  Never hidden in the evidence row, never parked as an open point.
- The `Changes` block is gone. On Desktop the app shows the file list itself;
  in the terminal the pipeline line (branch, build) is enough. Files are
  never listed on the card.

### 2.3 Evidence row

Always the same three posts, always in this order, one row, two spaces
between posts, no `·` separators:

| Slot | Post | Source | Text pattern (number + noun + state) |
|---|---|---|---|
| 1 | Requirements | `validation[]` | `✓ 3/3 Anforderungen` · `◐ 2/3 Anforderungen` · `✗ 1/3 unerfüllt` |
| 2 | Tests | `tests[]` (test/lint/build/typecheck entries) | `✓ 3464 Tests grün` · `✗ 2 Tests rot` · `⏭ 3 übersprungen` folded into the tooltip |
| 3 | Live check | `tests[]` entry with real data / browser | `✓ 4 Live-Checks ok` · `◐ Overlay: nicht live geprüft` — after a ship: `✓ PR #416 → main` |

- **Deviations first, bright:** a `✗` or `◐` post moves to the front of the
  row regardless of slot. Green posts are dim.
- **Deviation-only posts** exist only when they have a finding, and go in
  front: `🧹 3 Warnungen` (lint), `🏗 tsc 1 Fehler` (build), `👁 Review
  übersprungen — Limit` (second opinion), `⚠ ungeprüft — kein Test lief`
  (the V&V stamp, replaces the old block under the title). A green lint /
  build / review is never shown — what is not there was fine.
- Glyphs are **monochrome text**, never emoji: `✓` met · `✗` failed · `◐`
  partial · `○` open · `●` done · `⏭` skipped. Emoji only for the three
  warning signs (§ 6).
- Released cards: slot 1–3 become the promotion facts (`✓ Tags beta/v0.179.0
  · v0.179.0`, `✓ bit-identisch mit alpha`, `✓ GitHub-Release` on stable).
- Analysis cards: `✓ 12 Dateien gelesen`, `✓ 3 Befunde belegt`.
- Widget: each post has a tooltip (after ~600 ms hover) with the details
  (`144 Dateien · 3 übersprungen · 0 rot · 41 s`; the four live checks by name).

### 2.4 Budget line

Replaces the fenced meter. Last line of block 1 — under the pipeline line;
it is the card's footer, not part of the evidence.

- **Bar = elapsed time of the window, marker = usage.** Fill colour is the
  accent lilac (`#4a5384` on the widget), track `#2b2d3a`. The marker is a
  3 px bar, taller than the track (−6 px top/bottom), drawn above every label.
- Marker colour by `usage − time` in percentage points: ≤ 10 white · ≤ 25
  yellow (`#e6c36a`) · > 25 red (`#e07a7a`). The track never changes colour.
- Remaining time as a **watermark** inside the track, right-aligned, dim
  (`#7d84a8`), 10 px: `3 h 39 m` / `6 d 20 h`.
- Labels `5h` / `Wk` before each bar; nothing after the bar. Percent, delta
  since last card, "über Plan", reset clock — all in the bar's tooltip:
  `35 % verbraucht · 27 % der Zeit um · 8 % über Plan · Reset 14:39 (in 3 h 39 m) · +2 % diese Runde`.
- A light glint (24 px, 12 % white) sweeps once every 4 s across the **filled
  part only** — never over time that has not passed; disabled under
  `prefers-reduced-motion`.
- **Omitted entirely** while both windows are < 50 % and > 1 h from reset.
- Terminal / markdown fallback: `5h ▰▰▰▰▰▰▰│▱▱▱▱▱▱ 3 h 39 m   Wk ▰▰│▱▱▱▱▱▱ 6 d 20 h`
  (▰ = time, │ = usage); a yellow/red condition is written as a leading `⚠`.
- Context health: from the tool-call threshold on, `🧠 1180 Calls · /compact`
  sits dim at the right end of the budget line. Below the threshold nothing.

### 2.5 Pipeline line ("where it lies")

Dim, small, directly under the evidence row (the budget line follows it as
the footer). Glyph BEFORE the step. Plain text — no
code spans (they would be red on Desktop). Names in the accent lilac on the widget.

```
○ commit → ○ push → ○ PR → ○ merge · claude/devops-agent-usage-refresh-263640 · Build 176c57d
✓ commit → ✓ push → ✓ PR #416 → ✓ merge   main → ✓ alpha → ○ beta → ○ stable · v0.179.0 · Build a91c3e2
```

- `○` open, `✓` done, both grey. After `merge` an em-gap, then the base branch.
- Ring projects continue the line with the channels (`→ ✓ alpha → ○ beta →
  ○ stable`). **This replaces the Delivery block / ladder.** The distance to
  the next channel ("alpha liegt 3 Versionen / 5 Tage vor beta") is the
  context line under the decision heading.
- `#416` is a quiet link on the widget: no colour, underline on hover only.
- `ready-files`: `📂 9 Dateien geändert · kein Repo · H:\notes\budget`.
- `analysis` / no changes: `➖ keine Änderungen im Repo · branch`.
- The variant-guard downgrade note ("ship-successful → ready, weil …") is a
  `›` context line under the decision heading, not a block.

### 2.6 Decision block

- **Heading = the decision as a question**, H2, with the variant's emoji.
  Derived from the most important reservation: `📦 Shippen trotz fremdem
  Testfehler?`; without reservations `📦 Shippen?`. It ends with `?` (the
  stop-hook checks that) — **except when there is nothing to decide**: then
  it is a state ending in `.` and there are no buttons (`🎊 Released v0.179.0
  LIVE.`, `📂 Fertig auf der Platte — noch etwas?` keeps the question form
  because "noch etwas" is one).
- Verb first after a ship/promotion: `🚀 Released v0.179.0 alpha — nach beta
  promoten?`, `🎊 Promoted v0.179.0 BETA — nach stable?`, `🎊 Released
  v0.179.0 LIVE — stable.` (channel word in CAPS for visibility; 🎊 for both
  beta and stable; alpha keeps 🚀).
- Optional **context line** `› …` directly under the heading, before the
  points (promote distance, alternatives after an abort, guard notes).
- **Points list**: max 3 — numbered in the markdown, `›` lines in the Desktop
  widget (same glyph as the result lines, see § 4). Contents in
  order: open reservations (`open`), then manual test steps (`userTest`,
  `userFinalTest`) prefixed `🧪` when the list mixes both, then deploy-gate
  artifacts on a deploy card. More than three → `+N weitere` appended to the
  heading and the rest written in the answer text above the card.
- **Buttons** (Desktop widget only, hidden in the terminal): the two verbs
  of the variant, primary first; each has a tooltip explaining what it
  triggers (`Fix` → "Ich repariere die zwei Tests zuerst, dann kommt die
  Card neu."; `Trotzdem shippen` → "Ship mit skipChecks — die roten Tests
  landen als Issue."). Equal height, 13px; only border/text colour differs.
- No `SHIP oder ÄNDERN` line anymore — the buttons say it. The terminal
  shows the question heading alone.

## 3. Per-variant mapping

| Variant / state | Heading (de) | Points | Buttons | Notes |
|---|---|---|---|---|
| `ready` | `📦 Shippen trotz {top reservation}?` / `📦 Shippen?` | open + final tests | Ship · Ändern | |
| `ready` + red tests / partial | `⚠ Trotzdem shippen mit 2 roten Tests?` | open (fix first) | Fix · Trotzdem shippen | ⚠ red; line 1 = Nicht erreicht |
| `ship-blocked` | `⛔ {reason} umgehen und trotzdem shippen?` | the gate's finding | Fix · Skip | ⛔ only here |
| `ship-successful` | `🚀 Released v{v} alpha — nach beta promoten?` (ring) / `🚀 Shipped v{v} → main.` (plain, no promote) | final tests | Promote / none | context line = distance to beta |
| `ship-successful` kept | `🚀 Released v{v} alpha — weiter in `{branch}`?` | — | Weiter | |
| `ship-successful` deployPending | `🚨 Gemergt, aber nicht live — Migration jetzt deployen?` | deploy artifacts | Deploy | replaces the 🚨 DEPLOY block |
| `released` → beta | `🎊 Promoted v{v} BETA — nach stable?` | — | Nach stable | evidence = promotion facts |
| `released` → stable | `🎊 Released v{v} LIVE — stable.` | — | — | state, no question |
| `ready-files` | `📂 Fertig auf der Platte — noch etwas?` | final tests | — | pipeline = file line |
| `test` | `🧪 Erst testen, dann shippen?` | userTest steps | Ship · Nachbessern | unverified part = `◐` post |
| `test-minimal` | `▶️ Läuft — viel Spaß` | — | — | title + one line + heading; no evidence, budget, pipeline, widget |
| `analysis` | `📋 Analyse gelesen — umsetzen oder Fragen?` | — | Umsetzen · Frage | pipeline = `➖ keine Änderungen` |
| `aborted` | `🚫 Abgebrochen wegen {reason} — anders versuchen?` | — | Nochmal | context line = alternatives |
| `fallback` | `🔧 Erledigt — noch etwas?` | — | — | |
| pending override | `⏳ Noch nicht fertig — {what}` | what is running | — | evidence gets `◐ Belege vorläufig` |
| concept override | by phase: `🧭 Concept wartet auf deine Entscheidungen` · `🧭 Concept in Iteration — ich melde mich` · `🧭 Concept in Implementierung — ich melde mich`; running work as its own sentence (`… in Implementierung. 2 Agenten arbeiten — …`) | the running items | — | context line = the page URL (quiet link); "wartet" during an implementation run is a regression |
| batch override | `📥 Batch sammelt — {n} Einträge` | — | — | context line = what happens to the next prompt |
| V&V unverified | `⚠ Ungeprüft shippen?` | "npm test lief nicht — …" | Tests laufen lassen · Trotzdem shippen | `⚠ ungeprüft` first evidence post |

English strings mirror these one to one (`Ship anyway despite 2 red tests?`,
`Released v0.179.0 alpha — promote to beta?`, `Promoted v0.179.0 BETA — to
stable?`, `Released v0.179.0 LIVE — stable.`, `Not done yet — {what}` …).

## 4. Desktop widget vs. terminal

- **Desktop:** the whole card is ONE `mcp__visualize__show_widget` call (the
  "card body widget"), made as the **last action of the turn, with no card
  markdown at all** — the tool result carries no markdown block, and no text
  may follow the widget. card-guard reads the card from that call instead
  (`lastAssistantCardText`: a card-body `show_widget` that ends the turn
  stands in as `✨✨✨ {title} ✨✨✨`, the title taken from the widget's h3).
  Every hidden-markdown marker tried before showed as a stray literal line
  under the widget in the Desktop chat: an HTML comment (#443) and a
  `[//]: # (…)` link reference definition (#470). (Until 0.184.0 the
  markdown was the visible title line — `&nbsp;` · `---` ·
  `### **✨✨✨ {title} ✨✨✨**` · `---` — which read as a second, empty card
  header under the widget on every turn.) The visible ✨ line stays ONLY
  off this widget path: a variant without a widget body, or a widget call
  that fails (Claude then prints the visible `### **✨✨✨ {title} ✨✨✨**`
  line), keeps the ✨ headline as before. That title line is the error
  path only, never a shortcut (#451): every Desktop render also saves the
  widget HTML to `<tmp>/dotclaude-devops-card-widget-<session>` and names
  it in the `[CARD WIDGET]` block, and `stop.flow.guard` blocks a card turn
  on which `show_widget` was never called, pointing at that file. The widget draws the
  title (h3) and both blocks, colours (green `#8fae8f` posts, red
  `#e0a0a0`, yellow `#d9c58a`, lilac code spans `#aab4e6`), tooltips (600 ms
  delay), the budget bars, the quiet PR link and the buttons. Nothing is
  drawn twice (observed 2026-09-21: widget + full markdown showed the whole
  card twice). The widget wraps result lines instead of cutting them — the
  120-char ellipsis of § 2.2 is a terminal budget, and a line cut mid-sentence
  read as "the card only shows half". `cardSignature` (§ 5.5) falls back to
  the title for such a title-only card.
- **Desktop surfaces and sizes** (feedback 2026-09-21: two bordered boxes did
  not read as one card; both titles and the detail text were a step too
  large; the grey surface tokens read "too colourless" on the dark page):
  ONE outer surface on a faint blue wash (`rgba(55,138,221,.06)`, 6 % of the
  accent blue), 12px radius, **no border**, wraps everything. Block 1 has no box of its own inside it. Block 2
  is a box at the bottom on a quiet accent wash (`--bg-accent-muted`, 10 % of
  the accent fill, fallback `rgba(55,138,221,.10)`), 10px radius, **no accent
  border**. Exactly four text sizes: `h3` 16px/500 for the title and the
  decision heading; 14px for result lines, evidence posts and points; 13px for
  the context line, the buttons (30px tall), the budget label and the pipeline
  line; 11px for the bar watermark and the context-health note. Two bordered
  boxes, an h2, or a fifth size anywhere in the widget are a regression. The
  budget sweep stays clipped to the elapsed fill (a glint over time that has
  not passed made no sense), narrow and soft so it reads as a glint, not as
  a second bar. Every `›` line (result lines, context,
  points) draws the glyph in lilac at weight 500, inset 6px from the heading
  edge and hugging its text (8px column, 4px gap), with the text in
  `--text-secondary`: the glyph leads, the line does
  not shout (feedback 2026-09-21: glyph too faint, text too loud). The widget
  never numbers the points — `1.` stays a terminal-markdown form. Block 1
  order on every variant: title → result lines → evidence → pipeline →
  budget; the pipeline line and the budget row carry their own vertical
  padding (4px) so they do not stick to the evidence row. The white frame around the whole
  widget is the Desktop app's `show_widget` container — not part of the card
  and not controllable from inside.
- The `ready-red` heading names what is actually red: `N roten Tests` only
  when tests failed, else `N unerfüllten Anforderungen`, else `N teilweise
  erfüllten Anforderungen` (an unmet requirement is no red test).
- **Terminal / other clients:** the markdown body as in § 2 without buttons;
  code spans only for error texts, names in *italics*; budget as glyph bars.
- `test-minimal` never calls the widget.
- The old CTA-actions widget (buttons above the card) is replaced by the body
  widget. The `[CTA ACTIONS]` block becomes `[CARD WIDGET]` with the same
  Desktop-only / skip-silently semantics. Controls remain `span[role=button]`.
- **Delivery (Code-tab host rules, read from its bundle 2026-09-22):**
  1. `ui/message` never sends. When it is accepted, the host puts the prompt
     into the composer (`onPrefillComposer`) and the user presses Enter. A
     widget has no path to auto-submit.
  2. The host refuses (`isError`) unless its frame has live user activation
     (about 5 s after the click in the widget) and it saw no pointer or key
     event of its own in the last 5250 ms. A click soon after typing,
     clicking or dragging the scrollbar in the app window is refused.
  3. It also refuses while the composer is not empty (text, attachments, or
     an upload in progress).
  4. It refuses a prompt whose text starts with `/` — a leading space does
     not help (observed live 2026-09-23: ` /compact …` and `/devops:ship …`
     red, `ship --no-compact` and plain sentences green). A button can
     therefore never carry a slash command. Button prompts are plain text
     that reaches the skill by its trigger words: `ship` (prompt.ship.detect),
     `promote` / `promote stable` (promote skill), `Debug …` (fix skill).
     Built-in commands like `/compact` have no such route — the card shows
     them as text. `card-widget.test.js` rejects any slash prompt.

  `sendPrompt()` drops the reply, so all of these failures were silent. That
  is the "works only sometimes" bug. The button script now posts
  `ui/message` itself and reads the reply. After a refusal or no reply
  (1 s), it posts again every 300 ms while the click's activation lasts
  (5 s), which gets past rule 2. It cannot double the prompt: once the
  composer is filled, rule 3 refuses the next post. The button then shows
  `Im Eingabefeld, Enter sendet`, or
  `Nicht übernommen, Eingabefeld leeren und erneut klicken`. There is no
  clipboard fallback. `card-widget.send.test.js` pins this behavior against
  a host simulator that applies these three rules.

## 5. Guards (stop.flow.guard / card-guard)

1. Title: no status words (`läuft`, `laufen`, `wartet`, `pending`, `noch
   nicht`, `running`, `waiting`, agent counts) → block once with the reason.
2. Result lines: ≤ 3; a line whose first token is a path / hook name
   (`\w+\.(js|md|ts|json)`, `ss\.|post\.|prompt\.|stop\.`) → block once.
3. Points: ≤ 3 on the card; more only as `+N weitere` in the heading.
4. Line budget: 14 rendered lines on Desktop (title 2, result ≤ 3, evidence
   1, budget 1, pipeline 1, heading 2, context ≤ 1, points ≤ 3) / 24 rows in
   the terminal. Overflow is cut in this order: evidence details → context
   line → pipeline names → never result lines, points or the heading.
5. Notification turns (a turn that starts from a background-task
   notification, a wake-up or a cron tick, with no user prompt) carry **no
   card obligation** when nothing changed (same variant, same build-id, same
   evidence). The card-guard blocks a second identical card. Output-style
   rule (quiet): such a turn answers with nothing.

## 6. Signs and colours

| Sign | Meaning | Where |
|---|---|---|
| `⚠` red | a reservation tied to red posts (heading) · `ungeprüft` (evidence) | heading, evidence |
| `✗` red | failed (tests, live check, preflight) | evidence, line 1 |
| `⛔` red | a ship-pipeline gate blocked | heading of `ship-blocked` only |
| `◐` yellow | partial (requirements, unverified part) | evidence |
| `✓` green (dim) | met / done | evidence |
| `○` / `●` grey | open / done | pipeline |
| lilac | code spans (names, build-id, branch), point numbers | widget only |
| red | never on names, branch or build-id | — |

Yellow/red on the budget marker follow § 2.4, independent of the above.

## 7. Session title prefixes

`⏳` (icon only, no word) is set by `prompt.flow.title-work` on every prompt
that starts work, in place of the former `🔧`; the card's session-title note
replaces it with the result prefix at turn end. Every card variant maps to a
prefix — the full set: `🚀 Shipping – `, `🚀 Shipped – `, `🎊 Released Alpha /
Beta / Stable – `, `📦 Ready – `, `⛔ Blocked – `, `🧪 Test – `, `▶️ Started – `,
`📋 Analysis – `, `🚫 Aborted – `, `🧭 Concept – ` (the page waits for the
user), `📥 Batch – `, and the bare `⏳ ` — while a turn works AND while
`pending` background work runs after the card: one hourglass, one meaning
("Claude works, not your move"), never a worded `⏳ Working – ` (legacy, only
stripped). Nothing else strips or sets titles.

**Process prefixes outrank the hourglass.** Two prefixes name a running
process rather than an outcome: `🚀 Shipping – ` (the ship pipeline) and
`📥 Batch – ` (an armed collection). The bare `⏳ ` is the *fallback* for
"being worked on" — it is set only when no process prefix applies and it
never replaces one. `🧭 Concept – ` is no process but a wait: it says "your
move — look at the page", so whenever Claude works in a concept session
(generating the page, a user prompt, a picked-up submission, iterating,
implementing) the title is `⏳ `, and the card brings the compass back only
for the `waiting` phase. Only a task-notification turn leaves the compass
alone (it may end without a card). Concretely:
`prompt.flow.title-work` leaves `🚀 Shipping – ` / `📥 Batch – ` titles
untouched, and a prompt that *is* a ship (`hooks/lib/ship-intent.js`, the same
classifier `prompt.ship.detect` uses) is marked `🚀 Shipping – ` by the hook
itself, so `/ship` after a change never sits on `⏳` for the length of the
pipeline. Outcome prefixes (`🚀 Shipped – `, `📦 Ready – `, …) are what a new
prompt outdates — those the hook strips. Observed 2026-09-21.

**An outcome prefix lives exactly one turn.** `stop.flow.guard` hands the
title-work token back at every non-silent turn end — card or no card — so the
next prompt always marks `⏳ ` and the card that ends that turn sets its own
outcome (`📦 Ready – `, `🧪 Test – `, …). `🚀 Shipped – ` therefore stays on
the sidebar only while the LAST thing the session did was a ship; work after
a ship reads ⏳ → Ready/Test, never Shipped. (Until 0.183.9 the token was
released only after a card, and one card-less answer after a ship pinned
Shipped for the rest of the session.) A ship keyword is an order only in a
short prompt (`KEYWORD_MAX_CHARS` in `ship-intent.js`): long prose that
mentions a ship in passing is work, not a ship, and gets the hourglass.

## 8. Text rules (both languages)

- Sentence case, no exclamation marks, no "successfully".
- Numbers first in evidence posts (`3464 Tests grün`, not `Tests: 3464`).
- Verb first in ship/promotion headings (`Released`, `Promoted`, `Shipped`).
- The three warning signs are the only emoji besides the variant emoji in
  the heading and the ✨ marker (visible in the terminal, a markdown comment on
  Desktop — § 4).
