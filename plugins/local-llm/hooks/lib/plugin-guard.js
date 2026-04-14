#!/usr/bin/env node
/**
 * @module plugin-guard
 * @version 0.1.0
 * @description Project isolation guard for the local-llm plugin.
 *   Checks whether the plugin is enabled in project or global settings.
 *   Exits silently (code 0) if not enabled.
 *
 * Usage (first line in any hook script):
 *   require('../lib/plugin-guard');
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_KEY = 'local-llm@dotclaude';

const projectSettings = path.join(process.cwd(), '.claude', 'settings.json');
const globalSettings = path.join(os.homedir(), '.claude', 'settings.json');

function isEnabledInAny(settingsPath) {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings.enabledPlugins) return false;
    return !!settings.enabledPlugins[PLUGIN_KEY];
  } catch {
    return false;
  }
}

if (!isEnabledInAny(projectSettings) && !isEnabledInAny(globalSettings)) {
  process.exit(0);
}
