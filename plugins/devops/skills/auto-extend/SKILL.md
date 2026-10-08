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

Glob each path before reading; skip missing files silently.

1. Global: `~/.claude/skills/auto-extend/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/auto-extend/SKILL.md` + `reference.md`
   Fallback (pre-PR-2 name): where `auto-extend/` does not exist, read `~/.claude/skills/claude-extend-skill/` / `{project}/.claude/skills/claude-extend-skill/` instead — an extension written before the rename keeps working.
3. Merge: project > global > plugin defaults

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

Look for `SKILL.md` and `reference.md` in `{project}/.claude/skills/{skill-name}/`
and in the skill's pre-PR-2 dir(s) (`ship/` for `do-ship`, the folded skill
names for `do-run` / `do-ship` modes). An extension found only under the old
name is reported as existing ("still loaded as fallback"); before editing it,
offer to `git mv` it to the new name.

- **Exists** → show which files exist and their content, then ask whether to
  edit one, add the missing one, or abort; apply the requested edits.
- **Missing** (or a single missing file) → Step 3 for what is missing.

## Step 3 — Scaffold extension files

Create `{project}/.claude/skills/{skill-name}/` — always the NEW name, never a
pre-PR-2 one. Read the plugin's `skills/{skill-name}/SKILL.md` first so the
guiding comment fits the skill.

`SKILL.md` — minimal: frontmatter plus a guiding comment, no pre-filled steps
unless the user described what they want:

```markdown
---
name: {skill-name}
description: Project-specific {skill-name} extensions for {project-name}
---

# {Skill-Name} Extensions

<!-- Add project-specific overrides or additional steps here.
     These rules merge with the plugin defaults — your rules win on conflict.
     See deep-knowledge/skill-extension-guide.md for the full extension model. -->
```

`reference.md`:

```markdown
# {Skill-Name} Reference — {project-name}

<!-- Add project-specific context that this skill should read before executing.
     Examples: build commands, deploy targets, log paths, version files, conventions.
     The plugin loads this file automatically in Step 0 of every execution. -->
```

`.claude/skills/` must not be gitignored — if it is, warn; do not edit
`.gitignore` yourself.

## Step 4 — Confirm

Name the created/updated path, what each file is for (`SKILL.md` overrides or
adds steps, `reference.md` adds context such as build commands, deploy
targets, paths), and that the plugin reads both before every run of the skill.
