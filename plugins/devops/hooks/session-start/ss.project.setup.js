#!/usr/bin/env node
/**
 * @hook ss.project.setup
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description The automatic part of project setup (the former /setup-project
 *   skill; its interactive rest is deep-knowledge/project-setup.md).
 *
 *   1. Keeps the plugin's runtime files out of git: writes the marked block
 *      from lib/runtime-ignores.js into the clone's `.git/info/exclude` —
 *      replaced in place when it changed, untouched when current. Local to
 *      the clone and shared by all its worktrees (the file lives in the git
 *      common dir), so it never shows up as a diff in the repo, and a plugin
 *      release that adds an artifact covers every clone at its next session.
 *   2. A new repository (no commit yet, or no root `.gitignore`) gets a
 *      one-time offer of the project setup — once per clone, recorded in
 *      ~/.claude/devops-project-setup.json; the setup itself only runs when
 *      the user agrees.
 *
 *   Silent otherwise. Outside a git work tree, and for a dotfiles repo rooted
 *   at the home directory seen from a subfolder, it does nothing. Pure fs
 *   plus at most one `git rev-parse` (5 s cap) — boot-window safe.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findRepoRoot, gitCommonDir, samePath } = require('../lib/project-root');
const { applyBlock } = require('../lib/runtime-ignores');

const STATE_FILE = 'devops-project-setup.json';

/**
 * Bring `<common>/info/exclude` up to date.
 * @returns {'written'|'current'|'error'}
 */
function syncExclude(commonDir) {
  const file = path.join(commonDir, 'info', 'exclude');
  let old = '';
  try { old = fs.readFileSync(file, 'utf8'); } catch { /* absent — created below */ }
  const next = applyBlock(old);
  if (next === old.replace(/\r\n/g, '\n')) return 'current';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next);
    return 'written';
  } catch {
    return 'error';
  }
}

/** Why this repo looks new, or null. */
function newRepoReason(root) {
  let hasCommit = true;
  try {
    execFileSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root, stdio: 'ignore', timeout: 5000 });
  } catch (e) {
    // exit 1 = no commit yet; a timeout or missing git proves nothing
    hasCommit = !(e && e.status === 1);
  }
  if (!hasCommit) return 'no commit yet';
  if (!fs.existsSync(path.join(root, '.gitignore'))) return 'no .gitignore';
  return null;
}

function readState(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data.offered === 'object' && data.offered) return data;
  } catch { /* absent or broken */ }
  return { offered: {} };
}

/**
 * Run both steps for `cwd`.
 * @param {{cwd:string, home?:string, pluginRoot?:string}} o
 * @returns {{exclude:string|null, offer:string|null}}
 */
function setupProject({ cwd, home = os.homedir(), pluginRoot = path.resolve(__dirname, '..', '..') }) {
  const start = path.resolve(cwd || process.cwd());
  const root = findRepoRoot(start);
  if (!root) return { exclude: null, offer: null };
  try {
    if (samePath(root, home) && !samePath(start, root)) return { exclude: null, offer: null };
  } catch { /* keep going */ }
  const common = gitCommonDir(root);
  if (!common) return { exclude: null, offer: null };

  const exclude = syncExclude(common);

  const reason = newRepoReason(root);
  if (!reason) return { exclude, offer: null };
  const stateFile = path.join(home, '.claude', STATE_FILE);
  const state = readState(stateFile);
  const key = path.resolve(common).replace(/\\/g, '/').toLowerCase();
  if (state.offered[key]) return { exclude, offer: null };
  state.offered[key] = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  } catch { /* the offer may repeat once — harmless */ }

  const doc = path.join(pluginRoot, 'deep-knowledge', 'project-setup.md').replace(/\\/g, '/');
  const offer = [
    `[ss.project.setup] New repository at ${root.replace(/\\/g, '/')} (${reason}).`,
    'Offer the user a one-time project setup in ONE short line of your first reply — .gitignore for the detected',
    `stack, a LICENSE, the project map. Do not run it unasked; when the user agrees, follow ${doc}.`,
    'This offer is made once per repository — do not repeat it later in the session.',
  ].join('\n');
  return { exclude, offer };
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    let hook = {};
    try { hook = JSON.parse(input); } catch { /* no input — use process.cwd() */ }
    let res;
    try {
      res = setupProject({ cwd: hook.cwd || process.cwd() });
    } catch {
      process.exit(0);
    }
    if (res && res.offer) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: res.offer },
      }) + '\n');
    }
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { setupProject, syncExclude, newRepoReason };
