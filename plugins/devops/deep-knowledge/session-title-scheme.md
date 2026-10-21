# Session Title Scheme

The session-title prefixes the devops plugin sets in the Desktop app sidebar, and how they match the completion card's CTA heading. Code: `hooks/lib/title-scheme.js` (the one table), `hooks/lib/session-title.js`, `mcp-server/lib/mode-state.js`. Card anatomy: `completion-card-design.md`.

A title reads `<STATUS> ┃ <Word> <ACTIVITY> <title>` (heavy bar U+2503, one
space each side, one space between the emoji and the title; no ` – `
separator). The code inserts a run of U+200A hair spaces BEFORE the word
(`fillFor` in `title-scheme.js`, Segoe UI 14px widths) so the word is
right-aligned and the activity emoji forms a column in the sidebar; the
prefixes below are written without that fill. Generic, unnamed work gets
`⏳ ┃ Solo 🤖 <title>` (`WORK_PREFIX`), set by `prompt.flow.title-work` on every
prompt; the card's session-title note replaces it with the result prefix at
turn end. Nothing else strips or sets titles.

| STATUS | Meaning |
|---|---|
| `⏳` | Claude works (shipping, V&V running, background agents pending, concept iterating/implementing, generic Solo work) |
| `👉` | Your move: the card carries a MANDATORY user step |
| `🟩` | Done, nothing mandatory left (not ✅) |
| `🟥` | Aborted |
| `🟦` | Paused |

| State | Prefix (without fill) |
|---|---|
| work | `⏳ ┃ Shipping 🚀`, `⏳ ┃ Testing 🧪`, `⏳ ┃ Team 🤖` (pending background work), `⏳ ┃ Concept 🧭` (iterating/implementing), `⏳ ┃ Solo 🤖` (generic) |
| user | `👉 ┃ Concept 🧭` (page waits), `Batch 📚`, `Test 🧪`, `Ready 📦`, `Files 📦`, `Question ❓`, `Red tests ⚠️`, `Unverified ⚠️`, `Not deployed ⚠️`, `Blocked 🚧`, `Interrupted ⚡` (see F5) |
| done | `🟩 ┃ Alpha 🚀` (merged ship), `Beta 🚀` / `Stable 🚀` (ship and promote in one run), `Beta 🎊` / `Stable 🎊` (promote only), `Committed 📦`, `Started 💡`, `Analysis 📊`, `System 🖥️` (work outside the repo); never "LIVE" |
| aborted | `🟥 ┃ Aborted 📦` (generic), `Ship 🚀`, `Promote 🎊`, `Test 🧪`, `Concept 🧭`, `Batch 📚`, `Analysis 📊`, `Team 🤖` |
| paused | `🟦 ┃ Paused ✋`, `Limit reset 🔋`, `Restart 🔌`, `Reboot 💻` |

A named abort keeps its activity (`🟥 ┃ Ship 🚀 X`).

**The 👉-vs-🟩 rule** is decided by content, not by variant name: a
mandatory user step (an open point or question, a required userTest, a
requirement with `waitsOn: "user"`, red tests, unverified, blocked, ready
"Ship?", files, a concept waiting, a batch collecting, not deployed) gives
👉. Optional follow-ups (a promote offer after an alpha release, "noch
etwas?") stay 🟩.

**Title = CTA.** The card's CTA heading starts with the same status, keyword and
activity as the title (`👉 ┃ Ready 📦 X` →
`👉 ┃ Ready 📦 — Shippen?`); both come from one table so they cannot drift.
The card's component line uses 🧩.

**F5 Interrupted.** A turn that ends WITHOUT a card while the title is
`⏳ ┃ Solo 🤖 …` is rewritten to `👉 ┃ Interrupted ⚡ <title>`. A batch turn without a
card, a concept waiting and `⏳ ┃ Shipping 🚀` stay untouched.

**Legacy prefixes.** Titles in the wild may carry the previous two-slot
form (`<STATUS> <ACTIVITY> <Word> – `, e.g. `👉 📦 Ready – `, with the old
keywords such as `Released Alpha` and the old `⏸️` status), the bare `⏳ `, or
an old single-icon prefix (`🚀 Shipped – `, `📦 Ready – `, `🧭 Concept – `,
`📥 Batch – `, `⏳ Working – `, …). All are still recognised and stripped
(also stacked, old and new mixed), and `classify` maps old and new forms to
the same categories. Matching ignores FE0F and any number of U+200A, so a
title whose fill count differs still matches. Only known prefixes are
stripped; `⏳ Fix Login – Bug` keeps its text.

**Process prefixes outrank the hourglass.** Two prefixes name a running
process rather than an outcome: `⏳ ┃ Shipping 🚀 ` (the ship pipeline) and
`👉 ┃ Batch 📚 ` (an armed collection). `⏳ ┃ Solo 🤖 ` is the *fallback* for
"being worked on" — it is set only when no process prefix applies and it
never replaces one. `👉 ┃ Concept 🧭 ` is no process but a wait: it says "your
move — look at the page", so whenever Claude works in a concept session
(generating the page, a user prompt, a picked-up submission, iterating,
implementing) the title is `⏳ ┃ Solo 🤖 ` (or `⏳ ┃ Concept 🧭 ` while
iterating), and the card brings 👉 back only for the `waiting` phase. **A
running ship outranks `concept.waiting` (#785):** while the title is
`⏳ ┃ Shipping 🚀 ` — also during a delegated ship in a subagent — a card that
does not end the ship (anything but `ship-successful`, `released`,
`ship-blocked`, `aborted`) leaves the title alone instead of restoring the
compass; the ship's own outcome card sets the next prefix. Only a task-notification turn leaves the compass
alone (it may end without a card). Concretely:
`prompt.flow.title-work` leaves `⏳ ┃ Shipping 🚀 ` / `👉 ┃ Batch 📚 ` titles
untouched, and a prompt that *is* a ship (`hooks/lib/ship-intent.js`, the same
classifier `prompt.ship.detect` uses) is marked `⏳ ┃ Shipping 🚀 ` by the hook
itself, so `/do-ship` after a change never sits on `⏳` for the length of the
pipeline. Outcome prefixes (`🟩 ┃ Alpha 🚀 `, `👉 ┃ Ready 📦 `, …) are what a new
prompt outdates — those the hook strips. Observed 2026-09-21.

**An outcome prefix lives exactly one turn.** `stop.flow.guard` hands the
title-work token back at every non-silent turn end — card or no card — so the
next prompt always marks `⏳ ┃ Solo 🤖 ` and the card that ends that turn sets its own
outcome (`👉 ┃ Ready 📦 `, `👉 ┃ Test 🧪 `, …). `🟩 ┃ Alpha 🚀 ` therefore stays on
the sidebar only while the LAST thing the session did was a ship; work after
a ship reads ⏳ → Ready/Test, never Released. (Until 0.183.9 the token was
released only after a card, and one card-less answer after a ship pinned
Shipped for the rest of the session.) A ship keyword is an order only in a
short prompt (`KEYWORD_MAX_CHARS` in `ship-intent.js`): long prose that
mentions a ship in passing is work, not a ship, and gets the Solo prefix.
