# Strict Mode — Literal Scope, Discretionary Parameters

The deliverable is exactly what the prompt names, nothing wider; attributes the prompt leaves open are Claude's call and every such choice is reported. Former `claude-strict` skill (skill restructure PR 3).

Spec: `docs/superpowers/specs/2026-09-04-claude-strict-design.md`

The user says what may change. That set is closed. What the user does NOT
say about it (the colour of the border, the exact pixel value, the wording of
a label) is yours to decide — and to report, so a wrong guess is a one-word
correction instead of a wrong diff.

Strict is **not a skill** any more. State lives in `.claude/strict-mode.json`
of the **current worktree**. The hooks `prompt.strict.enforce` (switch +
inject), `pre.strict.agent-gate` (refuse agent spawns without the block) and
`stop.strict.release` (bind or release an inline mode) do the mechanical part;
this document is the judgment part. It propagates to every skill, agent,
auto-concept iteration and autonomous resume the turn starts, and it is never
project-wide.

## Switching strict on and off

`prompt.strict.enforce` reads the raw prompt. Every form below works; the
plain-word forms are the reliable ones — a prompt that STARTS with a slash name
that is no longer a skill (`/claude-strict on`) may be rejected by the harness
before any hook runs (skill-restructure spec § Triggers; undocumented either
way). `/claude-strict` anywhere inside a prompt always reaches the hook.

| The user types | Effect |
|---|---|
| `strict on` · `strikt an` · `strict mode on` · `strikt modus an` · `/claude-strict on` | branch mode — this worktree + branch, until `off` or a branch switch |
| `strict off` · `strikt aus` · `strict mode off` · `/claude-strict off` | clears the mode |
| `strict status` · `/claude-strict status` · `/claude-strict` | status |
| `strict: <task>` · `strikt: <task>` · `/claude-strict <task>` | inline — this turn only (bound to a workflow the turn starts) |
| "genau so und nicht mehr", "nur das ändern", "nichts anderes anfassen" anywhere in the prose | inline — this turn only |
| do-run question 3 "Strikt" | inline — for the run (`strict-state.js inline`) |
| a bare "strict" / "strikt" | nothing is armed; this document is pointed at, you decide |

The switch words must be the **whole prompt** (`strict on`, optionally with a
trailing `.`/`!`), so prose like "make the TS config strict on CI" never flips
anything. `strict: true …` is config talk, not a task. Words inside code spans
or quotes never count.

**A bare "strict" or "strikt"** in a prompt is a signal, not a switch. When the
user plainly asks for literal scope for this task, arm an inline mode yourself
(`node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/strict-state.js" inline`, then print the
contract with `… contract`) and work under it. Do NOT for: ordinary requests
without a literal-scope signal, the auto-harden / auto-polish scope fences
(they stay as they are), or TypeScript / linter `strict` options.

## Routing a turn

When the contract block is in your context, the hook has already done the
switch. Read the route from the prompt:

| Prompt | Do |
|---|---|
| `on`-form | one line: branch name, and that other worktrees are not affected; run `status` (below) to confirm, never assume |
| `off`-form | one line; nothing else changes |
| `status`-form | relay the state as one human line (see below) |
| *anything else* (free text, a literal-scope phrase, or another slash command such as `/do-run …`) | **task** — execute it under the contract below |

A task is never filed or deferred: `strict: /do-run audit Rand-Varianten`
means "run /do-run audit, strictly". The hook has already armed an inline mode
for this turn (`reason: inline`); you do not arm it again.

## The contract

This block is the single source of truth, mirrored from
`hooks/lib/strict-state.js` (`CONTRACT_BLOCK`) — a test keeps the two
identical. It is already in your context this turn (injected by the hook);
read it as binding, not as advice.

```
[claude-strict contract]
SCOPE IS LITERAL — measured in the vocabulary of the request.
- Only what the request names changes. No refactor, rename, doc update, new
  test, reformatting of untouched lines, "while I'm here", new file /
  dependency / abstraction.
- Visual request ("the box border") → only that visible element changes; the
  technical route (import, selector) is yours if nothing else visible changes.
  Technical request ("rename fn X") → only that symbol.
DISCRETION covers ATTRIBUTES the request leaves open (colour, px, wording),
never the OBJECT. Ambiguous object: interactive → ask; autonomous → touch the
single most probable one; lead the report with the assumption.
TESTS: an assertion pinning the exact old value may be updated. Any other
failure → apply nothing, revert, report.
PRECEDENCE (scope only): overrides doc-maintenance, pre-mortem outputs, "make
reasonable decisions independently", concept zero-prompt invariant. Completion
card, do-ship docs-sync and auto-polish approval stay.
PROPAGATION: put this block verbatim at the top of every Agent prompt and
every skill you invoke; it binds concept iterations and autonomous resumes.
REPORT (≤4 lines, before the card, omit empty lines):
  strict — requested: <literal ask>
  done: <what changed, file:line>
  chosen: <attribute = value (unspecified)>
  untouched: <noticed but out of scope>
[/claude-strict contract]
```

The marker lines keep the name `claude-strict`: they are the wire format
`pre.strict.agent-gate` looks for in every Agent prompt, and renaming them
would refuse agents of a run that started before the rename.

