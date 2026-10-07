# Concept step 3 — opening the page, bridge launch, open-concept cards

No-bridge fallbacks, the Edge open command and its gates, the bridge server and background tasks, the sidebar title and the open-concept completion cards — execution detail of `SKILL.md` Step 3, moved here verbatim. Each `##` section below is named by exactly one mandatory pointer in `SKILL.md`, at the place the text used to stand; read it completely before executing that step — it is as binding as the step itself.

## Hand-off fallback

**A fallback, never a choice.** Whenever this session can start the bridge
and open Edge on the owner's machine, the sections below apply unchanged. Take
this path only when the owner cannot reach `http://localhost:{port}` from the
device they use: the session runs in a claude.ai cloud or other remote
container, or there is no local desktop to open Edge on. "The bridge would be
slow", "fewer tokens" or a failed first Edge start are no reason — retry per
the sections below.

1. **Steps 0–2 ran in full** — the page exists at
   `docs/concepts/<date>-<slug>.html`, built from the engine, and the
   Post-Generation Validation gate passed (`post.concept.gate` runs on it as
   on every page). Never skip them because the live channel is missing.
2. **Commit and push** the page on the working branch
   (`docs(concept): <slug>`), so another session can open it.
3. **Hand off in one line**, naming the reason, the file, the branch and the
   way back to the live loop:
   > Keine erreichbare Concept-Bridge (<reason, e.g. Cloud-Session>) — die
   > Seite liegt unter `docs/concepts/<file>.html` auf `<branch>`. In einer
   > Desktop-Session auf diesem Branch „öffne das Concept `<file>`" sagen,
   > dann startet die Bridge und die Live-Runde läuft.
4. **No bridge, no crons, no Edge start** in this session; the sidebar keeps
   its normal outcome prefix (no compass — nothing waits on a page here).
   The completion card reports the page under `changes` and the hand-off as
   its one `open` item; it carries no `concept` field.

## Artifact fallback

**Second tier, behind the hand-off.** Take it only when the hand-off above
applies AND the owner wants to decide now from the device they are on (phone,
claude.ai) instead of waiting for a Desktop session, and this session has the
Artifact tool. The bridge stays first wherever it can run; the hand-off stays
the default when nobody asked to decide remotely.

Build the copy with `node "{PLUGIN_ROOT}/scripts/concept-artifact.js"
--artifact docs/concepts/<file>.html`, publish it with `capabilities: {db: {}}`,
and read the decisions back on the next turn with `ArtifactData` — no bridge,
no crons, no Edge start. The steps, the wrapper contract and the card:
`deep-knowledge/artifact-fallback.md`.

## Open command, 200 gate, token check

The **only** correct invocation is the OS `start`/`open` shell command
that hands the URL to the user's default Edge window, which then opens
a new tab. The exact command per platform:

```bash
# Build the URL ONCE. $PORT and $HTML_PATH must be set in THIS SAME Bash
# call — shell state does NOT survive across separate tool calls, so if you
# launched the server in an earlier call these are empty here and the URL
# collapses to "http://localhost:/" (the "concept url not found" symptom).
# Either re-set them in this call or inline the concrete port + path. The
# path is project-root-relative (the server's cwd), e.g.
# docs/concepts/{date}-{slug}.html — it MUST equal the --html value exactly.
URL="http://localhost:$PORT/$HTML_PATH"

# Gate the open on a real 200 — NEVER open a tab on a 404. This single check
# catches every cause of "concept url not found": wrong path (bare filename
# vs full relative path), a server cwd that does not contain the file
# (worktree/main-root mismatch), and empty $PORT/$HTML_PATH.
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$URL")
[ "$CODE" = "200" ] || { echo "Concept URL $URL -> HTTP $CODE (expected 200) - aborting open. Check the server cwd contains $HTML_PATH and that \$PORT/\$HTML_PATH are set in this shell."; exit 1; }

# Windows (this project's primary target)
start "" msedge "$URL"

# macOS
open -a "Microsoft Edge" "$URL"

# Linux
microsoft-edge "$URL" &
```

The empty `""` on Windows is required — without it, `cmd.exe` interprets
the first quoted argument as a window title.

