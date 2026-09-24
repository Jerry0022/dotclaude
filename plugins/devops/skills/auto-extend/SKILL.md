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

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/auto-extend/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/auto-extend/SKILL.md` + `reference.md`
   Fallback (pre-PR-2 name): where `auto-extend/` does not exist, read `~/.claude/skills/claude-extend-skill/` / `{project}/.claude/skills/claude-extend-skill/` instead — an extension written before the rename keeps working.
3. Merge: project > global > plugin defaults

## Step 1 — Detect project root

Find the project root (nearest `.git/` or `.claude/` parent). All extension
paths are relative to this root. Store as `{project}`.

## Step 2 — Determine target skill

If a skill name was passed as argument, use it. Otherwise:

1. List all available plugin skills by scanning the plugin's `skills/` directory
2. Also check for agent extensions in `agents/`
3. Present the list via AskUserQuestion:
   > "Welchen Plugin-Skill möchtest du für dieses Projekt erweitern?"
   >
   > Options: do-ship, do-run, auto-fix, auto-issue, auto-cleanup, ...

Validate that the chosen name matches an existing plugin skill. A pre-PR-2
name (`ship`, `fix`, `run-backlog`, `promote`, … — table in
`{PLUGIN_ROOT}/hooks/lib/skill-names.js`) is translated to the skill that owns
it now (`do-ship`, `auto-fix`, `do-run`, `do-ship`, …). A PR-3 retired name
(`RETIRED` in the same table: setup-readme, auto-graph, auto-usage,
claude-strict) is no skill: say so and name its deep-knowledge doc
(`RETIRED[name].doc`). An extension under that old name keeps applying only
where the doc says so (readme-standards, usage and strict name
`.claude/skills/<old>/reference.md` as an override; graphify never had one).
If it matches nothing, warn and re-ask.

## Step 3 — Check for existing extension

Scan `{project}/.claude/skills/{skill-name}/` for:
- `SKILL.md`
- `reference.md`

Also scan the pre-PR-2 dir(s) of the skill (`ship/` for `do-ship`, the folded
skill names for `do-run` / `do-ship` modes). An extension found only there is
reported as existing ("under the old name — still loaded as fallback"); when
the user edits it, offer to move it to the new name with `git mv` first.

### If extension exists

Report what was found:
> "Extension für `/{skill-name}` existiert bereits:"
> - `SKILL.md` — [exists/missing]
> - `reference.md` — [exists/missing]

Read and display the existing files. Ask:
> "Möchtest du die bestehende Extension anpassen oder eine fehlende Datei ergänzen?"
>
> Options:
> 1. SKILL.md bearbeiten/erstellen
> 2. reference.md bearbeiten/erstellen
> 3. Beide anzeigen und manuell entscheiden
> 4. Abbrechen

For editing, ask the user what they want to change and apply edits.
For creating a missing file, proceed to Step 4 for that file only.

### If no extension exists

Proceed to Step 4 to scaffold both files.

## Step 4 — Scaffold extension files

Create `{project}/.claude/skills/{skill-name}/` directory if missing — always
the NEW name, never a pre-PR-2 one.

### 4.1 — Read the plugin skill for context

Read the plugin's `skills/{skill-name}/SKILL.md` to understand what steps
exist and what context would be useful. This informs the scaffold content.

### 4.2 — Generate SKILL.md scaffold

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

The scaffold MUST be minimal — only the frontmatter and a guiding comment.
Do NOT pre-fill steps unless the user explicitly described what they want.

### 4.3 — Generate reference.md scaffold

```markdown
# {Skill-Name} Reference — {project-name}

<!-- Add project-specific context that this skill should read before executing.
     Examples: build commands, deploy targets, log paths, version files, conventions.
     The plugin loads this file automatically in Step 0 of every execution. -->
```

### 4.4 — Ensure .claude/skills/ is tracked in git

Check `.gitignore` — `.claude/skills/` must NOT be ignored.
If it is, warn the user (do not auto-fix .gitignore).

## Step 5 — Confirm and explain

After scaffolding or editing, confirm:

> "Extension für `/{skill-name}` angelegt/aktualisiert unter
> `.claude/skills/{skill-name}/`."
>
> - `SKILL.md` — Schritte überschreiben oder ergänzen
> - `reference.md` — Kontext hinzufügen (Build-Befehle, Deploy-Ziele, Pfade)
>
> Das Plugin liest diese Dateien automatisch vor jeder Ausführung von `/{skill-name}`.
