# claude-strict — Literal Scope, Discretionary Parameters

**Date:** 2026-09-04
**Status:** Approved for implementation
**Skill:** `/claude-strict`

## Problem

Some prompts mean exactly what they say. "Make the box border thinner" is a
request about one border — not about the padding next to it, not about the
three other borders that "look inconsistent", not about the CSS file's
formatting, and not about the docs that mention the box. Today nothing in the
plugin holds that line: `code-defaults.md` says "minimal changes only" but is
loaded on demand, once per session, and is never forwarded to spawned agents;
several always-on mandates actively push the other way (agents must update
docs in the same change, pre-mortem output becomes extra guards and tests,
autonomous agents "make reasonable decisions independently").

The user wants a mode where the **deliverable is literal** and only the
**parameters the prompt leaves open** are Claude's call — and where that holds
for every skill, agent, and concept iteration the prompt sets in motion.

## Non-goals

- A general "be careful" or "ask more" mode. Strict is about *scope*, not
  about caution. It must not turn into a nag loop.
- Blocking tool calls on semantic grounds. The hooks enforce the *mechanics*
  (contract present, mode persisted); the model enforces the *judgment*.
- Replacing `/tune-harden` / `/tune-polish` scope fences. Those stay.

## The contract

Injected verbatim as one block. Canonical text lives in
`hooks/lib/strict-state.js` (`contractText()`); `SKILL.md` carries the same
block and a test asserts they are identical.

```
[claude-strict contract]
SCOPE IS LITERAL — measured in the vocabulary of the request.
- The request names WHAT may change. Nothing else changes: no refactor, no
  rename, no doc update, no new test, no formatting of untouched lines, no
  "while I'm here", no new file / dependency / abstraction.
- Visual request ("the box border") → only that visible element changes; the
  technical route (import, variable, selector) is yours as long as nothing
  else visible changes. Technical request ("rename fn X") → only that symbol.
DISCRETION covers ATTRIBUTES the request leaves open (colour, px, wording),
never the OBJECT. Ambiguous object: interactive → ask; autonomous → touch the
single most probable one and lead the report with the assumption.
TESTS: an assertion that pins the exact old value may be updated. Any other
failure → apply nothing, revert, report.
PRECEDENCE (scope axis only): this block overrides doc-maintenance, pre-mortem
outputs, "make reasonable decisions independently", and the concept
zero-prompt invariant. Completion card, /ship docs-sync, tune-polish approval
rule stay in force.
PROPAGATION: forward this block verbatim at the top of every Agent prompt and
every skill you invoke; it binds concept iterations and autonomous resumes.
REPORT (≤4 lines, before the card, omit empty lines):
  strict — requested: <literal ask>
  done: <what changed, file:line>
  chosen: <attribute = value (unspecified)>
  untouched: <noticed but out of scope>
[/claude-strict contract]
```

The block is ≤ 1 400 characters. It is injected **once per turn** by the
UserPromptSubmit hook; no other hook injects text (cost control, no
duplication).

## Modes and state

One state file, two ways to arm it: `.claude/strict-mode.json` in the
**worktree** (each git worktree has its own `.claude/`, so a mode never
leaks into another worktree of the same repo). Gitignored via the
`/setup-project` runtime block, same as `batch-mode.json`.

```json
{
  "active": true,
  "branch": "feat/42-box",
  "reason": "on" | "inline" | "concept" | "autonomous",
  "boundTo": ".claude/concept-active.json" | "AUTONOMOUS-LOCKOUT.flag" | null,
  "sessionId": "…",
  "startedAt": "ISO",
  "expiresAt": "ISO" | null
}
```

| Invocation | reason | Lifetime |
|---|---|---|
| `/claude-strict on` | `on` | Until `/claude-strict off`, or the worktree's branch no longer equals `branch` (one-time notice, then inactive). No expiry — the user chose branch scope. |
| `/claude-strict <task>` or inline mention `/claude-strict …` | `inline` | This turn (all agents spawned in it). At Stop: if a workflow binding file exists → re-bound (`concept` / `autonomous`); else released. |
| auto-bound | `concept` / `autonomous` | Until the bound file disappears (concept `/shutdown` removes `concept-active.json`; the lockout `clear` removes the flag), or `off`. Safety expiry 24 h. |

**Branch check.** `isActive(cwd)` compares the stored `branch` to
`git rev-parse --abbrev-ref HEAD` (5 s timeout, `unknown` when not a repo →
branch check skipped). A `reason: on` mode with a different branch is
inactive and the next prompt hook reports once: "strict was armed on
`<branch>`; current branch differs — `/claude-strict on` to re-arm here."

**Worktree agents.** Agents spawned with `isolation: worktree` run in a
different cwd. The agent gate resolves the mode as: own cwd → else the repo's
main worktree (`git rev-parse --git-common-dir` → parent) when the current
branch starts with the stored branch (`<parent>-<role>` / `<parent>/<role>`
sub-branch conventions). Failing that, the contract in the agent's own prompt
(enforced by the gate at the parent level) is the carrier.

**Batch interaction.** A prompt that `/claude-batch` will collect (exit 2,
erased) never arms strict — `willBeCollected()` from `batch-state.js` is
honoured. At batch merge time the contract, if active, applies per note:
each note's scope is literal; the merge does not widen it.

