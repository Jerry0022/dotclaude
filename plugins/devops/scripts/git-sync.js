#!/usr/bin/env node
/**
 * @script git-sync
 * @version 0.4.0
 * @plugin devops
 * @description Core git sync logic — fetch remote, merge parent chain into
 *   current branch. Supports branch hierarchy (feat/auth/login merges
 *   main → feat → feat/auth). Trivial conflicts are resolved automatically.
 *   Ambiguous conflicts are aborted and reported for AI-based semantic
 *   resolution (see deep-knowledge/merge-safety.md).
 *   Standalone: called by prompt.git.sync hook and session-start cron.
 */

const { execFileSync } = require('child_process');
const { existsSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const cwd = process.cwd();

// argv-form + windowsHide, NEVER a shell string: this script runs as a DETACHED,
// console-less child (git-sync-bg.js). From such a parent every execSync string
// goes through a fresh cmd.exe that cannot inherit a console, and Windows
// Terminal's default-terminal delegation surfaces each one as a visible,
// focus-stealing window — one per git call, measured on this machine (same
// mechanism as documented in hooks/lib/graphify-state.js spawnBgRunner).
function git(args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

// Only run in a git repo
if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') {
  process.exit(0);
}

const remotes = (git(['remote']) || '').split('\n').filter(Boolean);
if (!remotes.length) process.exit(0);
// A fork checkout has both `origin` and `upstream`; picking the first line
// alphabetically would sync a branch against somebody else's default branch.
const origin = remotes.includes('origin') ? 'origin' : remotes[0];

// The default branch is asked for, not assumed. A hardcoded 'main' makes the
// whole sync a silent no-op in a `master` repo — the same class of quiet
// nothing-happens this version exists to remove.
const MAIN = (() => {
  const head = git(['symbolic-ref', '--quiet', '--short', `refs/remotes/${origin}/HEAD`]);
  const candidates = [];
  // origin/HEAD is a local symlink written at clone time. It happily keeps
  // pointing at a branch that has since been renamed or deleted, so it is a
  // hint to be verified, not an answer.
  if (head && head.startsWith(`${origin}/`)) candidates.push(head.slice(origin.length + 1));
  candidates.push('main', 'master');
  for (const candidate of candidates) {
    if (git(['rev-parse', '--verify', '--quiet', `refs/remotes/${origin}/${candidate}`])) return candidate;
  }
  return 'main';
})();

// Detached HEAD → `rev-parse --abbrev-ref HEAD` answers the literal "HEAD",
// which is not MAIN and used to sail straight through. Merging onto a detached
// HEAD writes a commit nothing points at (lost at the next checkout) and
// rewrites the working tree of someone who is inspecting an old commit. The
// worktrees here sit detached between tasks, so this is the common state, not
// an exotic one.
const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
if (!branch || branch === MAIN) process.exit(0);

// An unfinished merge/rebase/cherry-pick/revert/bisect owns the index. A merge
// attempted on top of one fails without conflicts of its own, and the recovery
// path below would then pick up THAT operation's conflicted files, rewrite them
// and commit them — turning a background convenience into data loss. Wait.
const gitDir = git(['rev-parse', '--absolute-git-dir']);
if (!gitDir) process.exit(0);

/**
 * git, with the repo's commit hooks switched off.
 *
 * Deliberately `core.hooksPath` rather than `--no-verify`: `git merge` only
 * learned `--no-verify` in 2.36 (Apr 2022), and on an older git — Ubuntu 20.04
 * ships 2.25, Debian bullseye 2.30 — the flag is an "unknown option" that
 * fails the merge, lands in the no-conflicted-files branch, and reports
 * `✗ merge refused` every window forever. Pointing hooksPath at a directory
 * that cannot exist works back to 2.9 and covers `pre-merge-commit` too.
 */
const NO_HOOKS = ['-c', `core.hooksPath=${join(gitDir, 'devops-git-sync-no-hooks')}`];
function gitNoHooks(args) {
  return git([...NO_HOOKS, ...args]);
}

const IN_PROGRESS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply'];

/**
 * True while some other operation owns the index.
 *
 * The marker files alone are only a proxy. `git stash pop` — the everyday case
 * — leaves conflicts with NO marker at all, and so do `merge --squash`,
 * `checkout -m` and `revert -n`. The invariant that actually matters is
 * "the index holds unmerged entries", so ask for that directly and keep the
 * markers for the states that have a clean index (a paused rebase, a bisect).
 */
function repoBusy() {
  if (IN_PROGRESS.some(marker => existsSync(join(gitDir, marker)))) return true;
  const unmerged = git(['ls-files', '--unmerged']);
  return unmerged === null || unmerged !== '';
}

/**
 * True while /ship owns this worktree.
 *
 * The spawning hooks check this too, but they check it at spawn time — and the
 * dangerous child is the one spawned by the Stop just BEFORE the user types
 * /ship: its gates have already passed and its merge would land inside the
 * pipeline's rebase. Asking again here, immediately before the index is
 * written, closes that window.
 */
function shipInFlight() {
  try {
    return require('../hooks/lib/ship-sentinel').isActive(cwd);
  } catch {
    // Fails OPEN, unlike repoBusy() which fails closed — and the asymmetry is
    // deliberate. A failed repo probe means "I cannot see the state", and
    // writing the index blind is unsafe. A require() throw means the helper is
    // not installed: a static packaging condition, not an unknown state.
    // Failing closed here would let a partial plugin cache silence the sync in
    // every repo, permanently and invisibly.
    return false;
  }
}

if (repoBusy() || shipInFlight()) process.exit(0);

// Ensure diff3 is set for meaningful conflict markers
const conflictStyle = git(['config', '--get', 'merge.conflictstyle']);
if (conflictStyle !== 'diff3' && conflictStyle !== 'zdiff3') {
  git(['config', 'merge.conflictstyle', 'diff3']);
}

// Build parent chain from branch name hierarchy.
// For "feat/auth/login" → [main, feat, feat/auth]
function getParentChain(branchName) {
  const parts = branchName.split('/');
  const parents = [MAIN];
  for (let i = 1; i < parts.length; i++) {
    parents.push(parts.slice(0, i).join('/'));
  }
  return parents;
}

/**
 * Parse conflict markers from file content (diff3 format).
 * Returns array of { ours, base, theirs, startLine } or null if no markers found.
 */
function parseConflicts(content) {
  const lines = content.split('\n');
  const conflicts = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const startLine = i + 1;
      const ours = [];
      const base = [];
      const theirs = [];
      let section = 'ours';
      i++;

      while (i < lines.length) {
        if (lines[i].startsWith('|||||||')) {
          section = 'base';
          i++;
          continue;
        }
        if (lines[i].startsWith('=======')) {
          section = 'theirs';
          i++;
          continue;
        }
        if (lines[i].startsWith('>>>>>>>')) {
          conflicts.push({
            ours: ours.join('\n'),
            base: base.join('\n'),
            theirs: theirs.join('\n'),
            startLine,
          });
          i++;
          break;
        }
        if (section === 'ours') ours.push(lines[i]);
        else if (section === 'base') base.push(lines[i]);
        else theirs.push(lines[i]);
        i++;
      }
    } else {
      i++;
    }
  }

  return conflicts.length > 0 ? conflicts : null;
}

