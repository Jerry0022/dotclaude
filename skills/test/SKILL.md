---
description: "Show a visual preview of changes directly in the chat — screenshots for UI, simulated output for CLI/terminal formatting, rendered examples for markdown or structured text. IMPORTANT: Use this skill proactively after ANY change that affects visible output, even if the user doesn't explicitly ask. This includes: completion card format changes, log output changes, status messages, CLAUDE.md output templates, skill output formatting, Angular component templates, CSS/styling, CLI tool output, config rendering, table layouts, or any code that produces user-facing text. Also triggers on explicit requests: \"test this\", \"show me\", \"zeig mal\", \"preview\", \"wie sieht das aus\", \"check the output\", \"how does it look\", \"was kommt da raus\". If you just changed how something looks or what gets printed — use this skill to show the result."
user_invocable: true
---

# /test — Visual Verification

Verify changes by showing the result **directly in the chat**. The user should never have to leave the session to judge whether a change looks right.

## Core Rule

**After every change that affects visible output, show a preview.** Pick the method that fits the change type:

| Change type | Preview method |
|-------------|---------------|
| **UI component / web page** | Preview screenshot (`preview_screenshot`) or browser screenshot (`computer` → screenshot) |
| **CLI / terminal output** (e.g., completion card, log format, status line) | Simulated example — render a realistic mock using markdown code blocks or plain text in the chat |
| **Formatted text** (markdown, tables, structured output) | Render the formatted text directly in the chat as the user would see it |
| **Config / data structure** | Show the resulting JSON/YAML/object inline |
| **Diagram / visual** | Render via the diagram pipeline and take a preview screenshot |

## Simulated Output Examples

When the change affects **Claude Code chat output** (completion cards, inline role tags, status messages, AskUserQuestion labels, etc.), produce a **realistic mock** that demonstrates the new format with plausible data. This is the most common case — the user modifies how Claude responds, and needs to see what it will look like.

### How to simulate

1. **Use the actual format rules** from CLAUDE.md or the relevant skill — don't invent a format.
2. **Fill with realistic placeholder data** — real-looking branch names, file names, build hashes, version numbers. Not `foo`/`bar`/`example`.
3. **Wrap in a markdown code block** (` ```text `) so whitespace and layout render correctly in the terminal.
4. **Label the block** with a short header like `Simulierte Ausgabe:` or `So sieht das aus:` so it's clear this is a preview, not actual output.

### Example — completion card preview

If the user changes the completion card format, show:

Simulierte Ausgabe:
```text
---

## ✨ k7d2e44 · Filter-UI implementiert

Shipped auf remote `feat/42-video-filters` via Pull-Request-Merge (PR #87)
\
Filter-Modell und Service angelegt
UI-Komponente mit Apply-Button

src/app/filters/filter.service.ts — new service with CRUD operations
src/app/filters/filter-list.component.ts — list view with apply action
src/styles/filters.scss — filter panel styling

📊 5h: 34% (+8%) | Weekly: 22% (+3%) | Sonnet: 15% (+2%)

---
```

## Screenshot Previews

For UI/web changes:

1. **If a preview server is running** (`preview_list` returns a server): take `preview_screenshot` and show it.
2. **If a browser tab is open** with the relevant page: use `computer` → screenshot.
3. **If neither is available but could be started**: start the preview server first, navigate to the relevant page, then screenshot.
4. **If the change is not visually testable** (backend-only, pure logic): skip the screenshot — say so briefly and explain what was verified instead (e.g., "Nur Backend-Logik — kein visueller Output. Tests laufen durch.").

## When to Run Automatically

This skill triggers **proactively** (without the user invoking `/test`) when:

- A change was made to output-formatting code (completion card template, log format, status messages)
- A UI component's template or styling was modified
- A skill or CLAUDE.md section that defines visible output format was edited
- The user says "zeig mal", "how does it look", "wie sieht das aus"

## When NOT to Preview

- Pure refactoring with no visible output change
- Internal logic / data model changes with no UI or CLI impact
- Test file changes (the tests themselves are the verification)
- .gitignore, config files with no rendered output

## Multiple Changes

If a single task changed multiple output-facing things, show **one preview per distinct output type** — not one mega-preview. Example: if both a completion card format and a UI component changed, show a simulated completion card AND a screenshot.

## User Feedback Loop

After showing the preview, **do not ask "Sieht das gut aus?"** unless the change is ambiguous. The preview speaks for itself. If the user wants adjustments, they'll say so. Just show the preview and move on.
