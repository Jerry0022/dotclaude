/**
 * @module session-autosave
 * @version 0.1.0
 * @description Safety net for a session worktree (.claude/worktrees/<name>)
 *   that ends a turn with uncommitted work or unpushed commits and no open PR:
 *   WIP-commit it (or snapshot to a backup ref on a detached HEAD) and push
 *   to origin — `refs/heads/<branch>`, or `parked/autosave/<branch>` when that
 *   push would not fast-forward. Never forces, never touches main/master/the
 *   default branch. Silent no-op on clean trees (no network), during a ship,
 *   in plugin-cache dirs, and within 10 min of the last autosave of the same
 *   worktree. Mode from devops-config `sessionEnd.autosave`: push|local|off.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { dirtyPaths } = require('./integration-check');
const { wipCommit, isProtected, defaultBranch, git } = require('./wip-commit');

const THROTTLE_MS = 10 * 60 * 1000;
const SESSION_WT = /[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)$/;

function defaultStateFile() {
  return process.env.DEVOPS_AUTOSAVE_STATE || path.join(os.homedir(), '.claude', 'devops-session-autosave.json');
}

function readState(file) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return d && typeof d === 'object' ? d : {}; } catch { return {}; }
}

function writeState(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);
  } catch { /* best effort */ }
}

function unpushedCount(top, branch) {
  if (!branch) return 0;
  const up = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], top);
  let base = up;
  if (!base && git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`], top)) base = `origin/${branch}`;
  if (!base) {
    const def = defaultBranch(top)
      || ['main', 'master'].find((b) => git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${b}`], top));
    if (!def) return 0;
    base = `origin/${def}`;
  }
  const n = git(['rev-list', '--count', `${base}..HEAD`], top);
  return n ? Number(n) || 0 : 0;
}

function defaultHasOpenPr(branch, cwd) {
  return git(['config', '--get', 'remote.origin.url'], cwd) ? ghOpenPr(branch, cwd) : false;
}

function ghOpenPr(branch, cwd) {
  try {
    const out = require('child_process').execFileSync('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'], {
      cwd, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const list = JSON.parse(out);
    return Array.isArray(list) && list.length > 0;
  } catch { return false; } // unknown -> save the work anyway
}

/**
 * @param {{cwd:string, mode?:string, now?:number, stateFile?:string,
 *   shipActive?:(top:string)=>boolean, hasOpenPr?:(branch:string,cwd:string)=>boolean}} o
 * @returns {{message:string}|null} a line for the model only when something was saved
 */
function autosave(o) {
  const mode = o.mode || 'push';
  if (mode === 'off') return null;
  const now = o.now || Date.now();
  const top = git(['rev-parse', '--show-toplevel'], o.cwd);
  if (!top) return null;
  const m = SESSION_WT.exec(path.resolve(top));
  if (!m || /^agent-/.test(m[1])) return null;
  if (/[\\/]plugins[\\/]cache[\\/]|[\\/]rpm[\\/]/.test(top.replace(/\\/g, '/'))) return null;
  try { if (!fs.statSync(path.join(top, '.git')).isFile()) return null; } catch { return null; }
  if ((o.shipActive || (() => false))(top)) return null;

  const branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], top);
  if (branch && isProtected(branch, top)) return null;
  const dirty = dirtyPaths(top).length > 0;
  const unpushed = unpushedCount(top, branch);
  if (!dirty && !unpushed) return null;

  const stateFile = o.stateFile || defaultStateFile();
  const key = crypto.createHash('md5').update(path.resolve(top).toLowerCase()).digest('hex').slice(0, 12);
  const state = readState(stateFile);
  if (now - (state[key] || 0) < THROTTLE_MS) return null;
  state[key] = now;
  for (const k of Object.keys(state)) if (now - state[k] > 24 * 3600 * 1000) delete state[k];
  writeState(stateFile, state);

  if (branch && (o.hasOpenPr || defaultHasOpenPr)(branch, top)) return null;

  const stamp = new Date(now).toISOString().replace(/\D/g, '').slice(0, 12);
  const backupRef = `refs/parked/autosave/${m[1]}-${stamp}`;
  let pushRef = null;
  const what = [];
  if (dirty) {
    const res = wipCommit(top, 'wip(session): autosave of uncommitted work', { detached: `ref:${backupRef}` });
    if (res.committed) what.push(res.ref ? `snapshot ${backupRef}` : `WIP commit ${String(res.sha).slice(0, 8)}`);
    else if (!unpushed) return null;
    if (res.ref) pushRef = res.ref;
  }
  if (unpushed) what.push(`${unpushed} unpushed commit(s)`);
  if (!what.length) return null;

  if (mode !== 'push') return { message: `[devops] autosaved session work locally (${what.join(', ')}) on ${branch || backupRef}.` };
  if (!git(['config', '--get', 'remote.origin.url'], top)) return { message: `[devops] autosaved session work locally (${what.join(', ')}); no origin remote to push to.` };

  let target = null;
  if (pushRef) {
    const dest = `refs/heads/parked/autosave/${m[1]}-${stamp}`;
    if (git(['push', 'origin', `${pushRef}:${dest}`], top) !== null) target = dest;
  } else {
    if (git(['push', 'origin', `HEAD:refs/heads/${branch}`], top) !== null) target = `refs/heads/${branch}`;
    else {
      const alt = `refs/heads/parked/autosave/${branch}`;
      if (git(['push', 'origin', `HEAD:${alt}`], top) !== null) target = alt;
    }
  }
  return {
    message: target
      ? `[devops] autosaved session work (${what.join(', ')}) and pushed it to origin as ${target.replace('refs/heads/', '')}.`
      : `[devops] autosaved session work locally (${what.join(', ')}); push to origin failed.`,
  };
}

module.exports = { autosave, THROTTLE_MS };