/**
 * Determine if a conflict is trivially resolvable without semantic analysis.
 * Returns the resolved content string, or null if the conflict needs Claude.
 */
function tryTrivialResolve(conflict) {
  const { ours, base, theirs } = conflict;

  // One side unchanged from base → take the other side's change
  if (ours === base) return theirs;
  if (theirs === base) return ours;

  // Both sides made identical changes → take either
  if (ours === theirs) return ours;

  // Whitespace-only difference on one side
  if (ours.replace(/\s+/g, '') === base.replace(/\s+/g, '')) return theirs;
  if (theirs.replace(/\s+/g, '') === base.replace(/\s+/g, '')) return ours;

  // Not trivially resolvable
  return null;
}

/**
 * Attempt to resolve all conflicts in a file.
 * Returns { resolved: true, content } or { resolved: false, ambiguousCount, file }.
 */
function resolveFile(filePath) {
  const fullPath = join(cwd, filePath);
  let content;
  try {
    content = readFileSync(fullPath, 'utf8');
  } catch {
    return { resolved: false, ambiguousCount: 1, file: filePath };
  }

  const conflicts = parseConflicts(content);
  if (!conflicts) return { resolved: true, content };

  let ambiguousCount = 0;
  let result = content;

  // Process conflicts in reverse order to preserve line positions
  for (let i = conflicts.length - 1; i >= 0; i--) {
    const conflict = conflicts[i];
    const resolution = tryTrivialResolve(conflict);

    if (resolution !== null) {
      // Build the full conflict block regex for this specific conflict
      const lines = result.split('\n');
      let blockStart = -1;
      let blockEnd = -1;
      let currentConflictIdx = 0;

      for (let j = 0; j < lines.length; j++) {
        if (lines[j].startsWith('<<<<<<<')) {
          if (currentConflictIdx === i) {
            blockStart = j;
          }
          currentConflictIdx++;
        }
        if (blockStart >= 0 && lines[j].startsWith('>>>>>>>')) {
          blockEnd = j;
          break;
        }
      }

      if (blockStart >= 0 && blockEnd >= 0) {
        lines.splice(blockStart, blockEnd - blockStart + 1, ...resolution.split('\n'));
        result = lines.join('\n');
      }
    } else {
      ambiguousCount++;
    }
  }

  if (ambiguousCount > 0) {
    return { resolved: false, ambiguousCount, file: filePath };
  }

  writeFileSync(fullPath, result, 'utf8');
  git(['add', '--', filePath]);
  return { resolved: true, content: result };
}

