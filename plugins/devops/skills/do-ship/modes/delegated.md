# Delegated ship: the pipeline in a fresh-context subagent

A ship makes about 25 API calls, and each one re-reads the whole context. It
runs at the end of a session, when that context is largest: measured
2026-09-21, the average was 434 k tokens per call, about 24 % of a session's
tokens. No hook or skill can compact the context. The pipeline does not need
the conversation, only a brief of it. So above
`DOTCLAUDE_SHIP_DELEGATE_THRESHOLD` (default 250 k tokens, `0` turns it off)
`prompt.ship.detect` emits a `[ship-delegate]` block instead of the inline
mandate, and `pre.ship.delegate` refuses a do-ship Skill call with the same
block. The main session writes the brief once. A general-purpose subagent
then runs `/do-ship --delegated` on a fresh context, renders the card with the
main session's id, and hands it back for display. The user never types
`/compact` or a second ship prompt. `--inline` (or the old `--no-compact`)
keeps a single ship in the main context.

Measured on the first 7 delegated ships (2026-09-27/28): the subagent starts
at 72–75 k, grows to 150–195 k and makes 20–39 calls. Weighted by price
(cache read 0.1, 1 h cache write 2.0, output 5) they cost 8.3 M against
about 13.1 M inline: 45–55 % less at 400 k and more, only 13 % less at
about 225 k, and 28 % more at 115 k. Break-even is near 170 k, so the
threshold sits at 250 k and `pre.ship.delegate` refuses a delegated spawn
below it.

A ship the model starts through the Skill tool (concept finalize,
`/do-run backlog`, an autonomous ship after a background agent) gets the
block from `pre.ship.delegate`: the call is refused and the refusal carries
the instruction. Before that guard, half of the large-context ships ran
inline that way, the largest at 951 k.

## Main session (the parent)

1. **Own activity first.** Pre-Step B runs here, because the subagent cannot
   see this session's background agents or commands. If any of them is still
   running, ask as Pre-Step B describes before you spawn anything.
2. **The brief.** The subagent sees nothing but the brief and the repo. It
   reads the diff itself, so the brief carries what the diff cannot show:
   - the user's intent, with their key prompts quoted verbatim
   - up to 3 functional changes (area → description, as the card wants them)
   - the findings and decisions of the session, each with its reason: root
     causes found and alternatives rejected. They feed the PR body and the
     CHANGELOG.
   - the tests that ran and their results, and manual final tests still left
     to the user (`userFinalTest`)
   - `validation` (requirement → how met → how confirmed)
   - open points and issue refs
   - anything the ship must know: a bump hint, known risks, files that must
     not be committed
3. **Flags only you can set.** Only you can see the conversation. Add `--keep`
   when the user announced follow-up work in this branch (the Step 5a signals:
   open tasks, "danach", "Phase 2", "ship but keep going"). Add `--no-watch`
   when the user asked for no deploy watcher.
