---
name: devops-learn
version: 0.1.0
description: >-
  Capture a long-term learning/correction and route it to the correct project-
  specific instructions (skill, skill-extension, deep-knowledge, or as a last
  resort CLAUDE.md) — NOT to personal feedback memory. After persisting, prunes
  any now-duplicate `feedback_*.md` auto-memory entries with confirmation.
  Handles four targets:
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
over CLAUDE.md** — see the Conventions section below for soft caps, re-route
triggers, and the self-reference rule. Single source:
`deep-knowledge/content-conventions.md` (CLAUDE.md target ~20 lines, re-route
above ~25).

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
deep-knowledge fits and the rule is a one-liner. Bias: keep CLAUDE.md at
~20 lines (target). After any CLAUDE.md edit, invoke `/devops-claude-md-lint`
via the **Skill** tool to verify size and structure — do not eyeball line counts.

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
new file gets discovered. Bias: keep CLAUDE.md at ~20 lines (target). After
any CLAUDE.md edit, invoke `/devops-claude-md-lint` via the **Skill** tool —
single source of truth for size/structure checks.

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

## Step 6 — Clean up duplicate feedback memory

The canonical rule now lives in its proper file. Any pre-existing entry in
**auto-memory feedback** that covers the same ground is now a stale duplicate
— auto-memory is for personal style/tone preferences, not project rules, so
the duplicate should be removed once the sorted Claude instructions own it.

Skip this step entirely for 5d (cross-project): the feedback memory belongs
to *this* session, not the target project — leave it alone.

1. **Resolve the project memory dir.** The path is
   `~/.claude/projects/<encoded-cwd>/memory/` where `<encoded-cwd>` replaces
   each `:`, `\`, and `/` in the path with `-`. If the current repo is a
   worktree, use the **main** project path, not the worktree path (per the
   existing `feedback_memory_in_main_project` convention) — derive it from
   `git rev-parse --git-common-dir` (strip the trailing `/.git*` segments).
   Use Glob to confirm the dir exists; skip silently if not.

2. **List candidates.** Glob `feedback_*.md` in that dir AND read `MEMORY.md`
   (which is the index). Skip silently if no `feedback_*` files.

3. **Match semantically against the just-persisted learning.** For each
   feedback file, read its frontmatter `description` and the first ~10 body
   lines. Same rule = same intent + same trigger condition + non-trivial
   overlap with the rule we just wrote (not merely "same broad topic").
   Be conservative — if in doubt, treat as non-match and skip.

4. If 0 matches: produce no output, continue to Step 7.

5. If 1+ matches: list them via AskUserQuestion (one question per match if
   multiple, or `multiSelect` if the user wants to handle them in bulk). For
   each, show the file name + description + which new file now owns the rule.
   Options per match:
   - **Löschen** (Recommended) — Regel lebt jetzt in `<new file>`
   - **Behalten** — bleibt als persönliche Präferenz relevant
   - **Erst vollständig anzeigen**

6. For each chosen deletion:
   - Delete the `feedback_*.md` file
   - Remove its bullet line from `MEMORY.md` (Edit, not Write)
   - Add the path to the Step 7 report

Only target `feedback_*.md` files. **Never** touch `user_*`, `project_*`, or
`reference_*` memories — those have different lifecycles and are not what
the learn skill replaces.

## Step 7 — Confirm and report

After persisting, show the user:

- Which file(s) changed (path + line count delta)
- The verbatim rule that was added
- If a CLAUDE.md was touched: the `/devops-claude-md-lint` result for that file
  (don't re-count lines manually — relay the lint output)
- If Step 6 deleted any feedback memories: list the removed file names

For 5d issue creation: show the issue URL.
For 5d prompt: show the copy-pastable block.

## Step 8 — Completion Card

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

- **Never write** to user feedback memory from this skill — auto-memory owns
  that channel. The skill **may delete** duplicate `feedback_*.md` entries
  (Step 6) once the canonical rule is in place, with user confirmation.
- **Always** prefer deep-knowledge > skill/extension > CLAUDE.md.
- **Respect the soft caps** above; re-route to the next-larger container
  before busting CLAUDE.md or SKILL.md targets.
- **Always reference, never duplicate** existing skill/agent/hook/deep-knowledge
  logic — see Conventions above.
- **Always** ask before any global change or any cross-project file edit that
  is not a GitHub issue.
- **Never** silently overwrite an existing rule that says the opposite — show
  the conflict and ask which wins.
