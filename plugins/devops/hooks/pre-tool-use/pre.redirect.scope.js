#!/usr/bin/env node
/**
 * @hook pre.redirect.scope
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Bash|PowerShell
 * @description Warn when a command redirects output (`> x.log`, `>> x`, `&> x`) to a path outside the git
 *   toplevel and the OS temp roots. Sessions that wrote `npm ci > ../npmci.log` left orphan logs in the
 *   shared projects folder. /dev/null and NUL count as inside; other directories count as outside.
 *   Advisory only: additionalContext with the scratchpad hint, never a deny and never a rewrite. Each
 *   target path warns once per session. Fails open on any error.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseHookInput } = require('../lib/hook-input');
const { redirectTargets, isAllowedWritePath } = require('../lib/frustrated-guard');

const SHELLS = new Set(['Bash', 'PowerShell']);

/** Drop heredoc bodies so `>` inside them is not read as a redirect. */
function stripHeredocs(cmd) {
  const out = [];
  let end = null;
  for (const line of String(cmd).split('\n')) {
    if (end !== null) { if (line.trim() === end) end = null; continue; }
    out.push(line);
    const m = /<<-?\s*(?:"([^"]+)"|'([^']+)'|\\?([A-Za-z_]\w*))/.exec(line);
    if (m) end = m[1] || m[2] || m[3];
  }
  return out.join('\n');
}

function toplevel(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd;
  } catch { return cwd; }
}

function norm(p) {
  const r = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/** Redirect targets of `cmd` that land outside `root` and the temp roots. */
function outsideTargets(cmd, cwd, root) {
  const rootN = norm(root);
  const res = [];
  for (const raw of redirectTargets(stripHeredocs(cmd))) {
    const t = raw.replace(/^["']|["']$/g, '');
    if (!t || /[$`*?]/.test(t) || t.startsWith('(')) continue; // unresolvable: no guess
    if (isAllowedWritePath(t, { cwd: root })) continue; // /dev/null, NUL, temp roots
    if (t.startsWith('~')) { res.push(t); continue; }
    const msys = process.platform === 'win32' && /^\/[a-zA-Z](?:\/|$)/.test(t) ? `${t[1]}:${t.slice(2) || '/'}` : t;
    const abs = norm(path.resolve(cwd, msys));
    if (abs === rootN || abs.startsWith(rootN + '/')) continue;
    if (isAllowedWritePath(abs, { cwd: root })) continue;
    res.push(t);
  }
  return res;
}

function warnText(targets) {
  return `[pre.redirect.scope] Output is redirected outside the repo and the temp dirs: ${targets.join(', ')}. ` +
    'Temp logs and command output belong in the session scratchpad (or %TEMP% / /tmp), never next to or above the repo ' +
    '(a log in `..` lands in the shared projects folder and is never cleaned up). Redirect there instead. ' +
    'Ignore this if the user asked for exactly this path.';
}

function decide(inputData) {
  const hook = parseHookInput(inputData);
  if (!hook || !SHELLS.has(hook.tool_name)) return null;
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  const cmd = typeof input.command === 'string' ? input.command : '';
  if (!cmd || !cmd.includes('>')) return null;
  const cwd = typeof hook.cwd === 'string' && hook.cwd ? hook.cwd : process.cwd();
  const targets = outsideTargets(cmd, cwd, toplevel(cwd));
  if (!targets.length) return null;
  const { sessionFile, writeSessionFile } = require('../lib/session-id');
  const marker = sessionFile('dotclaude-redirect-scope', hook.session_id || 'unknown');
  let seen = [];
  try { seen = fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean); } catch { /* first warning */ }
  const fresh = targets.filter(t => !seen.includes(t));
  if (!fresh.length) return null;
  try { writeSessionFile(marker, [...seen, ...fresh].join('\n')); } catch { /* best effort */ }
  return warnText(fresh);
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      const text = decide(inputData);
      if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } }));
    } catch { /* fail open */ }
    process.exit(0);
  });
}

module.exports = { decide, outsideTargets, stripHeredocs, warnText };
