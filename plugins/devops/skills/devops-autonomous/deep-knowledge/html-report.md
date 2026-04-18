# Autonomous HTML Report — Structure & Design

Save `AUTONOMOUS-REPORT.html` to project root (replaces any previous report).

The HTML file must be a **self-contained single file** (inline CSS, no
external deps). Use a clean, modern dark-theme design.

## Structure

**Header section:**
- Task goal, mode (Implement/Analyze), status badge (green/yellow/red)
- Duration, branch name (implement mode), timestamp

**Completion Card section:**
- Embed the full completion card data in a styled card widget
- Include: summary, changes, test results, build-ID, usage/battery info
- Present it visually (not raw markdown) — use the card's data fields

**`implement` mode — additional sections:**
- **Changes** — collapsible table: file, action, summary
- **Verification** — build status, test results, live test results
- **Related Fixes / Blocked Actions / Warnings** — if any

**`analyze` mode — additional sections:**
- **Findings** — key observations as styled cards or list
- **Architecture / Code Quality** — insights with visual hierarchy
- **Recommendations** — priority-sorted table: priority, area, recommendation, effort
- **Visual Verification** — embedded screenshots (base64 data URIs if taken)

**Both modes — footer:**
- Open questions (if any)
- Timestamp, branch info, git status summary

## Design Guidelines

- Dark background (#1a1a2e or similar), accent colors for status
- Collapsible sections via `<details>/<summary>`
- Status badge: COMPLETED = green, INTERRUPTED = amber, PARTIAL = amber, BLOCKED = red
- INTERRUPTED section: show missing permission, saved progress, resume instructions
- Responsive layout, readable on any screen size
- Monospace font for code/file paths, sans-serif for prose
