# Implement brief — double-icon session titles + matching CTA headings

Source of truth: the concept at `docs/concepts/2026-10-19-title-cta-emoji-scheme/` (rounds 1–4, all baked; `-decisions.json` holds every answer). Round 4 is the final round. Where this brief differs from round 4, the brief wins, because it includes the round-4 answers.

## Final scheme

**Grammar.** A title is `<STATUS> <ACTIVITY> <Word…> – <title>`. The **only** single-icon form is a bare `⏳ <title>`, used while Claude does generic, unnamed work (prompt.flow.title-work).

**STATUS (first icon).** It is chosen by card content, not by variant name:
- `⏳`: Claude works on a named process (shipping, V&V test running, background agents pending, concept iterating/implementing).
- `👉`: the user's move. Use it whenever the card carries a MANDATORY user step: an open point or question, a required userTest, a requirement with `waitsOn: "user"`, red tests, unverified, blocked, the test variant, ready ("Ship?"), files, a concept waiting, a batch collecting, not deployed, or an interrupted turn.
- `🟩`: done, nothing mandatory left. Optional follow-ups (a promote offer after an alpha release, "noch etwas?") stay 🟩. **Not ✅.** The user picked a plain green box to match the red box.
- `🟥`: aborted.
- `⏸️`: paused.

**ACTIVITY (second icon)** and the English keyword (titles are always English):
- 🚀 ship: `Shipping` (⏳), `Released Alpha` (🟩, ring ship). A ship and promote in one run reads `🎊 Released Beta` / `🎊 Released Stable`.
- 🎊 promote only, without a ship: `Promoted Beta` / `Promoted Stable`. Never "LIVE"; the word is "Stable".
- 🧪 test: `Testing` (⏳, V&V running) / `Test` (👉 test variant).
- ▶️ `Started` (test-minimal, 🟩).
- 🧭 `Concept` (⏳ iterating/implementing, 👉 waiting).
- 📥 `Batch` (👉).
- 📋 `Analysis` (🟩).
- 🖥️ `System`: work outside the repo with no repo diff (the fallback variant), 🟩.
- 📦 code-done family: `Ready` (👉, ready: ship?), `Committed` (🟩, ready-local / no remote), `Files` (👉, ready-files), and a generic abort `🟥 📦 Aborted`.
- ❓ `Question` (👉, the open-point/question heading).
- ⚠️ `Red tests` / `Unverified` / `Not deployed` (👉, the ready-red, vv-unverified and merged-not-live cases).
- ⛔ `Blocked` (👉, ship-blocked).
- 🤖 `Agents` (⏳, pending background work).
- ⚡ `Interrupted` (👉, a turn that ended without a card; see F5).
- Pause reasons: 🔋 `Limit reset`, 🔄 `Restart`, 💻 `Reboot`, ✋ `Paused` (user pause).
- A named abort keeps its activity, for example `🟥 🚀 Ship – X`.

**Title = CTA.** Every card's CTA heading (`HEADINGS` in `mcp-server/index.js`, de + en) starts with the SAME two icons and the SAME English keyword as the title it leaves, followed by the localized sentence. Example: title `👉 📦 Ready – X`, heading `👉 📦 Ready — Shippen?`. Build both from one table so they cannot drift.

**Card component line.** It moves from 📦 (`index.js` ~1102) to 🧩.

