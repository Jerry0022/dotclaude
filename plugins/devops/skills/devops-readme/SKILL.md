---
name: devops-readme
version: 0.1.0
description: >-
  Generate a polished, modern README.md for any project. Use when the user
  explicitly calls /devops-readme, AND when Claude is about to create, rewrite, or
  substantially update a README.md. Triggers on: "create a readme", "update the
  readme", "improve the readme", "README erstellen", "README aktualisieren".
  Do NOT trigger for minor one-line edits like bumping a version number.
argument-hint: "[--preview] [--update]"
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, Write, Edit, mcp__plugin_devops_dotclaude-completion__render_completion_card
---

# README Generator

Generate a modern, informative README.md for the current project.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/readme/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/readme/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Arguments

- `--preview`: Show planned structure before generating. Auto-enabled for large projects (>20 source files).
- `--update`: Incremental update — preserve user-written sections, update version/features/structure.

No flag + no README → full generation.
No flag + README exists + small project → full generation.

## Step 1 — Analyze the project

Read and analyze:
1. Manifest file (`package.json`, `Cargo.toml`, etc.) → name, version, license, deps
2. Existing `README.md` → extract useful content
3. Source structure via `Glob` → tech stack, entry points, folder layout
4. `CHANGELOG.md` → link to it (do not copy content)
5. `.github/workflows/` → CI presence
6. `docs/`, `assets/`, `screenshots/` → available media

Determine:
- **Project name** and version
- **One-line description** (compelling, specific)
- **Category**: `developer-facing` (library, SDK, CLI) or `user-facing` (app, tool)
- **Tech stack** and key dependencies

## Step 2 — Select sections

Based on project category, include relevant sections from this list:

| Section | Dev-facing | User-facing | Notes |
|---------|:---:|:---:|---|
| **Hero block** (name, tagline, badges) | Always | Always | |
| **Table of Contents** | If 5+ sections | If 5+ sections | |
| **Overview / What is this?** | Why it exists | Elevator pitch, no jargon | |
| **Screenshots / Demo** | Optional | Preferred | |
| **Features** | Bullet list, emoji prefix | User-oriented, emoji prefix | |
| **Installation / Getting Started** | Package manager commands | Download/install per platform | |
| **Quick Start / Tutorial** | Minimal code example | Step-by-step guide | |
| **Usage / API** | Key API surface | How to Use | Dev only |
| **Architecture** | If 3+ modules | If multi-process | Diagram |
| **Contributing** | Always | Always | |
| **License** | Always | Always | |

Omit sections with no meaningful content. No filler.

## Step 3 — Badges

Generate contextually relevant badges using `shields.io` (style: `flat-square`):

**Always** (if data available): Version, License.
**If applicable**: npm/PyPI downloads, CI status, platform, language version.

Claude determines which badges fit the project — no hardcoded list.

## Step 4 — Media

Search for existing screenshots/images in the repo. If found:
- Ask user once: "X Screenshots gefunden. Einbauen?" (not per image)
- If no media exists but would help → add TODO comment: `<!-- TODO: Add screenshot -->`

## Step 5 — Diagrams

- **Default**: HTML rendering in project design language for visual explanations
- **Exception**: Mermaid for complex multi-module architecture, dependency flows

## Step 6 — Preview mode

If `--preview` or auto-detected: show section outline + planned badges + found media.
Ask for confirmation before generating.

## Step 7 — Update mode

1. Read existing README carefully
2. Identify outdated sections (version, features, badges)
3. Identify user-written sections → preserve
4. Show diff preview, ask confirmation
5. Apply targeted edits (not full rewrite)

## Step 8 — Generate

Write with `Write` (new) or `Edit` (update).

## Step 9 — Completion Card

After writing the README, call
`mcp__plugin_devops_dotclaude-completion__render_completion_card`:

| Situation | Variant |
|-----------|---------|
| New README or substantial update (file written) | `ready` |
| Preview mode only (no file written) | `analysis` |

Pass: `variant`, `summary`, `lang`, `session_id`, `changes` (sections added/updated),
and `state` when a file was written. Output the markdown VERBATIM as the LAST thing
in the response — nothing after the closing `---`.

## Style rules

- **Language**: English (all README content)
- **Tone**: Modern, confident, welcoming
- **Emoji**: One per section header (`## 🚀 Getting Started`). None in body text.
- **Code blocks**: Always specify language
- **Version**: Display `**Version: x.y.z**` near the top
- **No filler**: Every sentence must add information
- **Feature descriptions**: Start with a verb or the benefit
