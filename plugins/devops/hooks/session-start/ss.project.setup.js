#!/usr/bin/env node
/**
 * @hook ss.project.setup
 * @version 0.2.0
 * @event SessionStart
 * @plugin devops
 * @description The automatic part of project setup (the former /setup-project
 *   skill; its interactive rest is deep-knowledge/project-setup.md).
 *
 *   1. Keeps the canonical `# >>> claude (managed) >>>` block of the repo's
 *      `.gitignore` current (lib/runtime-ignores.js): a repo whose
 *      `.gitignore` already carries the block gets it rewritten in place when
 *      a plugin release changed it; a repo without a commit yet gets it
 *      written (that is its project setup). An established repo without the
 *      block is left alone — its `.gitignore` is reviewed content, so the
 *      move is `scripts/claude-ignore.js migrate`, offered by ship_preflight
 *      when a ship touches `.gitignore` or `.claude/`. Nothing is written
 *      while a rebase or merge is in progress. `.git/info/exclude` is no
 *      longer written (a block an earlier version left there keeps working
 *      until `migrate` removes it).
 *   2. A new repository (no commit yet, or no root `.gitignore`) gets a
 *      one-time offer of the project setup — once per clone, recorded in
 *      ~/.claude/devops-project-setup.json; the setup itself only runs when
 *      the user agrees.
 *
 *   Silent otherwise. Outside a git work tree, for a dotfiles repo rooted at
 *   the home directory seen from a subfolder, and for a git repo at
 *   ~/.claude itself (the home backup), it does nothing. Pure fs plus at most
 *   one `git rev-parse` (5 s cap) — boot-window safe.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findRepoRoot, gitCommonDir, samePath } = require('../lib/project-root');
const { applyBlock, migrateGitignore, BLOCK_START } = require('../lib/runtime-ignores');

const STATE_FILE = 'devops-project-setup.json';

/** The worktree's own git dir (MERGE_HEAD, rebase state live there). */
function ownGitDir(root) {
  const dotGit = path.join(root, '.git');
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    return m ? path.resolve(root, m[1]) : null;
  } catch {
    return null;
  }
}

function operationInProgress(root) {
  const dir = ownGitDir(root);
  if (!dir) return true;
  return ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']
    .some((f) => fs.existsSync(path.join(dir, f)));
}

/**
 * Keep the managed block of `<root>/.gitignore` current.
 * @param {string} root work-tree root
 * @param {boolean} isNew no commit yet
 * @returns {'written'|'current'|'skipped'|'error'}
 */
function syncGitignore(root, isNew) {
  const file = path.join(root, '.gitignore');
  let old = '';
  try { old = fs.readFileSync(file, 'utf8'); } catch { /* absent */ }
  const text = old.replace(/\r\n/g, '\n');
  const hasBlock = text.split('\n').some((l) => l.startsWith(BLOCK_START));
  if (!hasBlock && !isNew) return 'skipped';
  if (operationInProgress(root)) return 'skipped';
  const next = hasBlock ? applyBlock(text) : migrateGitignore(text).text;
  if (next === text) return 'current';
  try {
    fs.writeFileSync(file, old.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next);
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
 * @returns {{gitignore:string|null, offer:string|null}}
 */
function setupProject({ cwd, home = os.homedir(), pluginRoot = path.resolve(__dirname, '..', '..') }) {
  const start = path.resolve(cwd || process.cwd());
  const root = findRepoRoot(start);
  if (!root) return { gitignore: null, offer: null };
  try {
    if (samePath(root, home) && !samePath(start, root)) return { gitignore: null, offer: null };
  } catch { /* keep going */ }
  try {
    if (samePath(root, path.join(home, '.claude'))) return { gitignore: null, offer: null };
  } catch { /* keep going */ }
  const common = gitCommonDir(root);
  if (!common) return { gitignore: null, offer: null };

  const reason = newRepoReason(root);
  const gitignore = syncGitignore(root, reason === 'no commit yet');
  if (!reason) return { gitignore, offer: null };
  const stateFile = path.join(home, '.claude', STATE_FILE);
  const state = readState(stateFile);
  const key = path.resolve(common).replace(/\\/g, '/').toLowerCase();
  if (state.offered[key]) return { gitignore, offer: null };
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
  return { gitignore, offer };
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

module.exports = { setupProject, syncGitignore, newRepoReason };