/**
 * Uncommitted paths that the incoming merge would also touch.
 *
 * A background merge must never fight the user's work in progress. git refuses
 * such a merge anyway ("Your local changes to the following files would be
 * overwritten by merge"), but it refuses BEFORE producing any conflicted file
 * — landing in the same no-conflicted-files branch as a genuine failure, where
 * it is indistinguishable from one. Detecting the overlap up front keeps that
 * case silent: the tree is dirty right now, the next sync window finds the same
 * commits and merges them once the work is committed.
 */
function dirtyOverlap(source) {
  // Three plain path lists — worktree-vs-index, index-vs-HEAD, and untracked.
  // Deliberately NOT `status --porcelain`: its "XY path" columns start with a
  // space for unstaged changes, and git() trims its output, so any fixed-offset
  // parse of it silently reads the path one character short.
  //
  // Untracked files count: a merge that ADDS a file which already exists
  // untracked is refused by git without producing a single conflicted file —
  // the one shape that reaches the "merge refused" branch and would then repeat
  // its ✗ every thirty minutes until the user happens to delete the file.
  const probes = [
    git(['diff', '--name-only']),
    git(['diff', '--name-only', '--cached']),
    git(['ls-files', '--others', '--exclude-standard']),
  ];
  // A probe that THREW (null) is not the same as one that found nothing (''),
  // and "unknown" must read as "busy, not now" rather than "clean" — a guard
  // that fails open is not a guard. In practice the case this catches is the
  // 15s timeout above (a slow or network-mounted repo), NOT a contended
  // index.lock: `git diff` skips its opportunistic index refresh when the lock
  // is held and still exits 0.
  if (probes.some(p => p === null)) return ['<unreadable worktree state>'];

  const dirty = new Set(probes.flatMap(p => p.split('\n')).filter(Boolean));
  if (!dirty.size) return [];

  // --no-renames so a rename lists BOTH paths: with rename detection on, git
  // prints only the destination, and a dirty copy of the *old* path would slip
  // past the guard straight into a refused merge.
  // Also null when the two sides share no merge base (an orphan branch) — a
  // merge there would be a surprise, so treating it as "not now" is right.
  const incoming = git(['diff', '--name-only', '--no-renames', `HEAD...${source}`]);
  if (incoming === null) return ['<unreadable incoming diff>'];
  return incoming.split('\n').filter(Boolean).filter(f => dirty.has(f));
}

