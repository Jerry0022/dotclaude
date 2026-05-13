---
name: devops-learn
version: 0.1.0
description: >-
  Capture a long-term learning/correction and route it to the correct project-
  specific instructions (skill, skill-extension, deep-knowledge, or as a last
  resort CLAUDE.md) — NOT to personal feedback memory. Handles four targets:
  (1) the devops plugin source itself when invoked from dotclaude, (2) a project-
  specific skill-extension when invoked from a consumer project and the learning
  fits an existing plugin skill, (3) a new project-specific skill or deep-knowledge
  file otherwise, (4) a different project entirely — via GitHub issue if the repo
  has a GitHub remote, otherwise via a copy-pastable prompt block. Asks before
  any global or cross-project file change that is not an issue.
  Triggers ONLY on explicit invocation: "/devops-learn", "lerne das", "merk dir das
  fürs Projekt", "remember this for the project", "capture learning". Do NOT
  trigger for one-off conversational corrections or for personal feedback memory.
argument-hint: "<learning text>"
disable-model-invocation: true
allowed-tools: Bash(git *), AskUserQuestion, Read, Write, Edit, Glob, Grep, Skill, mcp__plugin_devops_dotclaude-completion__render_completion_card
---

# Learn — Capture a Project-Persistent Learning

Persist a correction or learning into the correct project's instructions so it
survives across sessions. Personal-style feedback (response style, language,
tone) still belongs in auto-memory and is handled elsewhere — this skill is for
**project-specific or plugin-specific** rules.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/learn/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/learn/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 1 — Collect the learning text

If the user passed text after `/devops-learn`, that is the learning. Otherwise
ask one short question: "Was soll ich langfristig lernen?"

