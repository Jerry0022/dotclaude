/**
 * @module session-autosave
 * @version 0.2.0
 * @description Safety net for a session worktree (.claude/worktrees/<name>)
 *   that ends a turn with uncommitted work or unpushed commits and no open PR.
 *
 *   What it does NOT do: touch the user's index, working tree or session
 *   branch. The state is saved as a snapshot commit (temporary index; parents
 *   HEAD + the previous snapshot) on ONE stable ref per worktree,
 *   `refs/heads/parked/autosave/<name>` — a local branch, so the park register
 *   sees it. Mode `push` additionally pushes it (plain push, never force; the
 *   chain is fast-forward by construction) and fast-forwards the session
 *   branch ONLY when that branch already exists on origin — a branch that was
 *   never pushed, or was deleted after a squash merge, is never (re)created.
 *
 *   Skipped silently: mode off, main checkout / agent-* / plugin-cache dirs,
 *   an active ship, a git operation in progress, protected branches, an open
 *   PR (documented gap: work on a PR branch is that PR's business — uncommitted
 *   changes beyond it are not saved), the throttle (10 min per worktree,
 *   checked first, stamped only after the save), and — for unpushed commits —
 *   an upstream that is gone, a landed HEAD or a merged PR for this head.
 *   Secrets, build output, tooling state and big files are left out (and
 *   reported in the message). Global deadline 35 s (hook timeout 45 s).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { loadHygiene } = require('./integration-check');
const { snapshotCommit, savablePaths, inProgress, isProtected, defaultBranch, git } = require('./wip-commit');

const THROTTLE_MS = 10 * 60 * 1000;
const FAIL_RETRY_MS = 2 * 60 * 1000;
const DEADLINE_MS = 35 * 1000;
const SESSION_WT = /[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)$/;
const PLUGIN_DIRS = /\/\.claude\/plugins\/cache\/|\/claude\/rpm\//i;

function defaultStateFile() {
  return process.env.DEVOPS_AUTOSAVE_STATE || path.join(os.homedir(), '.claude', 'devops-session-autosave.json');
}

function readState(file) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return d && typeof d === 'object' ? d : {}; } catch { return {}; }
}

function sleep(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* none */ }
}

/** Read-modify-write of the state file under a lock file (stale after 30 s). */
function updateState(file, mutate) {
  const lock = `${file}.lock`;
  let fd = null;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* best effort */ }
  for (let i = 0; i < 40 && fd === null; i++) {
    try { fd = fs.openSync(lock, 'wx'); } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.unlinkSync(lock); } catch { /* raced */ }
      sleep(50);
    }
  }
  try {
    const state = readState(file);
    mutate(state);
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
    fs.renameSync(tmp, file);
  } catch { /* best effort */ } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* none */ } try { fs.unlinkSync(lock); } catch { /* none */ } }
  }
}