// Try merging source into HEAD. Resolve trivial conflicts automatically,
// warn only for genuinely ambiguous conflicts that need semantic resolution.
// See deep-knowledge/merge-safety.md for the full resolution protocol.
function tryMerge(source) {
  const behind = git(['rev-list', '--count', `HEAD..${source}`]);
  if (!behind || parseInt(behind) === 0) return null; // already up to date

  const count = parseInt(behind);

  // Work in progress on a file the merge would rewrite → not now, and silently.
  if (dirtyOverlap(source).length > 0) return null;

  // The gates at the top of this file ran before a fetch per parent, and a
  // fetch takes seconds. A /ship or a rebase started in that window would be
  // invisible to them, so ask again with the index about to be written.
  if (repoBusy() || shipInFlight()) return null;

  // Both git calls that write run with hooks disabled: this process is
  // detached and has no console, so a repo hook that prompts cannot be
  // answered, and one that rejects — a commitlint `commit-msg` refusing git's
  // auto-generated "Merge remote-tracking branch …" subject is the obvious
  // case in a repo with this plugin's own conventions — would turn every clean
  // sync into a ✗ repeating for as long as main stays ahead. Hook policy
  // belongs to the commits the user makes, not to a background fast-forward of
  // their own default branch.
  if (gitNoHooks(['merge', source, '--no-edit', '--quiet']) !== null) {
    return { source, commits: count };
  }

  // Merge conflicted — try resolving trivial conflicts
  const conflictOutput = git(['diff', '--name-only', '--diff-filter=U']);
  const files = conflictOutput ? conflictOutput.split('\n').filter(Boolean) : [];

  if (files.length === 0) {
    // git refused the merge without leaving a single conflicted file. That is
    // a FAILURE, not a conflict — reporting it as ⚠ used to hand the assistant
    // the full semantic-resolution procedure for an empty file list.
    git(['merge', '--abort']);
    // Same check as the other two abort sites: an abort that did not unwind
    // leaves the worktree mid-merge, which the quiescence gate then reads as
    // "busy" and silences every future sync in this worktree.
    return {
      source,
      commits: count,
      failed: true,
      reason: existsSync(join(gitDir, 'MERGE_HEAD'))
        ? 'merge refused with no conflicted files, and the worktree is still mid-merge — run `git merge --abort`'
        : 'merge refused, no conflicted files',
    };
  }

  let totalAmbiguous = 0;
  const ambiguousFiles = [];

  for (const file of files) {
    const result = resolveFile(file);
    if (!result.resolved) {
      totalAmbiguous += result.ambiguousCount;
      ambiguousFiles.push(file);
    }
  }

  if (totalAmbiguous > 0) {
    // Some conflicts couldn't be resolved — abort and warn
    git(['merge', '--abort']);

    // Verify the abort actually unwound the merge. Deliberately NOT
    // `status --porcelain`: that reports untracked files and any unrelated
    // work in progress, so a single scratch file next to a real conflict used
    // to downgrade the ⚠ to ✗ — and ✗ is classified as an error, which means
    // the conflict procedure never reached the assistant for the one case this
    // whole feature exists to handle.
    if (existsSync(join(gitDir, 'MERGE_HEAD'))) {
      return { source, commits: count, failed: true, reason: 'merge --abort did not unwind the merge' };
    }

    return {
      source,
      commits: count,
      conflict: true,
      files: ambiguousFiles,
      partialResolve: files.length - ambiguousFiles.length,
    };
  }

  // All conflicts resolved — complete the merge. The commit is checked, not
  // assumed: a consumer repo's pre-commit hook runs here too, in a detached,
  // console-less process, and a hook that fails (or blocks on a prompt until
  // the 15s timeout) leaves MERGE_HEAD in place. Reporting ✓ then would hand
  // the user's next `git commit` a merge commit they never made.
  if (gitNoHooks(['commit', '--no-edit']) === null || existsSync(join(gitDir, 'MERGE_HEAD'))) {
    // Unwind before giving up. Returning with MERGE_HEAD still in place would
    // leave the worktree mid-merge, and the quiescence gate at the top of this
    // file would then silence every future sync in it — the failure path
    // wedging the whole feature shut, in the one place nobody looks.
    git(['merge', '--abort']);
    const stuck = existsSync(join(gitDir, 'MERGE_HEAD'));
    return {
      source,
      commits: count,
      failed: true,
      reason: stuck
        ? 'conflicts resolved but the merge commit failed — the worktree is still mid-merge, run `git merge --abort`'
        : 'conflicts resolved but the merge commit failed — the merge was rolled back',
    };
  }
  return { source, commits: count, autoResolved: files.length };
}

