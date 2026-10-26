'use strict';
/**
 * @module plugin-audit/util
 * @version 0.1.0
 * @description Shared helpers of the plugin-audit project skill: bounded
 *   child-process runner (never throws), token estimate, repo-relative paths,
 *   recursive file walker. Project skill of the plugin-source repo - not part
 *   of the shipped plugin.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/** Rough chars-per-token ratio used for every static estimate. */
const CHARS_PER_TOKEN = 3.5;

/** @param {number} chars */
function tokensOfChars(chars) {
  return Math.ceil((chars || 0) / CHARS_PER_TOKEN);
}

/**
 * Run a command, never throw. `shell` is enabled for npm on Windows (npm.cmd).
 * @returns {{ok:boolean, code:number|null, stdout:string, stderr:string, ms:number, error?:string}}
 */
function run(cmd, args, { cwd, timeout = 120000, input, env } = {}) {
  const t0 = Date.now();
  const shell = process.platform === 'win32' && /^(npm|npx)$/.test(cmd);
  const r = spawnSync(cmd, args, {
    cwd, timeout, input, encoding: 'utf8', windowsHide: true, shell,
    maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env,
  });
  const out = { ok: r.status === 0, code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', ms: Date.now() - t0 };
  if (r.error) out.error = r.error.code === 'ETIMEDOUT' ? `timeout after ${timeout} ms` : r.error.message;
  return out;
}

/** git helper: trimmed stdout or null on failure. */
function git(args, cwd, timeout = 30000) {
  const r = run('git', args, { cwd, timeout });
  return r.ok ? r.stdout.trim() : null;
}

/** Recursive file list (absolute paths), skipping node_modules and .git. */
function walk(dir, filter = () => true, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** Forward-slash relative path for reports. */
function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/** Compare two x.y.z strings. */
function cmpSemver(a, b) {
  const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

/** Build a check result object. */
function check(id, title, status, findings = [], extra = {}) {
  return { id, title, status, findings, durationMs: 0, ...extra };
}

/** Run `fn` as a check; an exception becomes a skipped check, never a crash. */
async function timed(id, title, fn) {
  const t0 = Date.now();
  let res;
  try { res = await fn(); } catch (e) { res = check(id, title, 'skipped', [{ msg: `check crashed: ${e && e.message || e}` }]); }
  res.id = res.id || id; res.title = res.title || title;
  res.durationMs = Date.now() - t0;
  return res;
}

/** Plugin-relative script path of a hook command (`node "${CLAUDE_PLUGIN_ROOT}/a/b.js" Arg`), without quotes or args. */
function hookCommandPath(command) {
  const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s]+)/.exec(String(command || ''));
  return m ? m[1] : null;
}

module.exports = { hookCommandPath, CHARS_PER_TOKEN, tokensOfChars, run, git, walk, readText, readJson, rel, cmpSemver, check, timed };
