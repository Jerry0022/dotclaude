---
name: claude-learn
version: 0.1.0
description: >-
  Capture a long-term learning/correction and route it to the correct project-
  specific instructions (skill, skill-extension, deep-knowledge, or as a last
  resort CLAUDE.md) — NOT to personal feedback memory. Also prunes now-duplicate
  `feedback_*.md` entries with confirmation. Routing details live in the skill
  body (Step 5 table). Triggers ONLY on explicit invocation: "/claude-learn",
  "lerne das", "merk dir das fürs Projekt", "remember this for the project",
  "capture learning". Do NOT trigger for one-off conversational corrections or
  for personal feedback memory.
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

If the user passed text after `/claude-learn`, that is the learning. Otherwise
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

## Step 4b — Plugin topic in a consumer project: upstream fix or local override?

When `{topic} == plugin` AND the current project is a **consumer** (not the
plugin source repo), the root cause of the learning lives in the plugin source,
not here. Decide `{plugin_disposition}`:

- `upstream` (**DEFAULT**) — the learning is a plugin defect, gap, or
  improvement that would benefit any consumer of devops dotclaude. The fix
  belongs in the plugin source repo. A local extension here would only paper
  over the real cause and drift from upstream.
- `local-override` — the learning is a deliberate, project-specific deviation
  from the plugin default that would be wrong or meaningless to push upstream
  (e.g. *this* project's ship pipeline must skip a step every other project
  needs). Only this disposition justifies a local skill-extension.

Bias hard toward `upstream`. Choose `local-override` ONLY when you can name why
the rule must NOT become the plugin's default behavior. If unsure, treat it as
`upstream` and create the issue. This is not set for plugin-repo or
project-topic learnings.

**Hard boundary in a consumer project:** this skill must NOT apply a plugin fix
directly — not into the consumer's own tree, and **never** into the installed
plugin copy under `~/.claude/plugins/cache/**` or
`~/.claude/plugins/marketplaces/**`. Those are managed install artifacts; a
hand-edit masks the real defect and is overwritten on the next sync. A plugin
defect always leaves this skill as an **upstream issue** (5b). The only writes
allowed here are a deliberate `local-override` extension (5b′). **Exception —
plugin source repo:** when the current project IS the plugin's own repo, direct
fixes are expected (5a) and touching the local cache is *optional* (e.g.
repairing or testing the installed copy).

## Step 5 — Route by target × topic

Use this decision table. **Root cause first: fix the learning where it lives.**
A plugin defect/gap found in a consumer project belongs upstream (an issue in
the plugin source repo), NOT in a local extension — localize only for a
deliberate project-specific override (see Step 4b). Within whatever container
you land in: **prefer deep-knowledge over skill over CLAUDE.md** — see the
Conventions section below for soft caps, re-route triggers, and the
self-reference rule. Single source: `deep-knowledge/content-conventions.md`
(CLAUDE.md target ~20 lines, re-route above ~25).

| `{target_project}`     | `{topic}`                | Action                                           |
|------------------------|--------------------------|--------------------------------------------------|
| current = plugin repo  | plugin                   | **5a.** Edit plugin files directly               |
| current (consumer)     | plugin → upstream        | **5b.** Issue in plugin source repo (root-cause) |
| current (consumer)     | plugin → local-override  | **5b′.** Skill-extension if it fits; else 5c     |
| current (consumer)     | project                  | **5c.** Project-specific skill or deep-knowledge |
| other project (any)    | any                      | **5d.** Cross-project — issue or prompt          |
| global / ambiguous     | any                      | **5e.** ASK FIRST — do not auto-write            |

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
~20 lines (target). After any CLAUDE.md edit, invoke `/claude-lint`
via the **Skill** tool to verify size and structure — do not eyeball line counts.

### 5b — Consumer project, plugin topic, upstream fix (DEFAULT)

Fires when Step 4b resolved `{plugin_disposition} == upstream`. The root cause
lives in the plugin source repo, not in this project — create an issue there
instead of localizing a workaround.

1. Resolve the plugin source repo. Its canonical GitHub slug is
   `Jerry0022/dotclaude` (derivable from the installed plugin's
   `marketplace.json`: `{owner.name}/{name}`). Do NOT assume a local checkout
   of it exists — pass the slug straight to the issue skill.
2. Delegate to `/setup-issue` via the **Skill** tool — never call
   `gh issue create` directly. Hand off a self-contained prompt containing:
   - `title`: `[BUG] <short>` for a defect, `[FEAT] <short>` for a gap or
     improvement (imperative, sentence case, no trailing period)
   - `body`: full learning text + "Captured from a session in
     {current-project}." + which plugin part it concerns (skill / hook / agent
     / MCP / convention)
   - target repo: `Jerry0022/dotclaude` (so the issue lands upstream, not in
     the consumer repo)
   - issue type: `bug` or `feature` accordingly
3. This branch persists NOTHING locally — skip Step 6, go to Step 7.

### 5b′ — Consumer project, plugin topic, local override

Fires only when Step 4b resolved `{plugin_disposition} == local-override`: the
project deliberately customizes plugin behavior and the rule must NOT become
the plugin default.