## Also in scope (round-1 findings, all accepted)
- **F3 wording:** use the same terms everywhere (Released Alpha/Beta/Stable, Promoted Beta/Stable, Started, Stable never LIVE).
- **F4:** titles stay English.
- **F5:** when a turn ends WITHOUT a completion card and the title is a bare `⏳ …` (not batch 📥, not a concept waiting, not `⏳ 🚀 Shipping`), the Stop path rewrites the title to `👉 ⚡ Interrupted – <title>`. A batch turn without a card is intended and must stay untouched. Mechanism: a title instruction from stop.flow.guard, or the hook writes it itself if a safe path exists. Investigate how the card path does it (`titleInstruction` / `set_session_title` block) and reuse it.
- **F6:** fix the strip bug. `WORDED` in `hooks/lib/session-title.js` also strips arbitrary "Xxx – " after a bare ⏳ ("⏳ Fix Login – Bug" loses "Fix Login – "). Strip only known status × activity × keyword prefixes. Normalize the FE0F variation selector (▶️ ⏸️ 🖥️ ⚠️) when matching.
- **Red-team R1:** the guards (batch owns its title; a running `Shipping` is never replaced; the bare-⏳ shortcut) must check the two-slot grammar. Check `⏳ 🚀 Shipping` before the bare-⏳ shortcut.
- **Red-team R4:** every old single-icon prefix (`🚀 Shipped – `, `📦 Ready – `, `🧭 Concept – `, `⏳ Working – `, …) goes into `LEGACY_PREFIXES` and is still stripped, so titles from older sessions come out clean.
- **Concept and batch:** `🧭 Concept – ` becomes `👉 🧭 Concept – ` (waiting) or `⏳ 🧭 Concept – ` (iterating/implementing). `📥 Batch – ` becomes `👉 📥 Batch – `. Update the skills and docs that spell these prefixes out: auto-concept `step3-open-browser.md`, `step5-process.md`, `step6-closeout.md`, do-batch `activation.md`/merge, do-ship `SKILL.md` Pre-Step C and the outcome table, `completion-card-design.md`, `plugin-behavior.md`, `mcp-deferred-tools.md`, and any other `.md` that pins the literal prefixes (grep them).

## Files (start points)
`plugins/devops/mcp-server/lib/mode-state.js` (SESSION_PREFIX, VARIANT_TITLE_PREFIX, titlePrefixFor, releasedPrefix, pausedPrefix, stripTitlePrefix, titleInstruction) · `plugins/devops/hooks/lib/session-title.js` (mirrors the prefix strings; nextTitle, batchTitle, unbatchTitle, stripPrefixes) · `plugins/devops/mcp-server/index.js` (HEADINGS de/en, concept heading icon, component line) · `hooks/user-prompt-submit/prompt.flow.title-work.js` · `hooks/post-tool-use/post.flow.title-mode.js` · `hooks/stop/stop.flow.guard.js` · `hooks/lib/ship-*.js`, `hooks/user-prompt-submit/prompt.ship.detect.js`, `hooks/session-start/ss.ship.resume.js` · the tests next to each.

## Tests (user requirement: exhaustive)
- A **matrix test** covers EVERY completion-card variant × every flag that changes the heading or prefix (pending, concept phase waiting/iterating/implementing, batch, open points/question, ready-red, vv-unverified, vv-running, ring, kept, closeout, ready-local/no remote, ready-files, merged-not-deployed, paused per reason, released per channel, ship+promote vs promote-only, aborted named vs generic, a mandatory vs an optional follow-up). For each it asserts the exact STATUS icon, the ACTIVITY icon and the keyword of the title, and that the CTA heading starts with the same prefix (title = CTA).
- Strip/nextTitle tests: every new prefix, every legacy prefix, the F6 regression, and FE0F with or without the selector.
- The F5 Stop path: bare ⏳ → `👉 ⚡ Interrupted`. Batch, concept waiting and shipping stay untouched.
- Update every existing test that pins old literals (about 19 files). Run the full `npm test` and `npm run lint` at the end.

## Constraints
- Work in this worktree (`C:\Users\Jerem\IdeaProjects\dotclaude\.claude\worktrees\title-emoji-concept-k7q2`), branch `worktree-title-emoji-concept-k7q2`. Do not commit; the session commits.
- Do not touch `docs/concepts/**`.
- Follow `plugins/devops/CONVENTIONS.md` (bump hook `@version` headers you change).
