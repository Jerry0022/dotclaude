#!/usr/bin/env node
/**
 * @hook post.governor.clear
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Bash|PowerShell
 * @description Clears what pre.governor.gate recorded for this tool call: the
 *   foreground marker (Claude no longer waits on it, so the watcher may pause
 *   a leftover generator) and the RAM reservation. Also registered for
 *   PostToolUseFailure. Silent, fail open.
 */

require('../lib/plugin-guard');

const path = require('path');

function main(hook) {
  if (hook.tool_name !== 'Bash' && hook.tool_name !== 'PowerShell') return null;
  const { paths } = require('../../scripts/governor/config');
  const fs = require('fs');
  const p = paths();
  const sid = String(hook.session_id || 'nosession').replace(/[^A-Za-z0-9_-]/g, '');
  const tid = String(hook.tool_use_id || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!tid) return null;
  for (const dir of [p.foreground, p.reservations]) {
    try { fs.unlinkSync(path.join(dir, `${sid}-${tid}.json`)); } catch {}
  }
  return null;
}

if (require.main === module) {
  try { require('../lib/hook-input').runHook(main, { event: 'PostToolUse' }); } catch { /* fail open */ }
}

module.exports = { main };