4. **Spawn.** Call `Agent({ subagent_type: "general-purpose", model: "<this
   session's model family>", run_in_background: false, description: "Ship im
   Subagenten", prompt })`. Name the model even though it equals the
   session's: `pre.agent.model` refuses an inheriting spawn once. The `prompt` starts
   with `Use Skill("devops:do-ship") with args "--delegated[ <flags>][ <channel
   args>]". session_id: <this session's id>. lang: <the user's language>.` and
   then carries the brief. A title that already starts with `⏳ ➜ 🚀 Shipping ┃ `
   stays. Otherwise apply Pre-Step C here, because a subagent cannot rename the
   session it runs in. The shipping title holds until the `done` result: any
   other card the parent renders meanwhile (a waiting concept included) leaves
   it (#785) — only the `done` result's `titlePrefix` replaces it.
5. **Result.** First relay the agent card that `pre.agent.announce` handed you
   for the spawn, verbatim: it is hook output, not text of your own, and
   `pre.agent.relay` holds the next tool call until it is shown. The agent's
   last message ends with one fenced `json` block:
   - `{ "status": "decision", "question", "options", "recommended" }`: ask the
     question with `AskUserQuestion` (the recommended option goes first),
     then `SendMessage` the answer to the same agent and wait for its next
     result. Repeat until the status is `done`.
   - `{ "status": "done", "titlePrefix", "widgetFile" | "markdown",
     "widgetTitle", "exitWorktree", "afterRender"? }`: the card is already rendered. Do not call
     `render_completion_card` again.
     1. If `exitWorktree` is true, call `ExitWorktree({ action: "remove" })`.
     2. Set the session title to `titlePrefix` plus the current title with
        its old devops prefix removed. This is the render result's
        `[SESSION TITLE]` step, carried out here.
     3. On Desktop, `Read` the `widgetFile` and call `show_widget` once, as
        the last action, with `title` = `widgetTitle` verbatim
        (`completion_card_body`; never a title of your own) and
        `widget_code` = the file content verbatim. `stop.flow.guard` also
        recognizes the card by its `dc-card` markup, but a foreign title on a
        widget without that markup is not the card. In the terminal, output
        `markdown` verbatim. Add no text of your own.
     4. Run the optional `afterRender` steps. A background command among them
        is started here, by you: its completion notice reaches only the agent
        that started it, and the subagent has ended by then. Still running at
        the end of your turn → list it in the card's `pending`.
   - `{ "status": "done", "cardData", "afterRender", "exitWorktree" }` (only
     with `--card-data`, see below): the card is NOT rendered yet. On a
     shipped variant finish your own close-out first (the /auto-concept
     finalize: part D and Step 6a, so the bridge, pulser and waker are
     stopped and the state file is gone); on `ship-blocked` skip it — the
     concept stays open. A failed close-out still goes on. Then call
     `render_completion_card` with `cardData` verbatim — except `answer`:
     the subagent saw only the brief, so its `answer` covers at most a part
     of the user's request; merge it into the answer to everything the user
     asked in this conversation. Carry out its
     `[SESSION TITLE]` step and show the card as the last action, run the
     `afterRender` steps, and only then, if `exitWorktree` is true, call
     `ExitWorktree({ action: "remove" })` — the render reads the worktree
     as its `cwd`.
    The subagent also stored the payload in
    `.claude/.ship-carddata-<session>.json`; the render consumes it, and
    `scripts/ship-carddata.js clear` after the render is the backup. After a
    compaction `stop.flow.guard` and `ss.ship.resume` point you back to that
    file — render from it, never rebuild the card from memory (that loses
    the ship state and downgrades to `ready`).
   - **No JSON block**, or the agent failed: render a `ship-blocked` card that
     states the agent's last words as the reason. Never re-run the pipeline
     inline on your own; the user decides (`/do-ship --inline`).

Why the subagent renders: a project ship extension may run a finalizer right
after the render. The dotclaude plugin self-sync is one: it marks the plugin's
MCP servers stale, and `pre.mcp.health` then blocks every further plugin MCP
call. A render left to the parent would come after that point and be blocked.
Rendering in the subagent keeps the inline order: render, finalizer, delivery.
`show_widget` belongs to the app, not to the plugin, so the stale mark never
blocks it.

### Card data instead of a card (`--card-data`, #712)

A ship inside an /auto-concept finalize (part C) runs before the caller's
close-out. A card the subagent renders there is frozen with the concept still
open: it links the localhost page and asks to close the concept out, and the
bridge is gone a minute later. So the finalize passes `--card-data` in its
do-ship args and `pre.ship.delegate` keeps it in the delegated args. It is
never inferred from `.claude/concept-active.json`: that file also exists for
a paused, stale or close-out-only concept, whose ship must not close it out. The subagent then stops before the
render and returns the card input; the caller renders after Step 6a, and the
last card shows the closed concept. The finalize order A → B → C → D stays
unchanged; only the render moves behind the close-out.

The post-render project-extension steps (the dotclaude plugin self-sync,
which marks the MCP servers stale) move with the render: the subagent lists
them in `afterRender` instead of running them, so the caller's render still
reaches the MCP server before anything marks it stale.

## Subagent (`--delegated`)

The pipeline is the normal SKILL.md, including every gate, pass and project
extension. Only these points differ:

| Step | Delegated behavior |
|---|---|
| Pre-Step 0 | Does not apply. You already are the delegated run. |
| Right after `ship_preflight` | Save the brief for a possible resume: `node "{PLUGIN_ROOT}/scripts/ship-checkpoint.js" brief --cwd "<cwd>"` with the brief on stdin (a heredoc). A checkpoint that already holds a brief keeps it. |
| `--resume` | Run Pre-Step R. The brief comes from `checkpoint.brief` when the prompt carries none. |
| An answer arrives by `SendMessage` | Record it first: `ship-checkpoint.js decision --cwd "<cwd>" --question "<q>" --answer "<a>"`. Then continue from the gate. A resumed run never asks the same question again. |
| Pre-Step A | Unchanged. If a lockout is active, its BLOCK and RECORD rules win over the decision return below. |
| Pre-Step B, Pre-Step C | Skip them. The parent owns both. |
| Every `AskUserQuestion` gate (1b(e) rebase conflict, 1d purpose alignment, Codex finding, major bump, 4d deploy gate, the promotion question in `modes/promote.md`) | Do not call `AskUserQuestion`: it cannot reach the user from a subagent. Stop at the gate with nothing half-done: abort a rebase, leave nothing pushed that the answer could change. End your message with the `decision` JSON (`question`, `options` as short labels, `recommended`). The answer comes back as a `SendMessage`; continue from that same gate. |
| Step 1d (purpose alignment) | The user's intent is the brief's verbatim prompts. |
| Step 4b (watcher) | Skip it only on `--no-watch` or the documented skip conditions. Never infer "no watch" from anything else: you cannot see the user's words. |
| Step 5a (keep-mode) | Keep-mode when `--keep` was passed or the worktree was created by the app (the harness rule). Do not evaluate signals 1–3: you cannot see the conversation, and the parent already did. |
| Step 5b Substep 2 (`ExitWorktree`) | Never call it. For a worktree the parent entered through `EnterWorktree`, run `ship_cleanup({ …, keep: true })` and return `"exitWorktree": true`, and the parent removes the worktree. Leftover branches are `ship_hygiene`'s job. |
| Step 5b Substep 3 (re-open files) | Skip it. Those files were opened by the parent session. |
| Step 5e (memory dream) | Skip it. The learnings live in the parent's conversation, not in the brief. |
| Step 6 | Unchanged up to and including `render_completion_card` (with the `session_id` and `lang` from your prompt) and any project-extension step that runs after the render, such as a plugin self-sync. Take `changes`, `validation` and `userFinalTest` from the brief, plus what the ship itself found. **Never call `show_widget` or rename the session**: return the result in the `done` JSON. `titlePrefix` is the prefix the `[SESSION TITLE]` block names. On Desktop, `widgetFile` is the path the result names ("The same HTML is saved in …") and `widgetTitle` is always `"completion_card_body"`. In the terminal, `markdown` is the card markdown verbatim. |
| Step 6 with `--card-data` | Do everything up to the render, but do **not** call `render_completion_card` and do not run the project-extension steps that follow the render. Return `{ "status": "done", "cardData": <the full render_completion_card input you would have passed, session_id and lang included>, "afterRender": [<each deferred extension step, as a command or one-line instruction>], "exitWorktree" }`. List an extension step in `afterRender` only when it would have run here: `ship_release` succeeded and its own conditions hold (e.g. no `.claude/.ship-queue` marker) — otherwise `[]`. Before you return, store the same object on disk so a compaction in the parent cannot lose it: `node "{PLUGIN_ROOT}/scripts/ship-carddata.js" write --cwd "<cwd>" --session <session_id from your prompt>` with `{ "cardData", "afterRender", "exitWorktree" }` on stdin (a heredoc). The parent renders after its close-out. |
| Background work a step would start (a project extension's background audit, a watcher the parent must own) | Do not start it: its completion notice would reach only you, after you ended. Put it into the `done` JSON's `afterRender` as a command or one-line instruction; the parent starts it. |
| Sentinel hygiene | Unchanged. Before a `ship-blocked` card, call `ship_cleanup({ …, keep: true })`. |

End **every** return (`decision` and `done` alike) with exactly one fenced `json`
block and put no text after it. The parent parses that block and nothing else.
