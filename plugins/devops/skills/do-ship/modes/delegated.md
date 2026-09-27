# Delegated ship: the pipeline in a fresh-context subagent

A ship makes about 16 API calls, and each one re-reads the whole context. It runs
at the end of a session, when that context is largest: measured 2026-09-21, the
average was 434 k tokens per call, about 24 % of a session's tokens. No hook or
skill can compact the context. The pipeline does not need the conversation,
only a brief of it. So above `DOTCLAUDE_SHIP_DELEGATE_THRESHOLD` (default 200 k
tokens, `0` turns it off) `prompt.ship.detect` emits a `[ship-delegate]` block
instead of the inline mandate. The main session writes the brief once. A
general-purpose subagent then runs `/do-ship --delegated` on a fresh context,
and the main session renders the card. The user never types `/compact` or a
second ship prompt. `--inline` (or the old `--no-compact`) keeps a single ship
in the main context.

Ships that an orchestrator starts through the Skill tool (`/do-run backlog`,
auto-cleanup) never see the block: the hook only reads user prompts.

## Main session (the parent)

1. **Own activity first.** Pre-Step B runs here, because the subagent cannot
   see this session's background agents or commands. If any of them is still
   running, ask as Pre-Step B describes before you spawn anything.
2. **The brief.** The subagent sees nothing but the brief, so the brief has to
   be complete:
   - the user's intent, with their key prompts quoted verbatim
   - up to 3 functional changes (area → description, as the card wants them)
   - the tests that ran and their results
   - `validation` (requirement → how met → how confirmed)
   - open points and issue refs
   - anything the ship must know: a bump hint, known risks, files that must
     not be committed
3. **Spawn.** Call `Agent({ subagent_type: "general-purpose", run_in_background:
   false, description: "Ship im Subagenten", prompt })`. The `prompt` starts
   with `Use Skill("devops:do-ship") with args "--delegated[ <channel args>]".`
   and then carries the brief. A title that already starts with
   `🚀 Shipping – ` stays; otherwise apply Pre-Step C here, because a subagent
   cannot rename the session it runs in.
4. **Result.** The agent's last message ends with one fenced `json` block:
   - `{ "status": "decision", "question", "options", "recommended" }`: ask the
     question with `AskUserQuestion` (the recommended option goes first),
     then `SendMessage` the answer to the same agent and wait for its next
     result. Repeat until the status is `done`.
   - `{ "status": "done", "card": { … }, "exitWorktree": true|false }`: if
     `exitWorktree` is true, call `ExitWorktree({ action: "remove" })` first.
     Then call `render_completion_card` with `card`, adding `lang`, `cwd` and
     `session_id`, and deliver it like every card: the `[SESSION TITLE]` block
     first, then the widget or markdown as the last output.
   - **No JSON block**, or the agent failed: render a `ship-blocked` card that
     states the agent's last words as the reason. Never re-run the pipeline
     inline on your own; the user decides (`/do-ship --inline`).

## Subagent (`--delegated`)

The pipeline is the normal SKILL.md. Only these points differ:

| Step | Delegated behavior |
|---|---|
| Pre-Step 0 | Does not apply. You already are the delegated run. |
| Right after `ship_preflight` | Save the brief for a possible resume: `node "{PLUGIN_ROOT}/scripts/ship-checkpoint.js" brief --cwd "<cwd>"` with the brief on stdin (a heredoc). A checkpoint that already holds a brief keeps it. |
| `--resume` | Run Pre-Step R. The brief comes from `checkpoint.brief` when the prompt carries none. |
| An answer arrives by `SendMessage` | Record it first: `ship-checkpoint.js decision --cwd "<cwd>" --question "<q>" --answer "<a>"`. Then continue from the gate. A resumed run never asks the same question again. |
| Pre-Step A | Unchanged. If a lockout is active, its BLOCK and RECORD rules win over the decision return below. |
| Pre-Step B, Pre-Step C | Skip them. The parent owns both. |
| Every `AskUserQuestion` gate (1b(e) rebase conflict, 1d purpose alignment, Codex finding, major bump, the promotion question in `modes/promote.md`) | Do not call `AskUserQuestion`: it cannot reach the user from a subagent. Stop at the gate with nothing half-done: abort a rebase, leave nothing pushed that the answer could change. End your message with the `decision` JSON (`question`, `options` as short labels, `recommended`). The answer comes back as a `SendMessage`; continue from that same gate. |
| Step 5b Substep 2 (`ExitWorktree`) | Never call it. For a worktree this session entered through `EnterWorktree`, run `ship_cleanup({ …, keep: true })` and return `"exitWorktree": true`, and the parent removes the worktree. Leftover branches are `ship_hygiene`'s job. |
| Step 5b Substep 3 (re-open files) | Skip it. Those files were opened by the parent session. |
| Step 5e (memory dream) | Skip it. The learnings live in the parent's conversation, not in the brief. |
| Step 6 | Run everything that comes before the card: promotion-gap nudge, `ship_hygiene`, `delivery`, `validation`. Do **not** call `render_completion_card`. Return its full argument object as `card` (without `session_id`, `lang` and `cwd`) in the `done` JSON. Take `changes` and `validation` from the brief, plus what the ship itself found. |
| Sentinel hygiene | Unchanged. Before returning a `ship-blocked` card, call `ship_cleanup({ …, keep: true })`. |

End **every** return (`decision` and `done` alike) with exactly one fenced `json`
block and put no text after it. The parent parses that block and nothing else.