The learning text MUST be a self-contained rule. If it is vague ("the colors
were wrong"), ask one clarifying question before continuing. Capture **why**
the rule exists when the user volunteers it — future Claude needs the *why* to
judge edge cases.

## Step 2 — Detect current project context

Identify which repo we are in:

```bash
git rev-parse --show-toplevel
```

Determine whether the current project IS the devops plugin source repo:

- It is the plugin source if `{git-root}/plugins/devops/.claude-plugin/plugin.json`
  exists AND its `name` field equals `devops` (use Read on the JSON).
- Otherwise it is a **consumer project**.

Store as `{is_plugin_repo}`.

## Step 3 — Auto-detect target project from text

Scan the learning text for project hints (in this order):

1. **Explicit path** matching `~/IdeaProjects/<name>` or any absolute path
2. **Project name** appearing in user's other worktrees — list candidates from
   `~/IdeaProjects/*` (one directory deep) and match case-insensitive substrings
3. **Project keyword** like "in projekt X", "im X repo", "for the X app"

If exactly one hint resolves cleanly to a directory under `~/IdeaProjects/`, set
`{target_project}` to that path and confirm once with the user before writing.

If no hint is found, target = current project (no ask). If multiple hints
conflict, ask via AskUserQuestion with the candidate list + "current project".

## Step 4 — Classify topic: devops-plugin or project-specific?

The learning is **devops-plugin related** if it is about:

- A plugin skill (`/devops-*` command behavior, skill flow, skill output)
- A plugin hook (session-start, pre/post-tool-use, stop, user-prompt-submit)
- A plugin agent (core, frontend, ai, qa, redteam, etc.)
- The MCP server or scripts under `plugins/devops/`
- Plugin conventions (commit format, ship pipeline, etc.)
- Cross-cutting deep-knowledge topics already covered in `plugins/devops/deep-knowledge/`

Otherwise the learning is **project-specific** (build commands, architecture
rules, business logic conventions, file layout for that project, etc.).

Store as `{topic}` ∈ {`plugin`, `project`}.

## Step 5 — Route by target × topic

Use this decision table. **In every branch: prefer deep-knowledge over skill
over CLAUDE.md** — see the Conventions section below for soft caps and the
self-reference rule. CLAUDE.md target is ~20 lines (soft); skill files ~200
lines (soft); deep-knowledge unbounded.

| `{target_project}`     | `{topic}`  | Action                                           |
|------------------------|------------|--------------------------------------------------|
| current = plugin repo  | plugin     | **5a.** Edit plugin files directly               |
| current (consumer)     | plugin     | **5b.** Skill-extension if it fits; else 5c      |
| current (consumer)     | project    | **5c.** Project-specific skill or deep-knowledge |
| other project (any)    | any        | **5d.** Cross-project — issue or prompt          |
| global / ambiguous     | any        | **5e.** ASK FIRST — do not auto-write            |

### 5a — Plugin repo, plugin topic

The user is editing the plugin source. Choose target file:

1. **Behavioral rule for an existing skill** → edit `plugins/devops/skills/<skill>/SKILL.md`
   directly (append a numbered rule or extend a step). Keep skill steps tight.
2. **Reference content / mental model / convention** → write to
   `plugins/devops/deep-knowledge/<topic>.md`. Either append to an existing file
   (use Grep on `deep-knowledge/INDEX.md` for matching topics) or create new.
   After creating new: run `node plugins/devops/scripts/gen-dk-index.js
   plugins/devops/deep-knowledge` to regenerate the index.
3. **Agent behavior** → edit `plugins/devops/agents/<name>.md`.
4. **Hook behavior** → edit `plugins/devops/hooks/<phase>/<hook>.js`.

Only touch `plugins/devops/CLAUDE.md` or root `CLAUDE.md` if neither skill nor
deep-knowledge fits and the rule is a one-liner. Re-run the lint mental check:
~20 lines after the edit (soft cap — see Conventions).

### 5b — Consumer project, plugin topic, fits a skill

Determine which plugin skill the learning belongs to (use the topic keywords
to match against the skill list — `ship`, `commit`, `flow`, `concept`, etc.).

If a clear skill match exists:

1. Check `{project}/.claude/skills/<skill>/SKILL.md` — create directory if missing
2. If `SKILL.md` doesn't exist, scaffold via the same template as
   `devops-extend-skill` Step 4.2
3. Append the rule under a `## Project rules` section. Each rule = 1–3 lines.
4. If the rule needs more than 3 lines of context, instead put the bulk into
   `{project}/.claude/skills/<skill>/reference.md` and leave a one-line pointer
   in SKILL.md

### 5c — Consumer project, project-specific OR plugin topic without skill fit

Decide between project-skill and project-deep-knowledge:

- **Reference / explanation / mental model** → `{project}/.claude/deep-knowledge/`
  (mirrors the plugin's `plugins/devops/deep-knowledge/` layout — under
  `.claude/` so all project-level Claude config sits in one place per
  `deep-knowledge/claude-directory-structure.md`)
  - Create `{project}/.claude/deep-knowledge/` if missing
  - Pick or create `<topic>.md` (e.g. `architecture.md`, `data-flow.md`)
  - Append the learning with a short heading
- **Behavioral rule (when X, do Y)** → project-specific skill
  - If a matching `{project}/.claude/skills/<skill>/SKILL.md` exists, append
  - Else: ask the user via AskUserQuestion whether to (a) create a new
    project-specific skill `{project}/.claude/skills/<new-skill>/SKILL.md` or
    (b) fall back to deep-knowledge

Only as last resort append a one-line pointer to `{project}/CLAUDE.md` so the
new file gets discovered. CLAUDE.md target ~20 lines (soft cap, see Conventions).

### 5d — Different project (cross-project)

This branch fires when `{target_project}` ≠ current project.

1. Resolve the target's git root and check for a GitHub remote:
   ```bash
   git -C "{target_project}" remote get-url origin
   ```
2. **If GitHub remote**: delegate to the `/devops-new-issue` skill via the
   **Skill** tool — never call `gh issue create` directly from here. That skill
   enforces title format, labels, milestone, and project-board rules (including
   any project extension in `{target_project}/.claude/skills/new-issue/`).

   Hand off with a self-contained prompt containing:
   - `title`: `[CHORE] Capture learning: <short>`
   - `body`: full learning text + "Captured from session in {current-project}."
   - target repo (so the issue lands in `{target_project}`, not the current repo)
   - `type:chore` as the issue type

   General rule for ALL devops skills: whenever an issue needs to be created,
   invoke `/devops-new-issue` rather than calling `gh issue create` directly.
3. **If no GitHub remote**: ASK the user first (per their rule on cross-project
   changes that are not issues). Two options:
   - (a) Generate a copy-pastable prompt block (default)
   - (b) Apply the change directly via Edit/Write to that project

   For (a), output a fenced block the user can paste into the other project's
   Claude session:
   ```
   /devops-learn <learning text including all context>
   ```
   Plus a one-line summary of what the rule should achieve.

### 5e — Global or ambiguous cross-project

If the learning would land in `~/.claude/CLAUDE.md`, `~/.claude/skills/`, or
anywhere outside any single project — **stop and ask first** via AskUserQuestion:

> "Diese Regel betrifft globale Claude-Anweisungen (nicht projektspezifisch).
> Soll ich sie wirklich global persistieren oder lieber projektspezifisch?"
>
> Options:
> 1. Global in `~/.claude/...` (proceed)
> 2. Stattdessen im aktuellen Projekt persistieren (re-route to 5b/5c)
> 3. Abbrechen

Never write to `~/.claude/CLAUDE.md` without explicit confirmation.

## Step 6 — Confirm and report

After persisting, show the user:

- Which file(s) changed (path + line count delta)
- The verbatim rule that was added
- Any pointer line added to CLAUDE.md (with reminder of current line count)

For 5d issue creation: show the issue URL.
For 5d prompt: show the copy-pastable block.

## Step 7 — Completion Card

Call `mcp__plugin_devops_dotclaude-completion__render_completion_card`:

| Situation                                | Variant     |
|------------------------------------------|-------------|
| Files written in current/plugin repo     | `ready`     |
| GitHub issue created in other repo       | `fallback`  |
| Copy-pastable prompt generated only      | `fallback`  |
| User aborted at 5e                       | `analysis`  |

Pass: `variant`, `summary` (e.g. "Learning persisted to deep-knowledge/foo.md"),
`lang`, `session_id`, `changes` (file/issue → short delta). Output the markdown
VERBATIM as the LAST thing in the response.

## Conventions

Before persisting, apply `deep-knowledge/content-conventions.md` —
specifically its "Size budgets", "Re-route triggers", "Self- and plugin-
references over command redundancy", and "Tone" sections. They govern every
write this skill performs.

## Rules

- **Never** write to user feedback memory from this skill — that is a separate
  channel handled by auto-memory.
- **Always** prefer deep-knowledge > skill/extension > CLAUDE.md.
- **Respect the soft caps** above; re-route to the next-larger container
  before busting CLAUDE.md or SKILL.md targets.
- **Always reference, never duplicate** existing skill/agent/hook/deep-knowledge
  logic — see Conventions above.
- **Always** ask before any global change or any cross-project file edit that
  is not a GitHub issue.
- **Never** silently overwrite an existing rule that says the opposite — show
  the conflict and ask which wins.
