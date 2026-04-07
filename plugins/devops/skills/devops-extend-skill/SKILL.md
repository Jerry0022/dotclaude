---
name: devops-extend-skill
version: 0.1.0
description: >-
  Interactively scaffold or adapt a project-level extension for any plugin skill.
  Lists available skills, checks for existing extensions, and creates or opens
  the correct files. Triggers on: "extend skill", "customize skill", "skill extension",
  "Skill erweitern", "Skill anpassen".
argument-hint: "[skill-name]"
allowed-tools: Read, Glob, Grep, Bash, AskUserQuestion, Write, Edit
---

# Extend Skill — Interactive Extension Scaffolding

Scaffold or adapt a project-level extension for any devops skill.

## Step 0 — Load Extensions

Silently check for optional overrides (do not surface "not found" in output):

1. Global skill extension: `~/.claude/skills/devops-extend-skill/SKILL.md` + `reference.md`
2. Project skill extension: `{project}/.claude/skills/devops-extend-skill/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 1 — Detect project root

Find the project root (nearest `.git/` or `.claude/` parent). All extension
paths are relative to this root. Store as `{project}`.

## Step 2 — Determine target skill

If a skill name was passed as argument, use it. Otherwise:

1. List all available plugin skills by scanning the plugin's `skills/` directory
2. Also check for agent extensions in `agents/`
3. Present the list via AskUserQuestion:
   > "Welchen Plugin-Skill moechtest du fuer dieses Projekt erweitern?"
   >
   > Options: ship, commit, debug, explain, new-issue, project-setup, readme, ...

Validate that the chosen name matches an existing plugin skill. If not, warn
and re-ask.

## Step 3 — Check for existing extension

Scan `{project}/.claude/skills/{skill-name}/` for:
- `SKILL.md`
- `reference.md`

### If extension exists

Report what was found:
> "Extension fuer `/{skill-name}` existiert bereits:"
> - `SKILL.md` — [exists/missing]
> - `reference.md` — [exists/missing]

Read and display the existing files. Ask:
> "Moechtest du die bestehende Extension anpassen oder eine fehlende Datei ergaenzen?"
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

Create `{project}/.claude/skills/{skill-name}/` directory if missing.

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

> "Extension fuer `/{skill-name}` angelegt/aktualisiert unter
> `.claude/skills/{skill-name}/`."
>
> - `SKILL.md` — Schritte ueberschreiben oder ergaenzen
> - `reference.md` — Kontext hinzufuegen (Build-Befehle, Deploy-Ziele, Pfade)
>
> Das Plugin liest diese Dateien automatisch vor jeder Ausfuehrung von `/{skill-name}`.
