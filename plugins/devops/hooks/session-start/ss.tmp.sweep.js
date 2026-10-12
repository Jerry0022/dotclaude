#!/usr/bin/env node
/**
 * @hook ss.tmp.sweep
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Removes the plugin's own dotclaude-* temp markers older than
 *   48 h from the OS temp directory (#699), at most once every 6 h however
 *   many sessions start.
 *
 *   Hooks and MCP servers keep small per-session and per-turn marker files in
 *   os.tmpdir(); without a sweep they piled up by the thousand per week.
 *   Durable cross-session state (team-changelog "last shown", locale) and
 *   live-process bookkeeping (MCP pid/heartbeat files, locks) are never
 *   touched. Silent and guarded end to end: a failure here never blocks or
 *   fails a session start.
 */

require('../lib/plugin-guard');

try {
  require('../lib/tmp-sweep').sweepTmp();
} catch { /* never block a session start */ }

process.exit(0);
