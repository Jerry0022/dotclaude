# Routing Details — Execution per Branch

Execution detail for `/do-learn` — the Q3 detection recipe it calls from
Step 2, then one section per branch for Step 3. The decision stays in the
skill body (Step 2).

Branch letters are the ones from the Step 2 matrix: A (plugin repo, plugin
rule), B (upstream issue), C (this project), D (another project), E (global).

## Detecting a different target project (feeds Step 2, Q3)

Most learnings target the current project — assume that unless the text
says otherwise. Scan for a hint, in this order:

1. **Explicit path** — `~/IdeaProjects/<name>`, or an absolute path that
   resolves inside `~/IdeaProjects/`.
2. **Project name** — list `~/IdeaProjects/*` one level deep, match
   case-insensitive substrings.
3. **Project keyword** — "in projekt X", "im X repo", "for the X app".

Three outcomes — keep the middle one distinct from the third:

1. **Exactly one hint, resolving under `~/IdeaProjects/`** → that is the target.
   Confirm once with the user before writing.
2. **Any hint that does not resolve to a directory under `~/IdeaProjects/`** —
   path-shaped or not: `H:\work\legacy-crm`, a network share, a path that does
   not exist, or a bare name like "im Repo legacy-crm" that matches nothing
   there → **ask**; silently falling back to the current project would file
   another project's rule into this one.
3. **No hint at all** → current project, no ask.

Conflicting hints → AskUserQuestion with the candidates plus "current project".

## A — Plugin repo, plugin rule: pick the file

**Defect first.** Most learnings that reach this branch describe plugin code
misbehaving (a hook blocking the wrong command, a cleanup script trusting a
bad ref, an MCP server dying at boot). Fix them where the code lives —
`hooks/`, `scripts/`, `mcp-server/` — with a regression test beside the
module; write a `.md` rule only for the *convention* the fix establishes, if
any, where the file list below says.

For a rule (no code at fault), in order of preference:

1. **Behavioral rule for an existing skill** → `plugins/devops/skills/<skill>/SKILL.md`.
   Extend the relevant Step or append a numbered rule. Keep steps tight; if the
   rule needs more than a few lines, put the bulk in that skill's sibling
   `deep-knowledge/` and reference it from the Step.
2. **Reference content / mental model / convention** → `{PLUGIN_ROOT}/deep-knowledge/<topic>.md`.
   Grep `{PLUGIN_ROOT}/deep-knowledge/INDEX.md` first for an existing file to
   append to. After creating a new one, regenerate the index:
   `node plugins/devops/scripts/gen-dk-index.mjs plugins/devops/deep-knowledge`.
3. **Agent behavior** → `plugins/devops/agents/<name>.md`.
4. **Hook behavior** → `plugins/devops/hooks/<phase>/<hook>.js`.

The repo-root `CLAUDE.md` is the last resort — only when neither a skill nor
deep-knowledge fits and the rule is a one-liner. The plugin directory has no
CLAUDE.md of its own; its conventions live in `{PLUGIN_ROOT}/CONVENTIONS.md`.

The `post.claude.budget` hook measures every CLAUDE.md edit (25-line budget).
If it reports, extract per `{PLUGIN_ROOT}/deep-knowledge/content-conventions.md`
or say in Step 5 why you left it.

## B — Upstream issue: what to hand over

The plugin source repo's canonical slug is `Jerry0022/dotclaude`, derivable from
the installed `marketplace.json` as `{owner.name}/{name}`. Pass the slug straight
through; do not assume a local checkout exists.