**How to read "vocabulary of the request".** The scope is measured at the
level the user spoke. "Make the box border thinner" is a visual request: the
border is the scope, and whether you edit a CSS variable, a class, or add the
one import that the change needs is your business — as long as no other
visible thing changes. "Rename `fetchUser` to `loadUser`" is a technical
request: the symbol is the scope, its call sites are the same symbol, its
docstring is not. Never translate a visual request into a technical scope
that is wider than the visual one ("the border is in a shared mixin, so I
updated the mixin" changes every box — that is not the request).

**Grey zone, one rule each:**

| Case | Rule |
|---|---|
| The change needs a syntactic companion (import, export entry, existing registry line) | In scope. Report it under `done`. A new file, dependency or abstraction is NOT a companion — that is out. |
| A test asserts the exact old value | Update that assertion; it IS the requested change. Report it. |
| Any other test fails | Apply nothing, revert what you tried, report under `untouched` with the failing test's name. The consequence is the user's call. |
| The named element would become invisible or non-functional | Stop before applying and report. Malicious compliance is not compliance. |
| An adjacent element now looks off | Do the change; the neighbour goes to `untouched`. |
| The object is ambiguous ("the border" — there are three) | Interactive: ask with `AskUserQuestion`, the candidates as options. Autonomous (agent directive says no questions, `AUTONOMOUS_*` prompt, lockout flag present): change the single most probable one and make the assumption the first `done` line. |
| The request is impossible or contradicts the code | Change nothing, report. |

## Executing the task under the contract

1. Read the task text (the remainder after the switch word, or the whole
   prompt for a literal-scope phrase). Identify the **objects** (closed set)
   and the **open attributes** (your call).
2. Do the work. Apply the pre-mortem as thinking only — its outputs (extra
   guards, extra tests, narrowed scope) are diff and go to `untouched`.
3. **Propagation — mandatory, mechanical:**
   - **Agent** tool: the prompt starts with the contract block, verbatim.
     The gate refuses a spawn without it; on refusal, prepend and retry — do
     not paraphrase the block. Nested agents inherit the same duty; say so
     in the agent prompt ("forward this block to every agent you spawn").
   - **Skill** tool: invoke the other skill normally; the contract is in
     context. Where the callee has a flag channel (auto-harden,
     auto-polish: `--invoked-by=…`), also pass `--strict`. For /auto-concept:
     the `implement` action executes the literally selected items only;
     `iterate` is unchanged (it never touches code anyway).
   - **Autonomous** runners (`/do-run autonomous`, `/do-run backlog`, auto-agents):
     include `strict=on` in the task line of any `AUTONOMOUS_AUTOSTART:` /
     `RUN_BACKLOG_AUTOSTART:` cron prompt you create, so a re-launched session
     re-reads the contract from the prompt even before the hook fires.
4. **Multi-turn workflows.** If this turn starts a concept session or an
   autonomous run, the Stop hook binds the inline mode to it automatically
   (`.claude/concept-active.json`, `AUTONOMOUS-LOCKOUT.flag`) and releases it
   when that file disappears. Announce the binding in one line when you see
   it happen (the hook writes `[claude-strict] … bound to …` on stderr);
   nothing to arm by hand.

## Strict report, then the card

Right before the completion card, ≤ 4 lines, omit empty ones, no prose
around it:

```
strict — requested: box border thinner
done: src/box.css:12 border-width 2px → 1px
chosen: border-color #3a3a3a (unspecified — was inherited grey)
untouched: focus ring now overlaps the border; docs/ui.md still says 2px
```

- `requested` — the literal ask in the user's words.
- `done` — every change, `file:line`. Companion edits (import, assertion)
  are listed here, not hidden.
- `chosen` — every attribute you decided. No line when nothing was open.
- `untouched` — everything you noticed and deliberately did not change:
  doc debt, adjacent glitches, failing tests, refactor bait. Before writing
  this line, grep the repo for the OLD value you replaced (`4px`, the old
  colour, the old name): every hit outside `done` — a doc, a test, a sibling
  selector — is an `untouched` entry. Reading is free under strict; only
  the diff is closed.

Then render the completion card as usual (the card is output, not diff).

## The state CLI — `on` / `off` / `status` / `inline`

All four go through the state CLI; never edit the mode file by hand:

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/strict-state.js" on
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/strict-state.js" off
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/strict-state.js" status
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/strict-state.js" inline
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/strict-state.js" contract
```

- **on** — arms strict for this worktree on the current branch, no expiry.
  Every later prompt in this worktree is strict until `off` or a branch
  switch. Confirm in one line: branch name, and that other worktrees are not
  affected. If the CLI reports `branch: null` (no git repo), say the mode is
  bound to the directory instead.
- **off** — clears the mode. One line.
- **status** — relay the JSON as one human line: active or not, reason,
  branch, bound workflow, expiry. When `why` is `branch-mismatch`, say which
  branch armed it and offer `strict on` / `strict off`.
- **inline** — arms an inline mode for this turn / run, never over an active
  branch mode (`kept: true` then). The do-run "Strikt" answer and a
  model-decided arm (bare "strict", see above) use it.
- **contract** — prints the block, to prepend to an Agent prompt.

The hook already performed `on`/`off` when the switch was typed, so the CLI
call is idempotent — run `status` anyway and report what it returns; never
assume.

## What strict is NOT

- Not a caution mode. Do not ask more questions than the ambiguity rule
  requires; do not add confirmation gates.
- Not a refusal mode. A request that needs one import gets the import.
- Not a replacement for the auto-harden / auto-polish scope fences; strict
  is at least as narrow and composes with them.
- Not project-wide. `on` binds to the worktree + branch you are in.

## Project overrides (former skill extension)

A consumer extension written for the old skill —
`{project}/.claude/skills/claude-strict/reference.md` (or `SKILL.md`), or the
same under `~/.claude/skills/claude-strict/` — is not loaded by any skill any
more. When `prompt.knowledge.dispatch` points at this document it names such a
file if one exists; read it and let it override this document (project >
global > this document). Nothing else reads it.
