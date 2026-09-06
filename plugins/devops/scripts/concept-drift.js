#!/usr/bin/env node
/**
 * @script concept-drift
 * @version 0.1.0
 * @plugin devops
 * @description The reality check behind `/concept`'s implement gate: has the
 *   default branch moved under this concept while the user was iterating on it?
 *
 *   A concept session lives for hours or days. `main` keeps moving — other
 *   sessions, other PRs, other ships. When the user finally clicks "Mit Feedback
 *   implementieren", the plan they approved may reference a file that was
 *   renamed, a contract that changed, or work somebody already did. Implementing
 *   it verbatim then produces wrong, dead or duplicate code.
 *
 *   This script does NOT decide whether that matters. It produces the FACTS —
 *   which commits landed, which paths they touched, which of them intersect the
 *   paths the concept references — and Claude applies the force classes from
 *   `skills/concept/deep-knowledge/reality-check.md` to them. Splitting it that
 *   way is deliberate: the half that must be deterministic (git plumbing, and
 *   above all the fail-safe behaviour) is code, and the half that needs judgment
 *   stays with the model.
 *
 *   **Fail SAFE, never fail closed.** Every unresolvable condition — no repo, no
 *   remote, no default branch, detached HEAD, offline, slow fetch, shallow clone,
 *   a baseline SHA that a force-push erased, git missing from PATH — resolves to
 *   `verdict: "skip"` with `safe: true`, which means "implement, do not hold the
 *   user up". A network hiccup must never block an implement order. The one thing
 *   this script may never do is report drift it did not verify.
 *
 *   Modes:
 *     (default)   --state <abs> [--paths a,b] [--paths-file f] [--timeout 30]
 *                 Compare the recorded baseline against the current remote tip.
 *                 Prints one JSON object on stdout. Never writes the state file.
 *     --capture   --state <abs> [--sha <sha>]
 *                 Record the baseline. With no --sha, records the remote tip as
 *                 it is right now (concept open). With --sha, records exactly the
 *                 commit a check just examined — advancing the baseline past
 *                 drift the user has now decided on, so the same drift can never
 *                 force a second round.
 *
 *   Exit code is 0 for every outcome including a dead remote; only invalid
 *   arguments exit 2. A non-zero exit would surface as a failed Bash call and
 *   invite Claude to "fix" a perfectly normal offline repo.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULTS = {
  timeout: 30, // seconds, whole-script budget for network-touching git calls
  maxCommits: 50,
  maxPaths: 200,
};

function parseArgs(argv) {
  const out = { state: '', paths: [], pathsFile: '', sha: '', capture: false, ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (key === 'capture') { out.capture = true; continue; }
    const raw = argv[i + 1];
    if (raw === undefined || raw.startsWith('--')) continue;
    i++;
    if (key === 'state') out.state = raw;
    else if (key === 'sha') out.sha = raw;
    else if (key === 'paths-file') out.pathsFile = raw;
    else if (key === 'paths') out.paths = splitPaths(raw);
    // hasOwn, not `in` — `in` walks the prototype chain, so `--toString 5`
    // would set junk on the options object.
    else if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) out[key] = Number(raw);
  }
  return out;
}

function splitPaths(raw) {
  return String(raw)
    .split(/[,\n\r]+/)
    .map((p) => p.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean);
}

function validate(opts) {
  // Enforced, not merely described: a relative path resolved against the caller's
  // cwd is the exact defect `concept-watch.js` already had to fix, and this
  // script is invoked from whatever directory Claude happens to be in.
  if (!opts.state || !path.isAbsolute(opts.state)) {
    return 'state must be the ABSOLUTE path to concept-active.json';
  }
  if (!(opts.timeout > 0)) return 'timeout must be a positive number';
  if (opts.sha && !/^[0-9a-f]{7,40}$/i.test(opts.sha)) return 'sha must be a hex commit id';
  return null;
}

/** The project root is the state file's grandparent: `<root>/.claude/concept-active.json`. */
function repoRoot(statePath) {
  return path.dirname(path.dirname(statePath));
}

function readState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read-modify-write of the shared state file. Only ever ADDS the baseline keys —
 * `port`, `html_path`, `cron_id` and friends belong to the bridge and stay
 * untouched, because the watchers key their liveness decisions off them.
 */
