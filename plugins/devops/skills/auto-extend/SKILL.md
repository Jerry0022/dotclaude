---
name: auto-extend
version: 0.2.0
description: >-
  Interactively scaffold or adapt a project-level extension for any plugin skill.
  Lists available skills, checks for existing extensions, and creates or opens
  the correct files. Triggers on: "extend skill", "customize skill", "skill extension".
layer: 2
invokes: []
user-invocable: false
triggers:
  en: ["extend skill", "customize skill", "skill extension"]
argument-hint: "[skill-name]"
allowed-tools: Read, Glob, Grep, Bash, AskUserQuestion, Write, Edit
---

# Claude Extend Skill — Interactive Extension Scaffolding

Scaffold or adapt a project-level extension for any devops skill.

## Step 0 — Load Extensions

Injected by the override loader (`[skill-overrides]` block); none shown → none exist.

`{project}` = the nearest parent with `.git/` or `.claude/`; all extension
paths below are relative to it.

## Step 1 — Determine target skill

Use the skill name from the argument; otherwise list the plugin's `skills/`
(and `agents/` extensions) and ask via AskUserQuestion which one to extend.

A pre-PR-2 name (`ship`, `fix`, `run-backlog`, `promote`, … — table in
`{PLUGIN_ROOT}/hooks/lib/skill-names.js`) is translated to the skill that owns
it now (`do-ship`, `auto-fix`, `do-run`, `do-ship`, …). A PR-3 retired name
(`RETIRED` in the same table: setup-readme, auto-graph, auto-usage,
claude-strict) is no skill: say so and name its deep-knowledge doc
(`RETIRED[name].doc`). An extension under that old name keeps applying only
where the doc says so (readme-standards, usage and strict name
`.claude/skills/<old>/reference.md` as an override; graphify never had one).
A name that matches nothing → say so and ask again.

## Step 2 — Check for an existing extension

Look for `reference.md` (and a legacy `SKILL.md`) in `{project}/.claude/skills/{skill-name}/`
and in the skill's pre-PR-2 dir(s) (`ship/` for `do-ship`, the folded skill
names for `do-run` / `do-ship` modes). An extension found only under the old
name is reported as existing ("still loaded as fallback"); before editing it,
offer to `git mv` it to the new name.
A legacy `SKILL.md` override is reported as deprecated: it is still read as
a fallback, but Claude Code loads a `SKILL.md` there as a user skill of its
own (a bare `/{skill-name}` beside the plugin's). Offer to move its content
into `reference.md` (`git mv` when no `reference.md` exists yet, else merge
the text into it and delete the old file).

- **Exists** → show which files exist and their content, then ask whether to
  edit one, add the missing one, or abort; apply the requested edits.
- **Missing** (or a single missing file) → Step 3 for what is missing.

## Step 3 — Scaffold extension files

Create `{project}/.claude/skills/{skill-name}/` — always the NEW name, never a
pre-PR-2 one. Read the plugin's `skills/{skill-name}/SKILL.md` first so the
guiding comment fits the skill.

Scaffold **`reference.md` only** — never a `SKILL.md`: Claude Code loads
any `SKILL.md` under `.claude/skills/` as a skill of its own. Step overrides
and added steps go into `reference.md` too, under the directive headings the
override loader parses (`hooks/lib/skill-overrides.js`): `## Add after Step N`
/ `## Add before Step N`, `## Skip Step N`, `## Replace Step N`, `## Step N — …`
(extends that step). Use the step numbers of the plugin's SKILL.md; drop the
headings the user does not need. Everything else is free-text rules.

`reference.md`:

```markdown
# {Skill-Name} Reference — {project-name}

<!-- Project-specific context and rules for this skill. The override loader
     injects this file every time the skill starts; your rules win over the
     plugin defaults on conflict. Directive headings become explicit orders —
     keep only the ones you need, with the step numbers of the plugin skill.
     See deep-knowledge/skill-extension-guide.md for the full extension model. -->

## Add after Step {N}
<!-- An extra step, run right after Step {N}. "Add before Step {N}" also works. -->

## Skip Step {N}
<!-- The plugin skips Step {N} entirely. -->

## Replace Step {N}
<!-- Runs instead of the plugin's Step {N}. -->

## Rules
<!-- Free text: build commands, deploy targets, log paths, version files, conventions. -->
```

`.claude/skills/` must not be gitignored — if it is, warn; do not edit
`.gitignore` yourself.

## Step 4 — Confirm

Name the created/updated path, that `reference.md` holds both added context
(build commands, deploy targets, paths) and step directives, that the
override loader injects it at every start of the skill, and that the
completion card shows "🧩 Override aktiv" whenever it applied.