function ghJson(args, cwd, timeout) {
  try {
    return JSON.parse(require('child_process').execFileSync('gh', args, {
      cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch { return null; }
}

const hasRemote = (cwd) => Boolean(git(['config', '--get', 'remote.origin.url'], cwd));
/** Open PR for the branch? Unknown (no gh / offline) counts as no. */
function defaultHasOpenPr(branch, cwd) {
  if (!hasRemote(cwd)) return false;
  const l = ghJson(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'], cwd, 15000);
  return Array.isArray(l) && l.length > 0;
}
/** Head shas of merged PRs from this branch name. */
function defaultMergedHeads(branch, cwd) {
  if (!hasRemote(cwd)) return [];
  const l = ghJson(['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'headRefOid'], cwd, 15000);
  return Array.isArray(l) ? l.map((x) => x.headRefOid).filter(Boolean) : [];
}

/**
 * @param {{cwd:string, mode?:string, now?:number, stateFile?:string, deadline?:number,
 *   shipActive?:(top:string)=>boolean, hasOpenPr?:(b:string,cwd:string)=>boolean,
 *   mergedHeads?:(b:string,cwd:string)=>string[]}} o
 * @returns {Promise<{message:string}|null>} a line only when something was saved
 */
async function autosave(o) {
  const mode = o.mode || 'local';
  if (mode === 'off') return null;
  const now = o.now || Date.now();
  const deadline = o.deadline || (Date.now() + DEADLINE_MS);
  const left = () => Math.max(1000, deadline - Date.now());
  const top = git(['rev-parse', '--show-toplevel'], o.cwd);
  if (!top) return null;
  const norm = path.resolve(top);
  const m = SESSION_WT.exec(norm);
  if (!m || /^agent-/.test(m[1])) return null;
  if (PLUGIN_DIRS.test(norm.replace(/\\/g, '/'))) return null;
  try { if (!fs.statSync(path.join(top, '.git')).isFile()) return null; } catch { return null; }
  if ((o.shipActive || (() => false))(top)) return null;

  const stateFile = o.stateFile || defaultStateFile();
  const key = crypto.createHash('md5').update(norm.toLowerCase()).digest('hex').slice(0, 12);
  if (now - (readState(stateFile)[key] || 0) < THROTTLE_MS) return null;

  if (inProgress(top)) return null;
  const branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], top);
  if (branch && isProtected(branch, top)) return null;

  const stamp = (ok) => updateState(stateFile, (st) => {
    st[key] = ok ? now : now - THROTTLE_MS + FAIL_RETRY_MS;
    for (const k of Object.keys(st)) if (now - st[k] > 24 * 3600 * 1000) delete st[k];
  });

  const { paths, skipped } = await savablePaths(top);
  const def = defaultBranch(top);
  let unpushed = 0;
  let remoteExists = false;
  if (branch) {
    const track = git(['for-each-ref', '--format=%(upstream:track)', `refs/heads/${branch}`], top) || '';
    const gone = /gone/.test(track);
    remoteExists = !gone && Boolean(git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`], top));
    const base = remoteExists ? `origin/${branch}` : (!gone && def ? `origin/${def}` : null);
    if (base) unpushed = Number(git(['rev-list', '--count', `${base}..HEAD`], top)) || 0;
  }
  if (!paths.length && !unpushed) return null;

  if (branch && (o.hasOpenPr || defaultHasOpenPr)(branch, top)) return null;

  if (unpushed) {
    const head = git(['rev-parse', 'HEAD'], top);
    const hyg = def ? await loadHygiene() : null;
    let landed = false;
    try {
      landed = Boolean(hyg && hyg.landingState(head, branch, { cwd: top, baseRef: `origin/${def}`, merged: null }).state === 'landed');
    } catch { /* unknown */ }
    if (!landed) {
      for (const oid of (o.mergedHeads || defaultMergedHeads)(branch, top)) {
        if (oid === head || git(['merge-base', '--is-ancestor', head, oid], top) !== null) { landed = true; break; }
      }
    }
    if (landed) unpushed = 0;
  }
  if (!paths.length && !unpushed) { stamp(true); return null; }

  const ref = `refs/heads/parked/autosave/${m[1]}`;
  const short = ref.replace('refs/heads/', '');
  const what = [];
  let target = null;
  let failed = false;

  // 1. fast-forward the session branch — only where it already exists on origin
  let branchPushed = false;
  if (mode === 'push' && unpushed && remoteExists && Date.now() < deadline) {
    if (git(['push', 'origin', `HEAD:refs/heads/${branch}`], top, { timeout: left() }) !== null) {
      branchPushed = true;
      target = branch;
      what.push(`${unpushed} unpushed commit(s)`);
    }
  }

  // 2. snapshot on the stable parked ref (dirty work, or commits with no remote branch)
  if (paths.length || (unpushed && !branchPushed)) {
    const prev = git(['rev-parse', '--verify', '-q', ref], top);
    const sha = snapshotCommit(top, paths, 'wip(session): autosave', prev ? ['HEAD', prev] : ['HEAD'], left());
    if (!sha || git(['update-ref', ref, sha], top) === null) { stamp(false); return null; }
    what.push(paths.length ? `${paths.length} changed file(s)` : `${unpushed} unpushed commit(s)`);
    if (mode === 'push') {
      if (Date.now() < deadline && git(['push', 'origin', `${sha}:refs/heads/${short}`], top, { timeout: left() }) !== null) {
        target = target ? `${target} + ${short}` : short;
      } else failed = true;
    }
  }

  stamp(!failed);
  const left_out = skipped.length ? ` ${skipped.length} file(s) left out (secrets/build output/large).` : '';
  const where = mode === 'push' && target ? `pushed to origin as ${target}` : `saved locally as ${short}`;
  return {
    message: `[devops] autosaved session work (${what.join(', ')}); ${where}${failed ? ' (push failed)' : ''}.${left_out}`,
  };
}

module.exports = { autosave, THROTTLE_MS };
