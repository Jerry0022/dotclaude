# Routing Details — Execution per Branch

Execution detail for `/claude-learn` — the Q3 detection recipe it calls from
Step 2, then one section per branch for Step 3. The **decision** stays in the
skill body (Step 2, one matrix); this file only answers "I am in branch X, now
what exactly?" — so the decision never has to compete with the procedure for
attention.

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

Three outcomes, kept distinct — the middle one is the safety property of this
step and must not collapse into the third:

1. **Exactly one hint, resolving under `~/IdeaProjects/`** → that is the target.
   Confirm once with the user before writing.
2. **Any hint that does not resolve to a directory under `~/IdeaProjects/`** —
   path-shaped or not: `H:\work\legacy-crm`, a network share, a path that does
   not exist, or a bare name like "im Repo legacy-crm" that matches nothing
   there → **ask**. The user pointed somewhere specific; silently rewriting
   that to "the current project" files another project's rule into this one.
   This is *not* the no-hint case.
3. **No hint at all** → current project, no ask.

Conflicting hints → AskUserQuestion with the candidates plus "current project".

## A — Plugin repo, plugin rule: pick the file

In order of preference:

1. **Behavioral rule for an existing skill** → `plugins/devops/skills/<skill>/SKILL.md`.
   Extend the relevant Step or append a numbered rule. Keep steps tight; if the
   rule needs more than a few lines, put the bulk in that skill's sibling
   `deep-knowledge/` and reference it from the Step.
2. **Reference content / mental model / convention** → `{PLUGIN_ROOT}/deep-knowledge/<topic>.md`.
   Grep `{PLUGIN_ROOT}/deep-knowledge/INDEX.md` first for an existing file to
   append to. After creating a new one, regenerate the index:
   `node plugins/devops/scripts/gen-dk-index.js plugins/devops/deep-knowledge`.
3. **Agent behavior** → `plugins/devops/agents/<name>.md`.
4. **Hook behavior** → `plugins/devops/hooks/<phase>/<hook>.js`.

The repo-root `CLAUDE.md` is the last resort — only when neither a skill nor
deep-knowledge fits and the rule is a one-liner. The plugin directory has no
CLAUDE.md of its own; its conventions live in `{PLUGIN_ROOT}/CONVENTIONS.md`.

Every CLAUDE.md edit is measured by the `post.claude.budget` hook (25-line
budget) — do not eyeball line counts and do not re-check by hand. If it
reports, either extract per
`{PLUGIN_ROOT}/deep-knowledge/content-conventions.md` or say in Step 5 why you
left it; a reported overage that goes unmentioned is the failure this
measurement exists to prevent.

## B — Upstream issue: what to hand over

The plugin source repo's canonical slug is `Jerry0022/dotclaude`, derivable from
the installed `marketplace.json` as `{owner.name}/{name}`. Do NOT assume a local
checkout exists — pass the slug straight through.

Delegate to `/setup-issue` via the **Skill** tool (never `gh issue create`; see
`{PLUGIN_ROOT}/deep-knowledge/plugin-behavior.md` → "Issue Creation — Always
Delegate") with a self-contained prompt:

- **title** — `[BUG] <short>` for a defect, `[FEATURE] <short>` for a gap or
  improvement. Imperative, sentence case, no trailing period. The prefix must be
  one from the table in `{PLUGIN_ROOT}/skills/setup-issue/deep-knowledge/issue-rules.md`
  — `setup-issue` treats a format violation as a hard error.
- **body** — the full learning text, plus `Captured from a session in
  {current-project}.`, plus which plugin part it concerns (skill / hook / agent /
  MCP / convention), plus a `**User value:**` line. That line is mandatory:
  `setup-issue` Step 1a rejects an issue without one, and a rejected issue
  leaves the learning persisted nowhere. Phrase it as the effect on anyone using
  the plugin ("every project hitting X stops losing Y"), not as the effect on
  this session.
- **target repo** — the slug, so the issue lands upstream rather than in the
  consumer repo. `setup-issue` Step 1 takes this as `{target_repo}` and passes
  it to `gh issue create --repo`; its Step 4 verifies the returned URL's
  `owner/name` against it.
- **issue type** — `bug` or `feature` accordingly.

Nothing is persisted locally in this branch. Report the issue URL — and check
that its owner/name is the upstream slug before calling the handoff done. An
issue in the consumer repo is the exact failure this branch exists to prevent,
and it returns a perfectly valid-looking URL.

**If `setup-issue` declines** (its Step 1a user-value gate rejects the issue):
do not silently drop the learning — it would then be persisted nowhere at all.
Re-frame the body around the user-visible effect of fixing the defect ("every
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

### C-override — a deliberate deviation from a plugin default

The narrow case where the current project customizes plugin behavior and the
rule must **not** become the plugin default.

**Default is branch B — an upstream issue. If unsure, it stays B.** The entry
condition is a reason, and the reason has to be *why every other project would
be wrong to inherit this*, not why this project wants it. "Our branches are all
named `feature/xyz`, so `/ship` should allow slashes" is a plugin bug wearing a
project's clothes: every consumer with that naming hits it. Compare with "this
project's ship must skip the Docker publish step because it produces no
container artifact" — nothing to push upstream there.

A stated reason that only explains the local need is not a reason. Route to B.

1. Match the learning to a plugin skill by topic (`ship`, `commit`, `concept`,
   `flow`, …).
2. Create `{project}/.claude/skills/<skill>/SKILL.md` if absent, scaffolded from
   the same template as `claude-extend-skill` Step 4.2.
3. Append the rule under `## Project rules` — 1–3 lines each.
4. Longer than 3 lines → put the bulk in that folder's `reference.md` and leave
   a one-line pointer.

No skill matches → treat it as ordinary branch C content.

## D — Another project

Resolve the target's remote: `git -C "{target_project}" remote get-url origin`.

- **Has a GitHub remote** → delegate to `/setup-issue` via the **Skill** tool,
  never `gh issue create` (that skill enforces title format, labels, milestone,
  and project-board rules, including any project extension in
  `{target_project}/.claude/skills/setup-issue/` — see
  `{PLUGIN_ROOT}/deep-knowledge/plugin-behavior.md` → "Issue Creation — Always
  Delegate"). Target repo set to that project, title
  `[CHORE] Capture learning: <short>`, body = the learning plus
  `Captured from a session in {current-project}.`, type `chore`. The body must
  carry a `**User value:**` line naming what following the rule improves —
  `setup-issue` Step 1a rejects issues without one, and a rejected issue would
  leave the learning persisted nowhere. If it still declines, fall through to
  the no-remote path below and hand the user the prompt block.
- **No GitHub remote** → ask first. Default option (a): emit a copy-pastable
  block for the user to paste into that project's session —

  ```
  /claude-learn <learning text including all context>
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
