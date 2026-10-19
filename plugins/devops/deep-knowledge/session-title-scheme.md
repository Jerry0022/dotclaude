# Session Title Scheme

The double-icon session-title prefixes the devops plugin sets in the Desktop app sidebar, and how they match the completion card's CTA heading. Code: `hooks/lib/title-scheme.js` (the one table), `hooks/lib/session-title.js`, `mcp-server/lib/mode-state.js`. Card anatomy: `completion-card-design.md`.

A title reads `<STATUS> <ACTIVITY> <Word> – <title>`. The only single-icon
form is the bare `⏳ <title>` that `prompt.flow.title-work` sets on every
prompt that starts generic, unnamed work; the card's session-title note
replaces it with the result prefix at turn end. Nothing else strips or sets
titles.

| STATUS | Meaning |
|---|---|
| `⏳` | Claude works on a named process (shipping, V&V running, background agents pending, concept iterating/implementing) |
| `👉` | Your move: the card carries a MANDATORY user step |
| `🟩` | Done, nothing mandatory left (not ✅) |
| `🟥` | Aborted |
| `⏸️` | Paused |

| ACTIVITY | Keywords (STATUS in front) |
|---|---|
| 🚀 ship | `⏳ Shipping`, `🟩 Released Alpha` |
| 🎊 promote | `🟩 Released Beta/Stable` (ship and promote in one run), `🟩 Promoted Beta/Stable` (promote only); never "LIVE" |
| 🧪 test | `⏳ Testing` (V&V running), `👉 Test` |
| ▶️ | `🟩 Started` (test-minimal) |
| 🧭 concept | `👉 Concept` (page waits), `⏳ Concept` (iterating/implementing) |
| 📥 batch | `👉 Batch` |
| 📋 | `🟩 Analysis` |
| 🖥️ | `🟩 System` (fallback: work outside the repo, no repo diff) |
| 📦 code done | `👉 Ready`, `🟩 Committed` (ready-local), `👉 Files` (ready-files), `🟥 Aborted` (generic abort) |
| ❓ / ⚠️ / ⛔ | `👉 Question`, `👉 Red tests` / `Unverified` / `Not deployed`, `👉 Blocked` |
| 🤖 | `⏳ Agents` (pending background work) |
| ⚡ | `👉 Interrupted` (see F5 below) |
| pause | `⏸️ 🔋 Limit reset`, `🔄 Restart`, `💻 Reboot`, `✋ Paused` |

A named abort keeps its activity (`🟥 🚀 Ship – X`).

**The 👉-vs-🟩 rule** is decided by content, not by variant name: a
mandatory user step (an open point or question, a required userTest, a
requirement with `waitsOn: "user"`, red tests, unverified, blocked, ready
"Ship?", files, a concept waiting, a batch collecting, not deployed) gives
👉. Optional follow-ups (a promote offer after an alpha release, "noch
etwas?") stay 🟩.

**Title = CTA.** The card's CTA heading starts with the same two icons and
the same English keyword as the title (`👉 📦 Ready – X` →
`👉 📦 Ready — Shippen?`); both come from one table so they cannot drift.
The card's component line uses 🧩.

**F5 Interrupted.** A turn that ends WITHOUT a card while the title is a bare
`⏳ …` is rewritten to `👉 ⚡ Interrupted – <title>`. A batch turn without a
card, a concept waiting and `⏳ 🚀 Shipping` stay untouched.

**Legacy prefixes.** Every old single-icon prefix (`🚀 Shipped – `,
`📦 Ready – `, `🧭 Concept – `, `📥 Batch – `, `⏳ Working – `, …) is still
stripped, so titles from older sessions come out clean. Only known
status × activity × keyword prefixes are stripped; `⏳ Fix Login – Bug` keeps
its text.

**Process prefixes outrank the hourglass.** Two prefixes name a running
process rather than an outcome: `⏳ 🚀 Shipping – ` (the ship pipeline) and
`👉 📥 Batch – ` (an armed collection). The bare `⏳ ` is the *fallback* for
"being worked on" — it is set only when no process prefix applies and it
never replaces one. `👉 🧭 Concept – ` is no process but a wait: it says "your
move — look at the page", so whenever Claude works in a concept session
(generating the page, a user prompt, a picked-up submission, iterating,
implementing) the title is the bare `⏳ ` (or `⏳ 🧭 Concept – ` while
iterating), and the card brings 👉 back only for the `waiting` phase. Only a task-notification turn leaves the compass
alone (it may end without a card). Concretely:
`prompt.flow.title-work` leaves `⏳ 🚀 Shipping – ` / `👉 📥 Batch – ` titles
untouched, and a prompt that *is* a ship (`hooks/lib/ship-intent.js`, the same
classifier `prompt.ship.detect` uses) is marked `⏳ 🚀 Shipping – ` by the hook
itself, so `/do-ship` after a change never sits on `⏳` for the length of the
pipeline. Outcome prefixes (`🟩 🚀 Released Alpha – `, `👉 📦 Ready – `, …) are what a new
prompt outdates — those the hook strips. Observed 2026-09-21.

**An outcome prefix lives exactly one turn.** `stop.flow.guard` hands the
title-work token back at every non-silent turn end — card or no card — so the
next prompt always marks `⏳ ` and the card that ends that turn sets its own
outcome (`👉 📦 Ready – `, `👉 🧪 Test – `, …). `🟩 🚀 Released Alpha – ` therefore stays on
the sidebar only while the LAST thing the session did was a ship; work after
a ship reads ⏳ → Ready/Test, never Released. (Until 0.183.9 the token was
released only after a card, and one card-less answer after a ship pinned
Shipped for the rest of the session.) A ship keyword is an order only in a
short prompt (`KEYWORD_MAX_CHARS` in `ship-intent.js`): long prose that
mentions a ship in passing is work, not a ship, and gets the hourglass.