Delegate to `/auto-issue` via the **Skill** tool (never `gh issue create`; see
`{PLUGIN_ROOT}/deep-knowledge/plugin-behavior.md` → "Issue Creation — Always
Delegate") with a self-contained prompt:

- **title** — `[BUG] <short>` for a defect, `[FEATURE] <short>` for a gap or
  improvement. Imperative, sentence case, no trailing period. The prefix must be
  one from the table in `{PLUGIN_ROOT}/skills/auto-issue/deep-knowledge/issue-rules.md`
  — `auto-issue` treats a format violation as a hard error.
- **body** — the full learning text, plus `Captured from a session in
  {current-project}.`, plus which plugin part it concerns (skill / hook / agent /
  MCP / convention), plus a `**User value:**` line (`auto-issue` Step 1a
  rejects an issue without one) phrased as the effect on anyone using the
  plugin ("every project hitting X stops losing Y"), not on this session.
- **target repo** — the slug, so the issue lands upstream rather than in the
  consumer repo. `auto-issue` Step 1 takes this as `{target_repo}` and passes
  it to `gh issue create --repo`; its Step 4 verifies the returned URL's
  `owner/name` against it.
- **issue type** — `bug` or `feature` accordingly.

Nothing is persisted locally in this branch. Report the issue URL after
checking its owner/name is the upstream slug — an issue in the consumer repo
also returns a valid-looking URL.

**If `auto-issue` declines** (user-value gate): do not drop the learning —
re-frame the body around the user-visible effect of fixing the defect ("every
project using the plugin keeps hitting X"), or fall back to branch D's
copy-pastable prompt so the user can file it themselves.

## C — This project: pick the container

Prefer the largest fitting container: **deep-knowledge > skill > CLAUDE.md**.

- **Reference / explanation / mental model** → `{project}/.claude/deep-knowledge/<topic>.md`
  (e.g. `architecture.md`, `data-flow.md`). Mirrors the plugin's own layout,
  under `.claude/` so all project-level Claude config sits in one place
  (`{PLUGIN_ROOT}/deep-knowledge/claude-directory-structure.md`). Create the
  directory if missing; append under a short heading.
- **Behavioral rule (when X, do Y)** → a project skill. Append to a matching
  `{project}/.claude/skills/<skill>/SKILL.md` if one exists. Otherwise ask via
  AskUserQuestion: create a new project skill, or fall back to deep-knowledge.

Append a one-line pointer to `{project}/CLAUDE.md` only as a last resort, so the
new file gets discovered. The `post.claude.budget` hook measures the result;
relay what it says rather than counting lines yourself.

### Scheduled-task rules — the runbook is the home

A learning about a Desktop scheduled task (the routine forgets pushed-but-
unmerged branches, lets review holds rot, leaves idle-tick sessions
un-archived) has exactly one home: **the file the task reads at the moment
the rule applies**.

1. Read `~/.claude/scheduled-tasks/<name>/SKILL.md` and find the runbook it
   delegates to (typically `docs/<routine>.md` or `.claude/deep-knowledge/…`
   inside the project it names). A rule for the *work path* — what to do with
   a queue item, how to ship, what to verify — goes into that runbook, under
   the step it changes. The runbook is repo-tracked, so the rule ships with
   the project and survives task re-creation.
2. Only a rule for the *tick itself* — the gate, the idle exit, session
   hygiene, what runs before the runbook is opened — goes into the task's
   `SKILL.md`. Edit it in place; a twin task with an identical body (a day/
   night pair) gets the same edit.
3. Never a third file — rules split across several files leave the next run
   unable to tell which one wins.

The task's `SKILL.md` lives under `~/.claude/`, but it exists for one project
only — routing treats it as that project's file (branch C, no branch-E ask).
The commit of a runbook change goes through the project's normal ship path;
the `pre.ship.guard` hook blocks a hand-rolled `gh pr create`/`gh pr merge`
from here just as it does anywhere else.

### C-override — a deliberate deviation from a plugin default

The narrow case where the current project customizes plugin behavior and the
rule must **not** become the plugin default.

The entry condition (SKILL.md tie-breaker 3) is a reason *why every other
project would be wrong to inherit this*, not why this project wants it. "Our branches are all
named `feature/xyz`, so `/do-ship` should allow slashes" is a plugin bug wearing a
project's clothes: every consumer with that naming hits it. Compare with "this
project's ship must skip the Docker publish step because it produces no
container artifact" — nothing to push upstream there.

A reason that only explains the local need does not count.

1. Match the learning to a plugin skill by topic (`ship`, `fix`, `concept`,
   `flow`, …).
2. Create `{project}/.claude/skills/<skill>/SKILL.md` if absent, scaffolded from
   the same template as `auto-extend` Step 3.
3. Append the rule under `## Project rules` — 1–3 lines each.
4. Longer than 3 lines → put the bulk in that folder's `reference.md` and leave
   a one-line pointer.

No skill matches → treat it as ordinary branch C content.

## D — Another project

Resolve the target's remote: `git -C "{target_project}" remote get-url origin`.

- **Has a GitHub remote** → delegate to `/auto-issue` via the **Skill** tool,
  never `gh issue create` (that skill enforces title format, labels, milestone,
  and project-board rules, including any project extension in
  `{target_project}/.claude/skills/auto-issue/` — see
  `{PLUGIN_ROOT}/deep-knowledge/plugin-behavior.md` → "Issue Creation — Always
  Delegate"). Target repo set to that project, title
  `[CHORE] Capture learning: <short>`, body = the learning plus
  `Captured from a session in {current-project}.` and a `**User value:**` line
  naming what following the rule improves, type `chore`. If it declines, fall
  through to the no-remote path below.
- **No GitHub remote** → ask first. Default option (a): emit a copy-pastable
  block for the user to paste into that project's session —

  ```
  /do-learn <learning text including all context>
  ```

  plus a one-line summary of what the rule should achieve. Option (b), only on
  explicit confirmation: apply the change directly with Edit/Write.

## E — Global or unscoped

Ask before writing anything under `~/.claude/`:

> "Diese Regel betrifft globale Claude-Anweisungen (nicht projektspezifisch).
> Soll ich sie wirklich global persistieren oder lieber projektspezifisch?"
>
> 1. Global in `~/.claude/…` (proceed)
> 2. Stattdessen im aktuellen Projekt persistieren (re-route to B or C)
> 3. Abbrechen

Never write `~/.claude/CLAUDE.md` without explicit confirmation.
