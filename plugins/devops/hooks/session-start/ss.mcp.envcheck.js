#!/usr/bin/env node
/**
 * @hook ss.mcp.envcheck
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Detect enabled plugins whose .mcp.json references env vars
 *   that are not set. Prevents cryptic mid-session crashes like
 *   "Plugin MCP server error - mcp-config-invalid: MCP server X invalid:
 *   Missing environment variables: FOO" by surfacing the issue at session
 *   start with concrete fix options for the user.
 *
 *   Scope: globally-enabled plugins in ~/.claude/settings.json. Project-
 *   level enabledPlugins (project/.claude/settings.json) and local
 *   overrides are not inspected here — they'd require knowing CWD at hook
 *   time, and the global level catches the common "I enabled it once and
 *   forgot" footgun the user actually hit.
 *
 *   Output: stdout text block (additionalContext) so Claude relays it to
 *   the user verbatim. Never exit(2) — env-var setup is a user choice, not
 *   a hard error we should block on.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');

const home = process.env.HOME || process.env.USERPROFILE || '';
if (!home) process.exit(0);

const PLUGINS_CACHE = path.join(home, '.claude', 'plugins', 'cache');
const SETTINGS = path.join(home, '.claude', 'settings.json');

if (!fs.existsSync(PLUGINS_CACHE) || !fs.existsSync(SETTINGS)) process.exit(0);

let settings;
try {
  settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
} catch {
  process.exit(0);
}

const enabledPlugins = settings.enabledPlugins || {};
const ENV_VAR_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

function findMcpJson(marketplace, pluginName) {
  const baseDir = path.join(PLUGINS_CACHE, marketplace, pluginName);
  if (!fs.existsSync(baseDir)) return null;

  // .mcp.json may sit directly under the plugin dir, or one level down
  // under a version-hash subfolder (e.g. github/61c0597779bd/.mcp.json).
  const direct = path.join(baseDir, '.mcp.json');
  if (fs.existsSync(direct)) return direct;

  let entries;
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(baseDir, entry.name, '.mcp.json');
    if (fs.existsSync(nested)) return nested;
  }
  return null;
}

function collectEnvRefs(configStr) {
  const refs = new Set();
  let m;
  ENV_VAR_RE.lastIndex = 0;
  while ((m = ENV_VAR_RE.exec(configStr)) !== null) refs.add(m[1]);
  return refs;
}

const issues = [];

for (const [key, enabled] of Object.entries(enabledPlugins)) {
  if (enabled !== true) continue;
  const at = key.lastIndexOf('@');
  if (at < 1) continue;
  const pluginName = key.slice(0, at);
  const marketplace = key.slice(at + 1);

  const mcpJsonPath = findMcpJson(marketplace, pluginName);
  if (!mcpJsonPath) continue;

  let raw;
  try {
    raw = fs.readFileSync(mcpJsonPath, 'utf8');
  } catch {
    continue;
  }
  // Validate JSON parses, but scan the raw text so we catch refs in any
  // position (URL, header value, args, env block — wherever the plugin
  // author put them).
  try {
    JSON.parse(raw);
  } catch {
    continue;
  }

  const refs = collectEnvRefs(raw);
  if (refs.size === 0) continue;

  const missing = [...refs].filter((v) => !process.env[v]);
  if (missing.length > 0) {
    issues.push({ plugin: pluginName, marketplace, missing, configPath: mcpJsonPath });
  }
}

if (issues.length === 0) process.exit(0);

const out = [];
out.push('MCP env-var check at session start. Show the user this block verbatim:');
out.push('');
out.push('⚠️  **MCP-Server-Konfiguration unvollständig**');
out.push('');
out.push('Diese aktivierten Plugins erwarten Environment-Variablen, die nicht gesetzt sind. Sobald Claude den jeweiligen Server kontaktiert, crasht der Tool-Call mit `mcp-config-invalid` (genau wie in deinen letzten Errors):');
out.push('');
for (const issue of issues) {
  const vars = issue.missing.map((v) => `\`${v}\``).join(', ');
  out.push(`- **${issue.plugin}** (\`${issue.marketplace}\`) → fehlt: ${vars}`);
}
out.push('');
out.push('**Was tun — eine Option pro Plugin wählen:**');
out.push('');
out.push('1. **Variable setzen** — den Token/Wert in eine User-Env oder in `~/.claude/settings.json` unter `env: { ... }` eintragen, dann neue Session starten.');
out.push('2. **Plugin deaktivieren** — in `~/.claude/settings.json` unter `enabledPlugins` den Eintrag auf `false` setzen. Spart den Crash, wenn du das Plugin gerade nicht brauchst.');
out.push('');
out.push('Frag den Nutzer welche Option für jedes betroffene Plugin gelten soll, bevor du Änderungen machst.');

process.stdout.write(out.join('\n'));
