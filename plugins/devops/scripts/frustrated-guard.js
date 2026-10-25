#!/usr/bin/env node
'use strict';
if (require.main === module && !require('../hooks/lib/features').featureAllowed('frustrated-mode')) {
  process.stderr.write('frustrated-mode: not available on this channel\n');
  process.exit(126);
}
/**
 * @script frustrated-guard
 * @feature frustrated-mode (alpha)
 * @description Arms / disarms the read-only guard of a frustrated analysis
 *   (hook pre.frustrated.readonly, lib hooks/lib/frustrated-guard.js).
 *
 *   Usage: node frustrated-guard.js arm [--target "<text>"] [--session <id>]
 *          node frustrated-guard.js disarm [--session <id>]
 *          node frustrated-guard.js status [--session <id>]
 *   Session: --session, else $CLAUDE_CODE_SESSION_ID / $CLAUDE_SESSION_ID.
 *   The PreToolUse hook applies arm/disarm with the payload's session_id as
 *   well, so a missing environment variable is not fatal.
 *   Output: one JSON line. Exit: 0 ok, 1 no session id / write failed,
 *   2 usage, 126 not available on this channel.
 */

function argOf(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * @param {string[]} argv
 * @param {object} [env]
 * @param {object} [opts] frustrated-guard opts (test injection)
 * @returns {{code:number, out:object}}
 */
function main(argv, env = process.env, opts = {}) {
  const g = require('../hooks/lib/frustrated-guard');
  if (!g.featureOn(opts)) return { code: 126, out: { ok: false, disabled: true, error: 'not available' } };
  const cmd = argv[0];
  if (!['arm', 'disarm', 'status'].includes(cmd)) {
    return { code: 2, out: { ok: false, error: 'usage: arm|disarm|status [--session <id>] [--target <text>]' } };
  }
  const sid = argOf(argv, '--session') || env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || '';
  if (!sid) return { code: 1, out: { ok: false, error: 'no session id (pass --session); the hook arms from its payload' } };
  if (cmd === 'arm') {
    const m = g.arm(sid, { cwd: opts.cwd || process.cwd(), target: argOf(argv, '--target') }, opts);
    return { code: m ? 0 : 1, out: { ok: !!m, armed: !!m, expiresAt: m ? new Date(m.expiresAt).toISOString() : null } };
  }
  if (cmd === 'disarm') return { code: 0, out: { ok: true, disarmed: g.disarm(sid, opts) } };
  const m = g.readMarker(sid, opts);
  return { code: 0, out: { ok: true, armed: !!m, expiresAt: m ? new Date(m.expiresAt).toISOString() : null, target: m ? m.target : null } };
}

if (require.main === module) {
  const r = main(process.argv.slice(2));
  process.stdout.write(JSON.stringify(r.out) + '\n');
  process.exit(r.code);
}

module.exports = { main };