// Fetch each parent of this branch into its REMOTE-TRACKING ref, and merge
// from that ref — never from the local branch.
//
// v0.3.x merged the local `main` and kept it current with `git fetch origin
// main:main`. git refuses that fetch whenever `main` is checked out in ANY
// worktree:
//   fatal: refusing to fetch into branch 'refs/heads/main' checked out at '...'
// which is exactly the standard layout here — primary worktree parked on main,
// feature work in linked worktrees. git() swallows the error, so the sync went
// on to compare HEAD against a local `main` frozen at whatever was last pulled
// by hand, `rev-list --count HEAD..main` answered 0, and the sync stayed silent
// for weeks while origin/main moved. refs/remotes/<origin>/<x> is never checked
// out and can therefore always be updated.
const sources = [];
for (const p of getParentChain(branch)) {
  const tracking = `refs/remotes/${origin}/${p}`;
  git(['fetch', origin, `+refs/heads/${p}:${tracking}`, '--quiet']);
  // Skips parents that do not exist upstream (e.g. the "claude" segment of
  // claude/some-branch). A failed fetch with a tracking ref left from an
  // earlier run is fine: those commits are real, merging them is the job.
  if (git(['rev-parse', '--verify', '--quiet', tracking]) === null) continue;
  sources.push(`${origin}/${p}`);
}

if (!sources.length) process.exit(0);

// Best effort, never load-bearing: keep the local main ref in step for repos
// where nothing has it checked out. Fails silently in the layout above.
git(['fetch', origin, `${MAIN}:${MAIN}`, '--quiet']);

// Merge each parent into current branch (root → closest parent)
const messages = [];
for (const parent of sources) {
  const result = tryMerge(parent);
  if (!result) continue;

  if (result.failed) {
    messages.push(`✗ ${parent} → ${branch}: ${result.reason || 'merge failed (unknown error)'}`);
  } else if (result.conflict) {
    const partialNote = result.partialResolve
      ? ` (${result.partialResolve} conflict(s) auto-resolved)`
      : '';
    messages.push(
      `⚠ ${parent} → ${branch}: ${result.files.length} file(s) with ambiguous conflicts — ` +
      `merge aborted${partialNote}. Resolution required:\n` +
      `  ${result.files.join(', ')}`
    );
  } else if (result.autoResolved) {
    messages.push(
      `✓ ${parent} → ${branch}: ${result.commits} commit(s), ` +
      `${result.autoResolved} conflict(s) auto-resolved`
    );
  } else {
    messages.push(`✓ ${parent} → ${branch}: ${result.commits} commit(s)`);
  }
}

if (messages.length) {
  const line = `[git-sync] ${messages.join(' | ')}\n`;

  // Background mode (hooks/lib/git-sync-bg.js): the caller detached this process
  // and is not reading stdout — it polls a result file on the next user turn.
  // Write it atomically (tmp + rename) so a mid-sync read can never see a
  // partial line, and write it ONLY when there is something to report: the
  // absence of the file is what "nothing happened, stay silent" means.
  const resultFile = process.env.DEVOPS_GIT_SYNC_RESULT_FILE;
  if (resultFile) {
    try {
      const tmp = `${resultFile}.tmp`;
      writeFileSync(tmp, line, 'utf8');
      require('fs').renameSync(tmp, resultFile);
    } catch {
      // Result file unwritable — fall through to stdout so the output is not lost
      process.stdout.write(line);
    }
  } else {
    process.stdout.write(line);
  }
}
