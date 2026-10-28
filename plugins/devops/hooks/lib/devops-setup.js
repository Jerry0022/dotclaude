'use strict';
/**
 * @lib devops-setup
 * @version 0.1.0
 * @plugin devops
 * @description Logic of the first-run setup guide (skills/auto-setup): the
 *   prerequisite check (git, Git Bash on Windows, node) and the writers for
 *   the settings the guide changes after the user's answer — Claude Code
 *   `language`, the Quiet output style, the delegation switch. Every writer
 *   takes `home` so tests never touch the real ~/.claude. Writers refuse an
 *   unparseable settings file instead of overwriting it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MARKER = 'devops-setup.json';
const DELEGATION_MODES = ['auto', 'ask', 'off'];
const LANGUAGES = { de: 'german', en: 'english' };
const WINGET_GIT = 'winget install Git.Git';
const WINGET_NODE = 'winget install OpenJS.NodeJS.LTS';

/** Git Bash candidates: Git for Windows keeps bash.exe in <root>\bin. */
function gitBashCandidates(env = process.env) {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432]
    .filter(Boolean).map((p) => path.join(p, 'Git'));
  if (env.LOCALAPPDATA) roots.push(path.join(env.LOCALAPPDATA, 'Programs', 'Git'));
  const list = roots.map((r) => path.join(r, 'bin', 'bash.exe'));
  if (env.CLAUDE_CODE_GIT_BASH_PATH) list.unshift(env.CLAUDE_CODE_GIT_BASH_PATH);
  return list;
}

/**
 * Which prerequisites are missing. `node` is the running interpreter, so it is
 * only reported when too old (a missing node never reaches a hook at all —
 * the README names it as a prerequisite instead). Git Bash matters on Windows only.
 * @returns {{missing:string[], winget:string[]}}
 */
function checkPrereqs({ platform = process.platform, env = process.env, exists = fs.existsSync, run, nodeVersion = process.versions.node } = {}) {
  const missing = [];
  const winget = [];
  const exec = run || ((cmd, args) => spawnSync(cmd, args, { timeout: 3000, windowsHide: true }));
  let gitOk = false;
  try { gitOk = exec('git', ['--version']).status === 0; } catch { gitOk = false; }
  if (!gitOk) { missing.push('git'); winget.push(WINGET_GIT); }
  if (platform === 'win32' && !gitBashCandidates(env).some((p) => exists(p))) {
    missing.push('git-bash');
    if (!winget.includes(WINGET_GIT)) winget.push(WINGET_GIT);
  }
  if (Number(String(nodeVersion).split('.')[0]) < 18) { missing.push('node'); winget.push(WINGET_NODE); }
  return { missing, winget };
}

function markerPath(home = os.homedir()) { return path.join(home, '.claude', MARKER); }

/** True when the one-time offer was already made on this machine. */
function wasOffered(home) { return fs.existsSync(markerPath(home)); }

function recordOffer(home = os.homedir()) {
  const file = markerPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ offeredAt: new Date().toISOString() }, null, 2) + '\n');
}

function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  const obj = JSON.parse(raw); // a throw = unparseable: the caller refuses to write
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${file} is not a JSON object`);
  return obj;
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

function patchSettings(home, patch) {
  const file = path.join(home, '.claude', 'settings.json');
  writeJson(file, { ...readJson(file), ...patch });
  return file;
}

/** Claude Code `language` (de | en) — what configuredLocale() in lib/locale.js reads. */
function setLanguage(code, home = os.homedir()) {
  if (!LANGUAGES[code]) throw new Error(`language must be one of: ${Object.keys(LANGUAGES).join(', ')}`);
  return { file: patchSettings(home, { language: LANGUAGES[code] }), value: LANGUAGES[code] };
}

/**
 * Install the Quiet style and select it. An existing quiet.md that differs
 * from the template is the user's customization: kept, the style is still selected.
 */
function installQuiet(pluginRoot, home = os.homedir()) {
  const tpl = fs.readFileSync(path.join(pluginRoot, 'templates', 'output-style-quiet.md'), 'utf8');
  const dst = path.join(home, '.claude', 'output-styles', 'quiet.md');
  let copied = false;
  let keptCustom = false;
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, tpl);
    copied = true;
  } else {
    keptCustom = fs.readFileSync(dst, 'utf8') !== tpl;
  }
  const settings = patchSettings(home, { outputStyle: 'Quiet' });
  return { copied, keptCustom, file: dst, settings };
}

/** Write the delegation switch (`auto|ask|off`); lib/delegation.js only reads it. */
function setDelegation(mode, { scope = 'global', cwd = process.cwd(), home = os.homedir() } = {}) {
  if (!DELEGATION_MODES.includes(mode)) throw new Error(`mode must be one of: ${DELEGATION_MODES.join(', ')}`);
  const file = path.join(scope === 'project' ? cwd : home, '.claude', 'delegation.json');
  writeJson(file, { ...readJson(file), mode });
  return { file, mode };
}

module.exports = {
  MARKER, DELEGATION_MODES, LANGUAGES,
  gitBashCandidates, checkPrereqs, wasOffered, recordOffer, markerPath,
  setLanguage, installQuiet, setDelegation,
};
