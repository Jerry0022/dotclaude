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

## Accessibility snapshot verification (no screenshot needed)

When screenshots are unavailable or unnecessary, use **accessibility snapshots**
to verify DOM structure, text content, element roles, and interactive state:

| Tool | Snapshot call |
|------|-------------|
| Chrome MCP | `read_page` |
| Playwright | `browser_snapshot` |
| Preview | `preview_snapshot` |

Snapshots are **preferred over screenshots** for verifying:
- Element presence/absence (button rendered, modal visible)
- Text content correctness (labels, headings, error messages)
- Interactive state (enabled/disabled, checked/unchecked, expanded/collapsed)
- DOM structure (correct nesting, ARIA roles, form field types)
- Accessibility compliance (roles, labels, tab order)

Snapshots are **not sufficient** for verifying:
- Visual styling (colors, fonts, spacing, alignment)
- Layout and positioning (responsive breakpoints, overlaps)
- Image rendering (icons, avatars, backgrounds)

**Rule:** Never abort browser testing just because screenshots fail. Fall back
to snapshot-based verification and note what could not be visually confirmed.

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
