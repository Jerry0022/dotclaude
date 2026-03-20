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

# ── 0. Plan selection ──────────────────────────────────────────────────────

echo "Which Claude plan do you have?"
echo ""
echo "  [1] Free   — token-optimized: no hooks, 2 skills, lite instructions"
echo "  [2] Pro    — balanced: dashboard, 5 skills, full instructions"
echo "  [3] Max    — full: all hooks, all skills, drift detection, cost guard"
echo ""
read -rp "Select plan [1/2/3] (default: 1): " plan_choice
plan_choice="${plan_choice:-1}"

case "$plan_choice" in
  1) PLAN="free"  ;;
  2) PLAN="pro"   ;;
  3) PLAN="max"   ;;
  *) echo "Invalid choice. Defaulting to free."; PLAN="free" ;;
esac

echo ""
echo "Selected plan: $PLAN"
echo ""

# Load plan config
PLAN_CONFIG="$SCRIPT_DIR/templates/plan-config.json"
CLAUDE_MD_FILE=$(node -e "const c=require('$PLAN_CONFIG');console.log(c.plans['$PLAN'].claudeMd)")
PLAN_SKILLS=$(node -e "const c=require('$PLAN_CONFIG');console.log(c.plans['$PLAN'].skills.join(' '))")

# ── 1. Core config files ────────────────────────────────────────────────────

echo "1. Deploying core config files..."
copy_file "$SCRIPT_DIR/$CLAUDE_MD_FILE" "$CLAUDE_HOME/CLAUDE.md"

# ── 2. Commands ─────────────────────────────────────────────────────────────

echo "2. Deploying commands..."
for f in "$SCRIPT_DIR"/commands/*.md; do
  [ -f "$f" ] || continue
  copy_file "$f" "$CLAUDE_HOME/commands/$(basename "$f")"
done

# ── 3. Skills (plan-filtered) ──────────────────────────────────────────────

echo "3. Deploying skills ($PLAN plan)..."
for d in "$SCRIPT_DIR"/skills/*/; do
  [ -d "$d" ] || continue
  skill_name="$(basename "$d")"
  # Check if skill is included in this plan
  if echo "$PLAN_SKILLS" | grep -qw "$skill_name"; then
    copy_file "$d/SKILL.md" "$CLAUDE_HOME/skills/$skill_name/SKILL.md"
  else
    echo "  [skip]  $skill_name (not in $PLAN plan)"
    # Remove skill if it was previously deployed
    if [ -f "$CLAUDE_HOME/skills/$skill_name/SKILL.md" ]; then
      rm "$CLAUDE_HOME/skills/$skill_name/SKILL.md"
      rmdir "$CLAUDE_HOME/skills/$skill_name" 2>/dev/null || true
      echo "  [remove] $skill_name (cleaned up from previous install)"
    fi
  fi
done

# ── 4. Scripts ───────────────────────────────────────────────────────────────

