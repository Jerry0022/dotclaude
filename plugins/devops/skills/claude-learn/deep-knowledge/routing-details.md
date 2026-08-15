# Routing Details — Execution per Branch

Execution detail for `/claude-learn` Step 3. The **decision** lives in the skill
body (Step 2, one matrix); this file only answers "I am in branch X, now what
exactly?" — so the decision never has to compete with the procedure for
attention.

Branch letters are the ones from the Step 2 matrix: A (plugin repo, plugin
rule), B (upstream issue), C (this project), D (another project), E (global).

## Detecting a different target project (feeds Step 2, Q3)

Most learnings target the current project — assume that unless the text
says otherwise. Scan for a hint, in this order:

1. **Explicit path** — `~/IdeaProjects/<name>` or any absolute path.
2. **Project name** — list `~/IdeaProjects/*` one level deep, match
   case-insensitive substrings.
3. **Project keyword** — "in projekt X", "im X repo", "for the X app".

Exactly one hint resolving to a real directory → that is the target; confirm
once with the user before writing. No hint → current project, no ask. Conflicting
hints → AskUserQuestion with the candidates plus "current project".

## A — Plugin repo, plugin rule: pick the file

In order of preference:

1. **Behavioral rule for an existing skill** → `plugins/devops/skills/<skill>/SKILL.md`.
   Extend the relevant Step or append a numbered rule. Keep steps tight; if the
   rule needs more than a few lines, put the bulk in that skill's sibling
   `deep-knowledge/` and reference it from the Step.
2. **Reference content / mental model / convention** → `plugins/devops/deep-knowledge/<topic>.md`.
   Grep `deep-knowledge/INDEX.md` first for an existing file to append to. After
   creating a new one, regenerate the index:
   `node plugins/devops/scripts/gen-dk-index.js plugins/devops/deep-knowledge`.
3. **Agent behavior** → `plugins/devops/agents/<name>.md`.
4. **Hook behavior** → `plugins/devops/hooks/<phase>/<hook>.js`.

`plugins/devops/CLAUDE.md` and the root `CLAUDE.md` are the last resort — only
when neither a skill nor deep-knowledge fits and the rule is a one-liner. After
any CLAUDE.md edit, invoke `/claude-lint` via the **Skill** tool; do not eyeball
line counts.

## B — Upstream issue: what to hand over

The plugin source repo's canonical slug is `Jerry0022/dotclaude`, derivable from
the installed `marketplace.json` as `{owner.name}/{name}`. Do NOT assume a local
checkout exists — pass the slug straight through.

Delegate to `/setup-issue` via the **Skill** tool (never `gh issue create`; see
`deep-knowledge/plugin-behavior.md` → "Issue Creation — Always Delegate") with a
self-contained prompt:

- **title** — `[BUG] <short>` for a defect, `[FEAT] <short>` for a gap or
  improvement. Imperative, sentence case, no trailing period.
- **body** — the full learning text, plus `Captured from a session in
  {current-project}.`, plus which plugin part it concerns (skill / hook / agent /
  MCP / convention).
- **target repo** — the slug, so the issue lands upstream rather than in the
  consumer repo.
- **issue type** — `bug` or `feature` accordingly.

Nothing is persisted locally in this branch. Report the issue URL.

## C — This project: pick the container

Prefer the largest fitting container: **deep-knowledge > skill > CLAUDE.md**.

- **Reference / explanation / mental model** → `{project}/.claude/deep-knowledge/<topic>.md`.
  Mirrors the plugin's own layout, under `.claude/` so all project-level Claude
  config sits in one place (`deep-knowledge/claude-directory-structure.md`).
  Create the directory if missing; append under a short heading.
- **Behavioral rule (when X, do Y)** → a project skill. Append to a matching
  `{project}/.claude/skills/<skill>/SKILL.md` if one exists. Otherwise ask via
  AskUserQuestion: create a new project skill, or fall back to deep-knowledge.

Append a one-line pointer to `{project}/CLAUDE.md` only as a last resort, so the
new file gets discovered — then run `/claude-lint`.

### C-override — a deliberate deviation from a plugin default

The narrow case where the current project customizes plugin behavior and the
rule must **not** become the plugin default. Requires a stated reason; without
one it is branch B.

1. Match the learning to a plugin skill by topic (`ship`, `commit`, `concept`, …).
2. Create `{project}/.claude/skills/<skill>/SKILL.md` if absent, scaffolded from
   the `claude-extend-skill` template.
3. Append the rule under `## Project rules` — 1–3 lines each.
4. Longer than 3 lines → put the bulk in that folder's `reference.md` and leave
   a one-line pointer.

No skill matches → treat it as ordinary branch C content.

## D — Another project

Resolve the target's remote: `git -C "{target_project}" remote get-url origin`.

- **Has a GitHub remote** → delegate to `/setup-issue` with target repo set to
  that project, title `[CHORE] Capture learning: <short>`, body = the learning
  plus `Captured from a session in {current-project}.`, type `chore`.
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