Determine which plugin skill the learning belongs to (use the topic keywords
to match against the skill list — `ship`, `commit`, `flow`, `concept`, etc.).

If a clear skill match exists:

1. Check `{project}/.claude/skills/<skill>/SKILL.md` — create directory if missing
2. If `SKILL.md` doesn't exist, scaffold via the same template as
   `claude-extend-skill` Step 4.2
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
any CLAUDE.md edit, invoke `/claude-lint` via the **Skill** tool —
single source of truth for size/structure checks.

### 5d — Different project (cross-project)

This branch fires when `{target_project}` ≠ current project.

1. Resolve the target's git root and check for a GitHub remote:
   ```bash
   git -C "{target_project}" remote get-url origin
   ```
2. **If GitHub remote**: delegate to the `/setup-issue` skill via the
   **Skill** tool — never call `gh issue create` directly from here. That skill
   enforces title format, labels, milestone, and project-board rules (including
   any project extension in `{target_project}/.claude/skills/new-issue/`).

   Hand off with a self-contained prompt containing:
   - `title`: `[CHORE] Capture learning: <short>`
   - `body`: full learning text + "Captured from session in {current-project}."
   - target repo (so the issue lands in `{target_project}`, not the current repo)
   - `type:chore` as the issue type

   General rule for ALL devops skills: whenever an issue needs to be created,
   invoke `/setup-issue` rather than calling `gh issue create` directly.
3. **If no GitHub remote**: ASK the user first (per their rule on cross-project
   changes that are not issues). Two options:
   - (a) Generate a copy-pastable prompt block (default)
   - (b) Apply the change directly via Edit/Write to that project

   For (a), output a fenced block the user can paste into the other project's
   Claude session:
   ```
   /claude-learn <learning text including all context>
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

Skip this step entirely for 5b and 5d (issue created upstream / cross-project):
nothing was persisted locally, so there is no canonical file to supersede a
feedback entry — leave auto-memory alone.

1. **Resolve the project memory dir.** The path is
   `~/.claude/projects/<encoded-cwd>/memory/` where `<encoded-cwd>` replaces
   each `:`, `\`, and `/` in the **canonical absolute path** with `-`. Before
   encoding: resolve symlinks (`realpath` semantics) and preserve the OS's
   native drive-letter case (Windows: as reported by `git rev-parse`).
   If the current repo is a worktree, use the **main** project path, not the
   worktree path (per the existing `feedback_memory_in_main_project`
   convention). Derive the main path robustly via
   `git worktree list --porcelain` and take the first `worktree` entry — that
   is always the primary checkout. Do NOT trim `git-common-dir`: it fails for
   `core.worktree`, `core.bare`, separate-git-dir, and submodule layouts.
   Use Glob to confirm the resulting `~/.claude/projects/<encoded>/memory/`
   exists; if not, skip Step 6 silently. For non-standard paths (UNC,
   network shares): if encoding looks ambiguous (e.g. leading `\\server`),
   skip silently rather than guess.

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
- If a CLAUDE.md was touched: the `/claude-lint` result for that file
  (don't re-count lines manually — relay the lint output)
- If Step 6 deleted any feedback memories: list the removed file names

For 5b / 5d issue creation: show the issue URL.
For 5d prompt: show the copy-pastable block.

## Step 8 — Completion Card

Call `mcp__plugin_devops_dotclaude-completion__render_completion_card`:

| Situation                                | Variant     |
|------------------------------------------|-------------|
| Files written in current/plugin repo     | `ready`     |
| GitHub issue created upstream/other repo  | `fallback`  |
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

- **Never create or update content in** user feedback memory from this skill
  — auto-memory owns that channel. The **only** permitted writes are Step 6
  duplicate-cleanup: deleting matched `feedback_*.md` files and removing
  their bullets from `MEMORY.md`, both requiring user confirmation per match.
- **Default to the root cause's home.** A plugin defect/gap found in a consumer
  project becomes an issue in the plugin source repo (5b), NOT a local
  extension. Localize (5b′ / local dotclaude change) only for a deliberate
  project-specific override you can justify keeping off upstream — and only when
  it makes sense to implement in the current project at all.
- **Never hand-edit installed plugin copies.** In a consumer project this skill
  must not fix a plugin defect directly — not in the consumer's tree, and never
  under `~/.claude/plugins/cache/**` or `~/.claude/plugins/marketplaces/**`
  (managed artifacts, overwritten on the next sync). Route it upstream (5b);
  the only local write allowed is a deliberate `local-override` extension (5b′).
  **Exception:** when the current project IS the plugin source repo, direct
  fixes are expected and touching the local cache is optional.
- **Always** prefer deep-knowledge > skill/extension > CLAUDE.md.
- **Respect the soft caps** above; re-route to the next-larger container
  before busting CLAUDE.md or SKILL.md targets.
- **Always reference, never duplicate** existing skill/agent/hook/deep-knowledge
  logic — see Conventions above.
- **Always** ask before any global change or any cross-project file edit that
  is not a GitHub issue.
- **Never** silently overwrite an existing rule that says the opposite — show
  the conflict and ask which wins.
