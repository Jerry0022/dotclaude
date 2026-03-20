---
name: readme
description: >-
  Generate a polished, modern README.md for any project. Use this skill whenever
  the user explicitly calls /readme, AND also whenever Claude is about to create,
  rewrite, or substantially update a README.md file as part of any other task.
  Triggers include: "create a readme", "update the readme", "improve the readme",
  "write documentation", or any workflow that produces a new or rewritten README.md.
  Do NOT trigger for minor one-line edits like bumping a version number.
argument-hint: [--preview]
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, Write, Edit, mcp__972a13cb-e2c8-4660-871b-0630efb3cad3__validate_and_render_mermaid_diagram
---

# README Generator

Generate a visually appealing, modern, and informative README.md for the current project.

## Arguments

- `--preview`: Show planned structure (sections, badges, media) and ask for confirmation before generating. Without this flag, generate directly.

## Step 1 — Analyze the project

Read and analyze these sources to understand the project:

1. `package.json` (or equivalent manifest: `Cargo.toml`, `pyproject.toml`, `go.mod`, etc.)
2. Existing `README.md` (extract any useful content, but the output will be a full rewrite)
3. Source file structure via `Glob` (identify main tech stack, entry points, folder layout)
4. `LICENSE` or license field in manifest
5. `.github/workflows/` for CI/CD presence
6. `/docs`, `/assets`, `/screenshots`, `/images` for existing media files
7. `CHANGELOG.md` if present
8. `CLAUDE.md` for project-specific context and conventions

From this analysis, determine:

- **Project name** and current version
- **One-line description** (compelling, not generic)
- **Project category**: `developer-facing` (library, SDK, API, CLI tool used by devs) or `user-facing` (desktop app, web app, mobile app, end-user tool)
- **Tech stack** (languages, frameworks, key dependencies)
- **Available media** (screenshots, GIFs, diagrams in the repo)
- **Package registry** (npm, PyPI, crates.io, etc. — if published)
- **CI status** (GitHub Actions, etc.)

## Step 2 — Select template

Based on the project category, use the matching section template:

### Developer-facing template

Sections in order:

1. **Hero block** — Project name (as `<h1>` or logo), one-line description, badge row
2. **Table of Contents** (only if 5+ sections)
3. **Overview / Motivation** — Why does this exist? What problem does it solve? (2-4 sentences)
4. **Features** — Bullet list with emoji prefixes, highlight what makes it stand out
5. **Installation** — Package manager commands, prerequisites
6. **Quick Start** — Minimal working example (code block)
7. **Usage / API** — Key API surface, configuration options, common patterns
8. **Architecture** — Mermaid diagram if the project has 3+ modules/services (optional)
9. **Contributing** — How to contribute, link to CONTRIBUTING.md if it exists
10. **License** — Type + link

### User-facing template

Sections in order:

1. **Hero block** — App name/logo, tagline, badge row
2. **Table of Contents** (only if 5+ sections)
3. **What is this?** — Elevator pitch for end users (2-3 sentences, no jargon)
4. **Screenshots / Demo** — Key screenshots or GIF showing the app in action
5. **Features** — User-oriented feature list with emoji prefixes
6. **Getting Started** — Download/install instructions per platform
7. **Tutorial / How to Use** — Step-by-step guide with screenshots where helpful
8. **FAQ** — Common questions (only if there's enough content)
9. **Architecture** — Mermaid diagram for complex multi-process apps (optional)
10. **Contributing** — How to contribute
11. **License** — Type + link

Omit any section that has no meaningful content for the specific project. Do not generate filler.

## Step 3 — Badges

Generate a badge row using `shields.io` format. Include contextually relevant badges:

**Always include (if data available):**
- Version badge (from package.json or latest git tag)
- License badge

**Include if applicable:**
- npm/PyPI/crates.io download badge (if published to a registry)
- Build/CI status badge (if GitHub Actions or similar exists)
- Beta/Alpha tag (if version is `0.x` or has pre-release suffix)
- Node/Python/Rust version requirement (if specified)
- Platform badge (Windows/macOS/Linux if relevant)

Badge style: `flat-square` for consistency. Use branded colors where possible (e.g., npm red, TypeScript blue).

Example badge row:
```markdown
![Version](https://img.shields.io/badge/version-1.2.3-blue?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Build](https://img.shields.io/github/actions/workflow/status/owner/repo/ci.yml?style=flat-square)
![npm](https://img.shields.io/npm/dm/package-name?style=flat-square)
```

## Step 4 — Media handling

Search for existing media files in the repository:
- `Glob` for `**/*.{png,jpg,jpeg,gif,svg,webp}` in common directories
- Filter to files that look like screenshots, demos, or logos (by path/name)

For each media candidate found:
- Use `AskUserQuestion` to ask the user which images to include and where
- Only include media the user explicitly approves
- Place screenshots/GIFs in the most relevant section (hero, features, tutorial)

If no media exists but would significantly improve the README (e.g., a desktop app with no screenshots), add a TODO comment:
```markdown
<!-- TODO: Add screenshot of main interface -->
```

## Step 5 — Mermaid diagrams

If the project is complex enough (3+ modules, multi-service architecture, or complex data flow):
- Generate a Mermaid architecture/flow diagram
- Keep it focused — one diagram, one concept
- Use `LR` direction for flowcharts
- Include it in the Architecture section

## Step 6 — Preview mode (if `--preview` flag)

If `--preview` is passed, do NOT generate the README yet. Instead:

1. Present the analysis results (category, stack, version, badges planned)
2. Show the section outline with brief descriptions of planned content
3. List found media files and proposed placement
4. Ask for confirmation or adjustments via `AskUserQuestion`
5. Only proceed to generation after user confirms

## Step 7 — Generate

Write the final `README.md` using the `Write` tool.

## Style rules

- **Language**: English (all README content must be in English per global conventions)
- **Tone**: Modern, welcoming, confident — like a well-maintained popular open-source project
- **Emoji usage**: One emoji per section header (e.g., `## 🚀 Getting Started`). No emojis in body text.
- **Code blocks**: Always specify the language for syntax highlighting
- **Links**: Use reference-style links at the bottom for cleanliness when there are 5+ links
- **Line length**: No hard wrapping — let the renderer handle it
- **Version**: Must display `**Version: x.y.z**` near the top (per global versioning convention)
- **Whitespace**: One blank line between sections, no trailing whitespace
- **No filler**: Every sentence must add information. No "Welcome to ProjectName!" or "This project is a project that..."
- **Feature descriptions**: Start with a verb or the benefit, not "It supports..." or "There is..."
