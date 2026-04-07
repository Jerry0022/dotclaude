#!/usr/bin/env node
/**
 * @module plugin-guard
 * @version 0.1.0
 * @description Project isolation guard — self-executing on require().
 *   Checks whether devops plugin is enabled for the current project
 *   (project settings) or globally (user settings). If neither, exits
 *   silently with code 0 so Claude Code does not treat it as a hook failure.
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

const projectSettings = path.join(process.cwd(), '.claude', 'settings.json');
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

if (!isEnabledInAny(projectSettings) && !isEnabledInAny(globalSettings)) {
  process.exit(0);
}
