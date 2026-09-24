# Polish Reference — dotclaude (plugin-source repo)

The standing UI rules (`plugins/devops/deep-knowledge/ui-defaults.md`) apply to
the plugin's own surfaces too: the concept pages the `auto-concept` templates
generate, the completion-card widget and the `/auto-guide` overlay. Their
sources are markdown and JavaScript, which the reminder hook does not treat as
UI files by default — the `files:` line below opts them in, so editing any of
them brings the rules into context.

## UI rules
- files: plugins/devops/skills/auto-concept/deep-knowledge/templates.md, plugins/devops/mcp-server/lib/card-widget.js, plugins/devops/scripts/web-guide-overlay.js
- Concept pages: every hover hint is `data-tip` through templates.md § App Tooltips, every scrollbar is the universal skin in § Layout CSS → Scrollbars, all colours from the page tokens (`--panel-bg`, `--text-color`, `--border-color`, `--accent-color`).
- Completion-card widget: host tokens only (`--surface-popover`, `--text-primary`, `--border-strong`, `--radius`), the four text sizes 16/14/13/11, tooltips positioned inside `.card-surface`, never `position: fixed`.
- `/auto-guide` overlay: its own palette in the closed shadow root, light and dark via `prefers-color-scheme`.
