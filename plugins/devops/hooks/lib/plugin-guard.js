#!/usr/bin/env node
/**
 * @module plugin-guard
 * @version 0.3.1
 * @description Project isolation guard — self-executing on require().
 *   Checks whether devops plugin is enabled for the current project
 *   (project settings) or globally (user settings). If neither, exits
 *   silently with code 0 so Claude Code does not treat it as a hook failure.
 *
 *   A plugin loaded ad hoc — `claude --plugin-dir <src>` or the
 *   `claude plugin eval` sandbox, which runs with a fresh HOME — is enabled
 *   in no settings file at all, yet Claude Code only invokes its hooks
 *   because it was explicitly loaded. Such a load runs the hook from a path
 *   outside the installed-plugin cache, and that is the tell: hooks running
 *   from outside `~/.claude/plugins/cache/` pass the guard. Before 0.2.0
 *   every hook was a silent no-op in an eval run, so behavioral evals could
 *   never see hook-injected context.
 *
 * Usage (first line in any hook script):
 *   require('../lib/plugin-guard');
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_KEY_LEGACY_V1 = 'dotclaude-dev-ops@Jerry0022';
const PLUGIN_KEY_LEGACY_V2 = 'dotclaude-dev-ops@dotclaude-dev-ops';
const PLUGIN_KEY = 'devops@dotclaude';

// Project settings live at the repo root, not wherever the session cwd has
// wandered to — a session in a subdirectory must not silence every hook of a
// per-project-enabled plugin (lib/project-root.js).
const projectDir = require('./project-root').projectClaudeDir(process.cwd());
const projectSettings = path.join(projectDir, 'settings.json');
const projectLocalSettings = path.join(projectDir, 'settings.local.json');
const globalSettings = path.join(os.homedir(), '.claude', 'settings.json');

function isEnabledInAny(settingsPath) {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings.enabledPlugins) return false;
    return !!(settings.enabledPlugins[PLUGIN_KEY] || settings.enabledPlugins[PLUGIN_KEY_LEGACY_V2] || settings.enabledPlugins[PLUGIN_KEY_LEGACY_V1]);
  } catch {
    return false;
  }
}

function realpathOr(p) {
  try { return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p); }
  catch { return path.resolve(p); }
}

/**
 * True when the running hook was loaded from a source dir, not the install
 * cache. Both sides go through realpath so a junction, a symlinked cache or
 * a HOME≠USERPROFILE mismatch cannot flip the answer either way (redteam #15).
 */
function isAdHocLoad() {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (!root) return false;
  const cacheDir = realpathOr(path.join(os.homedir(), '.claude', 'plugins', 'cache'));
  const rel = path.relative(cacheDir, realpathOr(root));
  return rel.startsWith('..') || path.isAbsolute(rel);
}

if (!isEnabledInAny(projectSettings) && !isEnabledInAny(projectLocalSettings)
    && !isEnabledInAny(globalSettings) && !isAdHocLoad()) {
  process.exit(0);
}
