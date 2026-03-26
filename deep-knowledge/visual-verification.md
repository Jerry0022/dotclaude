# Visual Verification Methods

How to verify changes visually. Referenced by the completion flow hook.

## Method selection

| Change type | Verification method |
|---|---|
| **UI component / web page** | Preview screenshot or browser screenshot |
| **CLI / terminal output** (completion card, log format) | Simulated example in markdown code block |
| **Formatted text** (markdown, tables) | Render directly in chat |
| **Config / data structure** | Show resulting JSON/YAML inline |
| **Diagram** | Render via diagram pipeline + screenshot |

## Screenshot previews

1. Preview server running → `preview_screenshot`
2. Browser tab open → `computer` screenshot
3. Neither available but startable → start server first, then screenshot
4. Not visually testable → skip, explain what was verified instead

## Simulated output

For Claude Code chat output (completion cards, status messages):

1. Use the actual format rules from the relevant template
2. Fill with realistic placeholder data (real-looking names, hashes, versions)
3. Wrap in ` ```text ` code block
4. Label: "Simulierte Ausgabe:" so it's clear this is a preview

## When to verify

Verify after ANY change affecting visible output:
- UI component templates or styling
- Output format templates (completion card, etc.)
- CLI tool output, log messages
- Config rendering, table layouts

## When NOT to verify

- Pure refactoring (no visible change)
- Internal logic / data model only
- Test file changes
- .gitignore, internal config