echo "4. Deploying scripts..."
for f in "$SCRIPT_DIR"/scripts/*.js; do
  [ -f "$f" ] || continue
  copy_file "$f" "$CLAUDE_HOME/scripts/$(basename "$f")"
done
copy_file "$SCRIPT_DIR/scripts/package.json" "$CLAUDE_HOME/scripts/package.json"
copy_file "$SCRIPT_DIR/scripts/package-lock.json" "$CLAUDE_HOME/scripts/package-lock.json"

# Deploy diagram template
if [ -d "$SCRIPT_DIR/scripts/diagrams" ]; then
  mkdir -p "$CLAUDE_HOME/scripts/diagrams"
  copy_file "$SCRIPT_DIR/scripts/diagrams/template.html" "$CLAUDE_HOME/scripts/diagrams/template.html"
fi

# ── 5. Plugins blocklist ────────────────────────────────────────────────────

echo "5. Deploying plugin config..."
copy_file "$SCRIPT_DIR/plugins/blocklist.json" "$CLAUDE_HOME/plugins/blocklist.json"

# ── 6. Settings.json (plan-specific) ──────────────────────────────────────

echo "6. Deploying settings.json ($PLAN plan)..."
SETTINGS_TEMPLATE="$SCRIPT_DIR/templates/settings.${PLAN}.json"
# Fall back to default template if plan-specific doesn't exist
if [ ! -f "$SETTINGS_TEMPLATE" ]; then
  SETTINGS_TEMPLATE="$SCRIPT_DIR/templates/settings.template.json"
fi

if [ -f "$CLAUDE_HOME/settings.json" ]; then
  echo "  [warn]  settings.json already exists — creating backup"
  cp "$CLAUDE_HOME/settings.json" "$CLAUDE_HOME/settings.json.backup"
fi
cp "$SETTINGS_TEMPLATE" "$CLAUDE_HOME/settings.json"

# ── 7. Config.json (defaults only — preserves runtime data) ─────────────────

echo "7. Deploying config.json..."
if [ -f "$CLAUDE_HOME/scripts/config.json" ]; then
  echo "  [skip]  config.json already exists (runtime data preserved)"
  echo "          Template at: templates/config.template.json"
else
  copy_file "$SCRIPT_DIR/templates/config.template.json" "$CLAUDE_HOME/scripts/config.json"
fi

# ── 8. Store repo path and plan for sync-check ──────────────────────────────

echo "8. Storing repo path and plan..."
echo "$SCRIPT_DIR" > "$CLAUDE_HOME/scripts/dotclaude-repo-path"
echo "$PLAN" > "$CLAUDE_HOME/scripts/dotclaude-plan"
echo "  [create] dotclaude-repo-path"
echo "  [create] dotclaude-plan ($PLAN)"

# ── 9. Install Node dependencies ────────────────────────────────────────────

echo "9. Installing script dependencies..."
if command -v npm > /dev/null 2>&1; then
  (cd "$CLAUDE_HOME/scripts" && npm ci --silent 2>/dev/null && echo "  [done]  npm ci") || \
  (cd "$CLAUDE_HOME/scripts" && npm install --silent 2>/dev/null && echo "  [done]  npm install")
else
  echo "  [warn]  npm not found — install Node.js and run 'npm ci' in $CLAUDE_HOME/scripts/"
fi

# ── 10. Summary ──────────────────────────────────────────────────────────────

echo ""
echo "Setup complete! (plan: $PLAN)"
echo ""

case "$PLAN" in
  free)
    echo "Token-optimized setup deployed:"
    echo "  - Lite instructions (CLAUDE-lite.md) — reduced context overhead"
    echo "  - 2 skills: commit, debug"
    echo "  - No hooks — maximum token budget for your work"
    echo ""
    echo "Next steps:"
    echo "  1. Start a Claude Code session — you're ready to go"
    echo "  2. To upgrade later, re-run setup and select a different plan"
    ;;
  pro)
    echo "Balanced setup deployed:"
    echo "  - Full instructions (CLAUDE.md)"
    echo "  - 5 skills: commit, debug, explain, readme, ship-dotclaude"
    echo "  - SessionStart dashboard hook"
    echo ""
    echo "Next steps:"
    echo "  1. Add MCP server permissions to settings.json if needed"
    echo "  2. Start a Claude Code session to verify"
    ;;
  max)
    echo "Full setup deployed:"
    echo "  - Full instructions (CLAUDE.md)"
    echo "  - All 7 skills"
    echo "  - All hooks: dashboard, drift detection, cost guard"
    echo ""
    echo "Next steps:"
    echo "  1. Add MCP server permissions to settings.json"
    echo "     (see templates/plugins-manifest.json for patterns)"
    echo "  2. Install plugins:"
    MANIFEST="$SCRIPT_DIR/templates/plugins-manifest.json"
    if command -v node > /dev/null 2>&1 && [ -f "$MANIFEST" ]; then
      node -e "
        const m = require('$MANIFEST');
        m.plugins.forEach(p => console.log('     claude plugins install ' + p + '@' + m.marketplace));
      " 2>/dev/null || echo "     (see templates/plugins-manifest.json)"
    fi
    echo "  3. Start a Claude Code session to verify"
    ;;
esac

echo ""
