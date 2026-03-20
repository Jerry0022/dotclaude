#!/usr/bin/env bash
# dotclaude setup — deploy global Claude Code configuration from this repo to ~/.claude/
# Works on macOS, Linux, and Windows (Git Bash / WSL).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOME="${HOME}/.claude"

echo "dotclaude setup"
echo "==============="
echo "Source:      $SCRIPT_DIR"
echo "Destination: $CLAUDE_HOME"
echo ""

# ── helpers ──────────────────────────────────────────────────────────────────

copy_file() {
  local src="$1" dst="$2"
  local dst_dir
  dst_dir="$(dirname "$dst")"
  mkdir -p "$dst_dir"
  if [ -f "$dst" ]; then
    if diff -q "$src" "$dst" > /dev/null 2>&1; then
      echo "  [skip]  $dst (identical)"
      return
    fi
    echo "  [update] $dst"
  else
    echo "  [create] $dst"
  fi
  cp "$src" "$dst"
}

# ── 1. Core config files ────────────────────────────────────────────────────

echo "1. Deploying core config files..."
copy_file "$SCRIPT_DIR/CLAUDE.md" "$CLAUDE_HOME/CLAUDE.md"

# ── 2. Commands ─────────────────────────────────────────────────────────────

echo "2. Deploying commands..."
for f in "$SCRIPT_DIR"/commands/*.md; do
  [ -f "$f" ] || continue
  copy_file "$f" "$CLAUDE_HOME/commands/$(basename "$f")"
done

# ── 3. Skills ────────────────────────────────────────────────────────────────

echo "3. Deploying skills..."
for d in "$SCRIPT_DIR"/skills/*/; do
  [ -d "$d" ] || continue
  skill_name="$(basename "$d")"
  copy_file "$d/SKILL.md" "$CLAUDE_HOME/skills/$skill_name/SKILL.md"
done

# ── 4. Scripts ───────────────────────────────────────────────────────────────

echo "4. Deploying scripts..."
for f in "$SCRIPT_DIR"/scripts/*.js; do
  [ -f "$f" ] || continue
  copy_file "$f" "$CLAUDE_HOME/scripts/$(basename "$f")"
done
copy_file "$SCRIPT_DIR/scripts/package.json" "$CLAUDE_HOME/scripts/package.json"
copy_file "$SCRIPT_DIR/scripts/package-lock.json" "$CLAUDE_HOME/scripts/package-lock.json"

# ── 5. Plugins blocklist ────────────────────────────────────────────────────

echo "5. Deploying plugin config..."
copy_file "$SCRIPT_DIR/plugins/blocklist.json" "$CLAUDE_HOME/plugins/blocklist.json"

# ── 6. Settings.json ────────────────────────────────────────────────────────

echo "6. Deploying settings.json..."
if [ -f "$CLAUDE_HOME/settings.json" ]; then
  echo "  [warn]  settings.json already exists — comparing with template."
  echo "          Review templates/settings.template.json and merge manually if needed."
  echo "          Backup: settings.json.backup"
  cp "$CLAUDE_HOME/settings.json" "$CLAUDE_HOME/settings.json.backup"
fi
cp "$SCRIPT_DIR/templates/settings.template.json" "$CLAUDE_HOME/settings.json"

# ── 7. Config.json (defaults only — preserves runtime data) ─────────────────

echo "7. Deploying config.json..."
if [ -f "$CLAUDE_HOME/scripts/config.json" ]; then
  echo "  [skip]  config.json already exists (runtime data preserved)"
  echo "          Template at: templates/config.template.json"
else
  copy_file "$SCRIPT_DIR/templates/config.template.json" "$CLAUDE_HOME/scripts/config.json"
fi

# ── 8. Store repo path for sync-check ────────────────────────────────────────

echo "8. Storing repo path for sync-check..."
echo "$SCRIPT_DIR" > "$CLAUDE_HOME/scripts/dotclaude-repo-path"
echo "  [create] $CLAUDE_HOME/scripts/dotclaude-repo-path"

# ── 9. Install Node dependencies ────────────────────────────────────────────

echo "9. Installing script dependencies..."
if command -v npm > /dev/null 2>&1; then
  (cd "$CLAUDE_HOME/scripts" && npm ci --silent 2>/dev/null && echo "  [done]  npm ci") || \
  (cd "$CLAUDE_HOME/scripts" && npm install --silent 2>/dev/null && echo "  [done]  npm install")
else
  echo "  [warn]  npm not found — install Node.js and run 'npm ci' in $CLAUDE_HOME/scripts/"
fi

# ── 10. Plugin installation reminder ────────────────────────────────────────

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Review settings.json — add MCP server permissions for your connected services"
echo "     (Google Calendar, Gmail, etc. — see templates/plugins-manifest.json for details)"
echo "  2. Install plugins if not already installed:"
MANIFEST="$SCRIPT_DIR/templates/plugins-manifest.json"
if command -v node > /dev/null 2>&1 && [ -f "$MANIFEST" ]; then
  node -e "
    const m = require('$MANIFEST');
    m.plugins.forEach(p => console.log('     claude plugins install ' + p + '@' + m.marketplace));
  " 2>/dev/null || echo "     (see templates/plugins-manifest.json for the full list)"
fi
echo "  3. Start a new Claude Code session to verify the setup."
echo ""