function writeBaseline(statePath, fields) {
  const state = readState(statePath);
  if (!state) return false;
  const next = { ...state, ...fields };
  const tmp = `${statePath}.drift.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmp, statePath);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    return false;
  }
}

/**
 * Every git call in this script goes through here, and every one of them may
 * fail. `null` means "could not answer" and always routes to a safe skip —
 * callers must never treat it as "no drift found".
 */
function git(args, cwd, timeoutSec) {
  try {
    return execFileSync('git', args, {
      cwd,
      timeout: Math.max(1, Math.round(timeoutSec * 1000)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function isRepo(cwd, timeoutSec) {
  return git(['rev-parse', '--git-dir'], cwd, timeoutSec) !== null;
}

function hasOrigin(cwd, timeoutSec) {
  const remotes = git(['remote'], cwd, timeoutSec);
  return typeof remotes === 'string' && remotes.split(/\s+/).includes('origin');
}

/**
 * The remote's default branch, without assuming it is called `main`. Falls back
 * through the two conventional names before giving up — `origin/HEAD` is unset
 * in plenty of clones, and giving up there would disable the check for them.
 */
function detectDefaultBranch(cwd, timeoutSec) {
  const symbolic = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd, timeoutSec);
  if (symbolic && symbolic.startsWith('origin/')) return symbolic.slice('origin/'.length);
  for (const candidate of ['main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${candidate}`], cwd, timeoutSec)) {
      return candidate;
    }
  }
  return null;
}

/** A commit id that is not in the object store any more (force-push, shallow clone). */
function commitExists(sha, cwd, timeoutSec) {
  return git(['cat-file', '-e', `${sha}^{commit}`], cwd, timeoutSec) !== null;
}

function parseCommits(raw, limit) {
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => {
      const sep = line.indexOf(' ');
      const sha = sep === -1 ? line : line.slice(0, sep);
      const subject = sep === -1 ? '' : line.slice(sep + 1);
      return { sha: (sha || '').slice(0, 12), subject: subject || '' };
    });
}

/**
 * `--name-status` rather than `--name-only`, because a rename is the single most
 * common way a concept goes stale and `R` lines carry BOTH paths. Dropping the
 * old one would hide exactly the drift class this feature exists to catch.
 */