**Computed-token check — between the 200 gate and the `start` (#346).** A
page can pass every grep and still open white: the design-token block is
swallowed when a `<style>` opens inside a `<style>` (engine CSS carried over
from an older page) or a stray brace ends `:root` early. `post.concept.gate`
and `validation-gate.md` § Phase 0b catch the tag structure; this step catches
what only a CSS parser sees. Load `$URL` in a headless browser context (the
Claude browser pane / Playwright — NOT the tab the user will get; this is a
read of the rendered CSS, no bridge interaction) and evaluate:

> **Verification tabs use their own browser profile — always.** Two tabs of
> the same profile share `localStorage`, and the page keeps its navigation
> state (`_activeView`, `_activeScreen*`, `_viewportMode`) there. A
> verification tab opened in the user's Edge profile therefore lands on
> whatever view the user is reading, and its own autosaves write its
> position back over theirs (#347). Playwright and the Claude browser pane
> run an isolated profile; a tab in the user's window does not. The bridge
> mirror is not the leak — `recovered` carries `text:` keys only, on both
> ends.

```js
getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim()
```

`--accent-color` is the token every page defines and the panel's split button,
chips and status line consume; the reference CSS itself defines no tokens, and
pages differ on `--bg` vs `--bg-color`, so those are not reliable probes. (A
page that uses a different accent name is one you authored — probe the token
your `:root` block defines.) Non-empty → proceed to `start`. Empty → do NOT
open the tab; regenerate the `<style>` block from `templates.md` § Layout
(exactly one `<style>` opener, closed before the next tag), re-run the gate,
re-check. Skip the check only when no browser tool is reachable at all — then
say so in the completion card's `userFinalTest` so the user knows the theme
was not verified.

**If the `start "" msedge …` command errors** (Edge not installed, not in
PATH), do NOT silently fall back to the preview MCP. Tell the user the
exact error and ask whether to try the Edge protocol handler
(`start microsoft-edge:"http://localhost:$PORT/…"`) or another browser
they prefer. The whole concept flow assumes a real, user-visible browser
window — there is no usable degraded mode.

## Bridge server, background tasks, sidebar title, user notice

Start the bridge server (`scripts/concept-server.py`) on a port chosen via the
cross-session registry (`node scripts/concept-port-registry.js pick "<project-root>"`
— skips ports owned by another live concept session; see bridge-server.md
§ port selection), arm the sparse backstop cron (fires every 15 minutes —
each fire is a model turn, so it is a last resort, never the monitor), write
`.claude/concept-active.json` — in the **session cwd**, with a fresh `owner`
token (`deep-knowledge/bridge-server.md` § step 4; two sessions in sibling
worktrees must never share one file, #417) — so a future SessionStart can
rediscover this concept, **send the first heartbeat AND verify it round-trips with a
non-zero `claude_ts`** (see `deep-knowledge/bridge-server.md` § Step 5 —
the read-back is mandatory; a naked POST leaves a dead-bridge failure
mode invisible until the user submits and gets no response), then open
the page in the user's existing Edge window using the exact command above.

**Then launch the two background tasks — the concept does not work without
them.** Both are the same script in two modes, `scripts/concept-watch.js`,
launched via the Bash tool with `run_in_background: true` (exact invocations in
`deep-knowledge/bridge-server.md` § step 3):

1. **Keepalive pulser** — POSTs `/heartbeat` every ~20 s for the whole session
   and never exits on a pending submission, so the connection indicator stays
   green even through a long `implement`.
2. **Pickup waker** — polls `/pending` every ~20 s and exits the instant a
   submission lands, which wakes Claude immediately. It also owns the
   self-cleanup gate (state file gone / OUR file on a foreign port / page
   deleted ⇒ `/shutdown` + exit; a file another session owns is left alone,
   #417) and page liveness (no tab registered any more and the
   last tab said `/bye` ⇒ the page is re-opened in Edge, once per close;
   silence never counts — a hidden or sleeping tab is not a closed one,
   #397) — token-free, see
   `deep-knowledge/bridge-server.md` § step 3 (#363).

The cron alone is NOT sufficient for either job: it fires only while the REPL
is idle and has multi-minute gaps in practice (observed: 638 s with the cron
registered and the session idle). It stays armed as a sparse backstop (every
15 min), never as the primary path — every fire costs a model turn.

**Neither task — nor the bridge server — is pending work.** They run for the
whole concept and never yield a result; they are the waiting itself.
`stop.flow.guard` ignores them, and they must NEVER appear in a completion
card's `pending` field. See § Completion cards while the concept is open.

Pass the state file's **absolute** path via `--state`. The watchers used to
test a relative `.claude/concept-active.json` against their own cwd, which is
not always the project root the state file lives in — both then exited
`STATE_GONE` on their first iteration, which looks exactly like the bug they
prevent. They also tolerate the state file not existing yet (60 s grace), so
launching them here, before step 4 writes it, is safe.

**Capture the reality-check baseline right after writing the state file:**

```bash
node "{plugin-root}/scripts/concept-drift.js" --capture \
     --state "{session-cwd}/.claude/concept-active.json" --owner {owner}
```

It records the default branch's current remote tip into the state file, which is
what the implement gate later diffs against (Step 5b step 0). Capture it at
concept open, not at first implement — a baseline taken minutes before the
implement click would show no drift at all, which is precisely the failure this
gate exists to prevent. In a repo with no remote the call is a silent no-op and
the gate stays disabled for the session; that is intended.

The state file (`port`, `html_path`, `slug`, `server_pid`, `cron_id`,
`started_at`, plus `baseline_ref` / `baseline_sha` / `baseline_captured_at`)
is what makes the concept survivable across Claude restarts:
the `ss.concept.resume` SessionStart hook reads it, verifies the bridge
is still running via `GET /heartbeat`, and tells the new session whether
to re-arm the polling cron or pick up an unprocessed submission. Without
the state file the new session has no way to know a concept was ever
opened — the polling cron is session-only and dies with the old session.

See `deep-knowledge/bridge-server.md` for the full setup — script lookup,
launch command, cron body, state-file schema, rationale for `/pending`
over substring checks, and cleanup ordering.

### Mark the session in the sidebar

A concept turns this session into a waiting room: the work continues on the
page, not in chat. A user who comes back later sees only "Claude is idle" and
types the next task into a session that is waiting for page decisions. So,
right after the page is open, prefix the session title:

1. `mcp__ccd_session_mgmt__get_session` with `session_id: "self"` → `title`.
2. If `title` already starts with `🧭 Concept – `: done.
3. Strip any leading devops prefix (`⏳ `, `📦 Ready – `, `🧪 Test – `,
   `🚀 Shipped – `, … — the `SESSION_PREFIX` and `LEGACY_PREFIXES` values in
   `mcp-server/lib/mode-state.js`) left by the first-prompt hourglass or an
   earlier card — never stack them (`🧭 Concept – ⏳ Foo` is the bug).
4. `mcp__ccd_session_mgmt__set_session_title` with `session_id: "self"` and
   `title: "🧭 Concept – {stripped title}"`.

The prefix is exactly `🧭 Concept – ` (compass, space, word, space, en dash,
space) — the same emoji the completion card carries in its CTA, so sidebar
and card read as one state. From here on the completion card keeps the title
in step with the phase (table below); Step 6a strips the prefix again.

**The compass means "your move — look at the page", nothing else.** Never set
it before the page is open: while `/auto-concept` is invoked and the page is still
being generated, the title keeps the bare `⏳ ` that `prompt.flow.title-work`
put there. And whenever Claude works again later — a submission is picked up
(Step 5 § Mark the round as work), the user types into the chat (the hook
swaps the compass for `⏳ ` itself), a round iterates or implements — the
title is `⏳ `; the card that hands the page back (`phase: "waiting"`) brings
the compass back. The hourglass is always the bare icon, never a worded
`⏳ Working – `.

**Both tools exist only in the Desktop app.** Deferred is not unavailable: when they sit in the deferred-tools list, load
both once with `ToolSearch` `select:mcp__ccd_session_mgmt__get_session,mcp__ccd_session_mgmt__set_session_title`, then call them
(`{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md`). In a terminal session, an
unattended run, or when the call fails for any reason: skip silently — no
retry, no note to the user, no fallback. The rename is a courtesy, never a
gate. Never restore the title by re-typing a remembered value; the strip in
Step 6a is the only restore.

### After opening, inform the user:

Pick the wording that matches the `[ui-locale: ...]` hint injected by
`prompt.knowledge.dispatch.js` (defaults to `en`):

**en:**
> Concept opened. Make your decisions on the page and click
> "Submit decisions" when you're done — I'll take it from there.

**de:**
> Concept geöffnet. Triff deine Entscheidungen auf der Seite und klick
> "Entscheidungen abschicken" wenn du fertig bist — ich übernehme dann.

## Completion cards while the concept is open

Every turn that ends with the concept still open — right after opening the
page, after each processing round, after a stale wake — renders its completion
card with the `concept` field **and `cwd` set to the session cwd** (where
`.claude/concept-active.json` lives). That
replaces the CTA of whatever variant the turn earned (and outranks `pending`)
with the one statement that is true:

| `concept.phase` | When | CTA (DE) | Session title |
|---|---|---|---|
| `waiting` (default) | Page is open, next step is the user's submission | `🧭 CONCEPT wartet auf deine Entscheidungen auf der Seite — ich MELDE mich` | `🧭 Concept – ` |
| `iterating` | A submission was processed and the next iteration is still being produced (e.g. by background agents) | `🧭 CONCEPT in Iteration — ich MELDE mich` | `⏳ ` |
| `implementing` | An `implement` submission is being executed and the turn hands back before it lands | `🧭 CONCEPT in Implementierung — ich MELDE mich` | `⏳ ` |

The card's `[SESSION TITLE]` block carries the prefix of the phase — apply it
every time, exactly like any other card's title instruction. This is what lets
the sidebar tell a session that waits for a decision from one that is busy
(#416): only while the page waits does the compass show; between two
iterations and during an implementation it is Claude's move and the sidebar
shows the hourglass, and the next `waiting` card brings the compass back. The
phase must therefore be truthful — a card that says `waiting` while a feature
agent implements the submission, or while the next round is still being
produced, is the bug.

Real content work still goes into `pending` — a feature agent implementing the
submission, a research workflow preparing the next round — and the card folds
it as its own sentence after the state (`… in Implementierung. 2 Agenten arbeiten`) and names each item in the pending block.
The bridge server, keepalive pulser and pickup waker are **not** content work:
never list them there. A card that names them is the bug this field fixes.

With `cwd` set, the card reads `port` + `html_path` from
`.claude/concept-active.json` and prints the page's URL
(`> 🧭 http://localhost:{port}/docs/concepts/{date}-{slug}.html`) directly
above that CTA — the way back to the tab for a user who lost it. Nothing else
to pass: the link is the one the page is already open at. Without `cwd` the
card has no line to print, which is a defect of the call, not of the card.

The final card (Step 6b) carries no `concept` field: by then the bridge is
down and the concept is closed.
