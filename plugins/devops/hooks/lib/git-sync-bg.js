/**
 * @module git-sync-bg
 * @version 0.1.0
 * @description Fire-and-forget background git sync — shared by ss.git.sync
 *   (SessionStart) and stop.git.sync (Stop), consumed by prompt.git.sync
 *   (UserPromptSubmit).
 *
 *   WHY THIS EXISTS (issue: git-sync UI noise)
 *   The sync used to run as a recurring ten-minute cron that re-entered
 *   Claude with a "Silently run via Bash: node git-sync.js" prompt. A cron tick
 *   is a full turn: the Bash call renders inline, the model answers, and the
 *   stop/completion hooks have to be suppressed after the fact. Every ten
 *   minutes the transcript grew a turn that said nothing — the sync itself has
 *   no output unless a merge actually happened.
 *
 *   A mechanical `git fetch` + `git merge` needs no model in the loop. Only the
 *   rare ambiguous conflict does. So the sync is spawned DETACHED from a hook
 *   (no turn, no tool call, no card) and its result is written to a per-worktree
 *   file. The next UserPromptSubmit picks the file up and injects it as context
 *   — so the user sees something in chat exactly when there IS something:
 *   commits merged, or a conflict that needs semantic resolution.
 *
 *   Throttle + result files are keyed by WORKTREE, not by session: two Claude
 *   sessions on the same worktree must share one sync cadence, and a sync
 *   started by session A is equally relevant to session B.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/** Default gap between two background syncs for the same worktree. */
const THROTTLE_MS = 30 * 60 * 1000;

const PREFIX = 'dotclaude-devops-git-sync';

/** Stable short key for a worktree path (case-insensitive — Windows). */
function keyFor(cwd) {
  return crypto.createHash('sha1').update(String(cwd).toLowerCase()).digest('hex').slice(0, 12);
}

function throttleFile(cwd, tmpdir = os.tmpdir()) {
  return path.join(tmpdir, `${PREFIX}-throttle-${keyFor(cwd)}`);
}

function resultFile(cwd, tmpdir = os.tmpdir()) {
  return path.join(tmpdir, `${PREFIX}-result-${keyFor(cwd)}`);
}

/**
 * True when the last background sync for this worktree is older than the
 * throttle window. Touches the marker on success, so callers that get `true`
 * own the slot — two hooks firing back to back cannot double-spawn.
 *
 * `peek: true` answers the same question WITHOUT claiming. stop.git.sync runs
 * on every single turn end, so it peeks first and only pays for the three git
 * probes when the window is actually open — and only claims once those probes
 * confirm there is something to sync. Claiming before the probes would burn the
 * slot on a repo that is on main or has no remote, silencing the sync for the
 * next 30 minutes after a branch switch.
 *
 * @param {string} cwd
 * @param {{throttleMs?: number, tmpdir?: string, now?: number, peek?: boolean}} [opts]
 */
function claimSyncSlot(cwd, opts = {}) {
  const { throttleMs = THROTTLE_MS, tmpdir = os.tmpdir(), now = Date.now(), peek = false } = opts;
  const file = throttleFile(cwd, tmpdir);
  try {
    const stat = fs.statSync(file);
    if (now - stat.mtimeMs < throttleMs) return false;
  } catch {
    // No marker yet — first sync for this worktree.
  }
  if (peek) return true;
  try {
    fs.writeFileSync(file, String(now));
  } catch {
    return false; // cannot claim → do not spawn
  }
  return true;
}

/**
 * Classify raw git-sync output into something worth surfacing, or null.
 *
 * git-sync.js is already silent when nothing happened, so ANY output means a
 * merge landed (✓), needs semantic resolution (⚠), or failed (✗).
 *
 * @param {string|null|undefined} output
 * @returns {{kind: 'conflict'|'error'|'synced', text: string}|null}
 */
function classify(output) {
  if (typeof output !== 'string') return null;
  const text = output.trim();
  if (!text) return null;
  if (text.includes('⚠')) return { kind: 'conflict', text };
  if (text.includes('✗')) return { kind: 'error', text };
  if (text.includes('✓')) return { kind: 'synced', text };
  return null;
}

/**
 * The resolution procedure that used to live in the cron prompt. Only rendered
 * for the conflict case — a clean sync gets one line and nothing else.
 */
const CONFLICT_PROCEDURE = [
  'A background git sync hit conflicts it could not resolve mechanically. Resolve them now — do not just report them:',
  '(1) Extract the source branch from the ⚠ line (format: "⚠ <source> → <target>: …").',
  '(2) Re-run the merge: `git merge <source> --no-edit`.',
  '(3) For each conflicted file read the markers plus both sides: `git diff :1:<file> :2:<file>` (ours) and `git diff :1:<file> :3:<file>` (theirs).',
  '(4) Classify every hunk per `deep-knowledge/merge-safety.md` Step 3 (complementary, redundant, superseding, technical, design, delete-vs-modify).',
  '(5) Edit each file to the semantically correct merged result — keep both sides when complementary, pick the better option for technical choices.',
  '(6) Ask the user (AskUserQuestion) ONLY for mutually exclusive design decisions.',
  '(7) `git add <file>` each resolved file, then `git commit --no-edit`.',
  '(8) Verify the merged files for logical consistency (e.g. changed signatures with stale callers).',
];

/**
 * Render the context lines injected into the next user turn.
 * Deliberately asymmetric: a clean sync is one informational line the assistant
 * may mention in passing; a conflict is an instruction it must act on.
 *
 * @param {{kind: string, text: string}} result
 * @returns {string[]}
 */
function renderContext(result) {
  if (!result) return [];
  if (result.kind === 'conflict') {
    return [result.text, '', ...CONFLICT_PROCEDURE];
  }
  if (result.kind === 'error') {
    return [result.text, '', 'The background git sync failed. Tell the user what failed; do not retry silently.'];
  }
  return [result.text, '', 'Background git sync — informational only. Do not act on it, do not open a section for it, mention it in one clause at most.'];
}

/**
 * Read and consume the pending result for this worktree.
 * Returns null when there is nothing pending.
 *
 * @param {string} cwd
 * @param {{tmpdir?: string}} [opts]
 */
function takeResult(cwd, opts = {}) {
  const file = resultFile(cwd, opts.tmpdir);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try { fs.unlinkSync(file); } catch { /* consumed anyway */ }
  return classify(raw);
}

/**
 * Spawn scripts/git-sync.js detached. Returns true when the spawn was issued.
 *
 * The child writes its own result file (DEVOPS_GIT_SYNC_RESULT_FILE) atomically
 * and only when it has something to report — so a half-finished sync can never
 * be read as a finished one, and a silent sync leaves no file behind.
 *
 * @param {string} cwd
 * @param {{tmpdir?: string, spawn?: Function, scriptPath?: string}} [opts]
 */
function spawnSync_(cwd, opts = {}) {
  const spawn = opts.spawn || require('child_process').spawn;
  const script = opts.scriptPath || path.resolve(__dirname, '../../scripts/git-sync.js');
  const out = resultFile(cwd, opts.tmpdir);

  // Drop a stale result from an earlier run — the fresh sync is authoritative.
  try { fs.unlinkSync(out); } catch { /* nothing to clear */ }

  try {
    const child = spawn(process.execPath, [script], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, DEVOPS_GIT_SYNC_RESULT_FILE: out },
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  THROTTLE_MS,
  CONFLICT_PROCEDURE,
  keyFor,
  throttleFile,
  resultFile,
  claimSyncSlot,
  classify,
  renderContext,
  takeResult,
  startBackgroundSync: spawnSync_,
};