function parseChangedPaths(raw, limit) {
  if (!raw) return [];
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    const status = (parts[0] || '').charAt(0);
    for (const p of parts.slice(1)) {
      if (!p) continue;
      const norm = p.replace(/\\/g, '/');
      if (!out.some((e) => e.path === norm)) out.push({ path: norm, status: status || 'M' });
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/**
 * A referenced path matches a changed path when either contains the other as a
 * path prefix — so naming a directory in the concept catches changes to files
 * inside it, and naming a file catches a change to the directory entry itself.
 * Substring matching is deliberately NOT used: `hooks/a.js` must not match
 * `other/hooks/a.js.bak`.
 */
function intersect(changed, referenced) {
  const refs = referenced.map((r) => r.replace(/\/+$/, ''));
  const hits = [];
  for (const c of changed) {
    for (const r of refs) {
      if (!r) continue;
      if (c.path === r || c.path.startsWith(`${r}/`) || r.startsWith(`${c.path}/`)) {
        hits.push({ ...c, matched: r });
        break;
      }
    }
  }
  return hits;
}

function skip(reason, extra = {}) {
  return { verdict: 'skip', safe: true, reason, ...extra };
}

/**
 * @returns {{verdict:'skip'|'clear'|'candidates', safe:boolean, reason:string, ...}}
 *   `candidates` never means "force a round" — it means "here are the facts,
 *   apply the force classes". Only Claude decides that.
 */
function check(opts, deps = {}) {
  const run = deps.git || git;
  const cwd = deps.cwd || repoRoot(opts.state);
  const budget = opts.timeout;

  const state = readState(opts.state);
  if (!state) return skip('no-state');

  if (!(deps.isRepo || isRepo)(cwd, budget)) return skip('no-repo');
  if (!(deps.hasOrigin || hasOrigin)(cwd, budget)) return skip('no-remote');

  const branch = state.baseline_ref || (deps.detectDefaultBranch || detectDefaultBranch)(cwd, budget);
  if (!branch) return skip('no-default-branch');

  const baselineSha = typeof state.baseline_sha === 'string' ? state.baseline_sha : '';
  if (!baselineSha) return skip('no-baseline', { branch });

  // Network step. A failure here is NOT drift — the local tracking ref may be
  // days old, so a diff computed against it would be a lie in either direction.
  const fetched = run(['fetch', '--quiet', 'origin', branch], cwd, budget);
  if (fetched === null) return skip('fetch-failed', { branch });

  const headSha = run(['rev-parse', `refs/remotes/origin/${branch}`], cwd, budget);
  if (!headSha) return skip('no-remote-ref', { branch });

  const baseline = { ref: branch, sha: baselineSha };
  const head = { ref: `origin/${branch}`, sha: headSha.slice(0, 12) };

  if (headSha.startsWith(baselineSha) || baselineSha.startsWith(headSha)) {
    return { verdict: 'clear', safe: true, reason: 'unchanged', baseline, head, commits: [], changed: [], overlap: [], advanceTo: headSha };
  }

  // A baseline the object store no longer holds (force-push, shallow clone,
  // pruned) cannot be diffed against. Re-anchor and let this implement through.
  if (!(deps.commitExists || commitExists)(baselineSha, cwd, budget)) {
    return skip('baseline-gone', { baseline, head, advanceTo: headSha });
  }

  const range = `${baselineSha}..${headSha}`;
  const commits = parseCommits(run(['log', '--no-merges', '--format=%H %s', range], cwd, budget), opts.maxCommits);
  const changed = parseChangedPaths(run(['diff', '--name-status', range], cwd, budget), opts.maxPaths);

  if (!changed.length) {
    return { verdict: 'clear', safe: true, reason: 'no-file-changes', baseline, head, commits, changed: [], overlap: [], advanceTo: headSha };
  }

  const referenced = opts.paths;
  if (!referenced.length) {
    // No path list means no cheap pre-filter is possible. Hand over everything
    // and let Claude judge — under-reporting drift is the one failure mode this
    // script must not have.
    return { verdict: 'candidates', safe: true, reason: 'no-path-filter', baseline, head, commits, changed, overlap: [], referenced: [], advanceTo: headSha };
  }

  const overlap = intersect(changed, referenced);
  if (!overlap.length) {
    return { verdict: 'clear', safe: true, reason: 'no-overlap', baseline, head, commits, changed, overlap: [], referenced, advanceTo: headSha };
  }

  return { verdict: 'candidates', safe: true, reason: 'overlap', baseline, head, commits, changed, overlap, referenced, advanceTo: headSha };
}

/** `--capture`: record (or advance) the baseline. Never blocks, never throws. */
function capture(opts, deps = {}) {
  const run = deps.git || git;
  const cwd = deps.cwd || repoRoot(opts.state);
  const budget = opts.timeout;

  if (!readState(opts.state)) return { captured: false, reason: 'no-state' };
  if (!(deps.isRepo || isRepo)(cwd, budget)) return { captured: false, reason: 'no-repo' };
  if (!(deps.hasOrigin || hasOrigin)(cwd, budget)) return { captured: false, reason: 'no-remote' };

  const branch = (deps.detectDefaultBranch || detectDefaultBranch)(cwd, budget);
  if (!branch) return { captured: false, reason: 'no-default-branch' };

  let sha = opts.sha;
  if (!sha) {
    run(['fetch', '--quiet', 'origin', branch], cwd, budget);
    sha = run(['rev-parse', `refs/remotes/origin/${branch}`], cwd, budget);
  }
  if (!sha) return { captured: false, reason: 'no-remote-ref', branch };

  const ok = (deps.writeBaseline || writeBaseline)(opts.state, {
    baseline_ref: branch,
    baseline_sha: sha,
    baseline_captured_at: new Date().toISOString(),
  });
  return ok
    ? { captured: true, reason: 'ok', branch, sha: sha.slice(0, 12) }
    : { captured: false, reason: 'state-write-failed', branch };
}

module.exports = {
  parseArgs,
  validate,
  splitPaths,
  repoRoot,
  readState,
  writeBaseline,
  detectDefaultBranch,
  parseCommits,
  parseChangedPaths,
  intersect,
  check,
  capture,
  DEFAULTS,
};

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const err = validate(opts);
  if (err) {
    process.stderr.write(`concept-drift: ${err}\n`);
    process.stderr.write('usage: concept-drift.js --state <abs path> [--paths a,b] [--paths-file f] [--timeout 30]\n');
    process.stderr.write('       concept-drift.js --capture --state <abs path> [--sha <sha>]\n');
    process.exit(2);
  }
  if (opts.pathsFile) {
    try { opts.paths = opts.paths.concat(splitPaths(fs.readFileSync(opts.pathsFile, 'utf8'))); } catch { /* optional */ }
  }
  let result;
  try {
    result = opts.capture ? capture(opts) : check(opts);
  } catch (e) {
    // An internal error must degrade to "implement", never to a blocked user.
    result = opts.capture
      ? { captured: false, reason: 'internal-error', error: e && e.message }
      : skip('internal-error', { error: e && e.message });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