## Hooks

| Hook | Event / matcher | Behaviour |
|---|---|---|
| `prompt.strict.enforce` | UserPromptSubmit | Detect mention (`/claude-strict` as its own token — not in backticks, not a path segment; or `<command-name>` = claude-strict, args parsed for `on/off/status`). Mention + not collected → arm `inline` (or `on/off` per args). If active or mentioned → emit the contract as `additionalContext`, prefixed by one status line (`strict: on · branch X · /claude-strict off`). Machine prompts (cron, `AUTONOMOUS_*`) get the injection too — they are exactly the turns that must stay strict. |
| `pre.strict.agent-gate` | PreToolUse `Agent` | Active (own cwd or inherited) and `tool_input.prompt` lacks `[claude-strict contract]` → `permissionDecision: deny` with reason "strict is active — prepend the contract block (print it with `node <lib> contract`) and retry". Present → allow silently. Inactive → silent. Fires recursively inside subagents (plugin hooks run there). |
| `stop.strict.release` | Stop | `reason: inline` → bind to `concept-active.json` / `AUTONOMOUS-LOCKOUT.flag` if present, else delete the mode. Bound modes whose file is gone → delete. Never touches `reason: on`. |

`updatedInput` is **not** used: Claude Code ignores it for the Agent tool
(anthropics/claude-code#44412). `additionalContext` on PreToolUse is not
relied on either.

Verified in-session on 2026-09-04: UserPromptSubmit hooks fire on
task-notification turns (agent completion and background-Bash completion),
so the injection reaches concept iterations that arrive via the pickup waker.

## Skill

`skills/claude-strict/SKILL.md` — frontmatter per CONVENTIONS (folded
description, `argument-hint: "<task> | on | off | status"`, `allowed-tools`
incl. `Bash(node *)`, `Skill`, `AskUserQuestion`, card renderer).

- Step 0 — extensions (mandatory pattern).
- Step 1 — route on the first token: `on` / `off` / `status`; anything else
  (including another slash command) is the task → Step 3.
- Step 2 — the contract block (verbatim, single source of truth mirrored).
- Step 3 — execute the task under the contract. If the task invokes another
  skill (`/claude-strict /concept …`), invoke it with the contract already in
  context and pass `--strict` where the callee has a flag channel
  (`tune-harden`, `tune-polish`). Announce auto-binding in one line when a
  workflow starts.
- Step 4 — strict report, then the completion card.
- Step 5 — `on` / `off` / `status` via `node {PLUGIN_ROOT}/hooks/lib/strict-state.js <cmd>`.

## Overlap resolution

| Existing rule | Resolution |
|---|---|
| `deep-knowledge/code-defaults.md` § Change Philosophy | Referenced as the always-on base. New § "Strict mode" states that the contract block supersedes doc-maintenance, pre-mortem outputs, and reasonable-defaults directives on scope. |
| `deep-knowledge/documentation-maintenance.md` + agent doc rules | Overridden per turn under strict; doc debt goes to `untouched`. `/ship` Step 2.6 unchanged. |
| `deep-knowledge/agent-orchestration.md` § Agent Prompt Template | New item 9: "Scope contract — when the `[claude-strict contract]` block is in context, forward it verbatim at the top of the prompt." |
| `plugin-behavior.md` § Completion Flow | Unchanged; the card is output, not diff. |
| `/tune-polish` approval rule, `/tune-harden` no-new-UI | Unchanged; strict is at least as narrow. |
| `/concept` zero-prompt invariant (finalize) | Unchanged for the wizard; the *implement* action binds "the decisions" to the literally selected items. |
| `prompt.skill.enforce` | Detects `/claude-strict` mentions and forces the skill load; strict's own hook does the arming, so ordering between the two does not matter. |

## Testing

Mechanical (deterministic, vitest):
- `hooks/lib/strict-state.test.js` — activate/deactivate, branch mismatch,
  binding release, expiry, mention detection (backticks, path segment,
  `strict: true`, expanded command with args), `willBeCollected` guard,
  contract size cap, CLI subcommands.
- `hooks/user-prompt-submit/prompt.strict.enforce.test.js` — stdin-spawn per
  batch-hook pattern: arms on mention, injects when active, silent when off,
  no arm when batch collects, branch-mismatch notice once, machine prompt
  still injected.
- `hooks/pre-tool-use/pre.strict.agent-gate.test.js` — deny without block,
  allow with block, silent when inactive, inherited worktree case.
- `hooks/stop/stop.strict.release.test.js` — inline released / re-bound,
  bound released when file gone, `on` untouched.
- `skills/claude-strict/skill-text.test.js` — contract block ≡ lib text,
  routing table rows, propagation clause names Agent/Skill/concept/autonomous.
- Existing: `frontmatter-yaml.test.js`, `gen-readme-sections --check`.

Semantic (scripted `claude -p` runs against a temp repo, 1 retry allowed,
documented in `skills/claude-strict/deep-knowledge/e2e-scenarios.md`):
1. Border request → diff touches only the border declaration.
2. Unspecified colour → `chosen:` line present; no `chosen:` when nothing was open.
3. Agent spawn without the block → gate denies, retry carries the block.
4. `on` in worktree A → prompt in worktree B of the same repo is not strict.
