#!/usr/bin/env node
/**
 * @hook ss.ship.verify
 * @version 0.2.0
 * @event SessionStart
 * @plugin devops
 * @description Surface results from the post-merge watcher (post-ship CI +
 *   optional deploy verify). Reads <cwd>/.claude/.ship-watcher/*.json and:
 *
 *     - reports completed runs that have not yet been acknowledged
 *     - resolves ABANDONED watchers (process died without writing a terminal
 *       state) by reconciling against GitHub, reports them once, and writes a
 *       terminal state so they can never nag again
 *     - mentions in-flight watchers ("ship verify still running")
 *
 *   Acknowledged entries are marked in-place (no deletion) so the user can
 *   re-inspect history with `gh run view <id>`.
 *
 *   Silent when there are no watcher files at all.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

// The watcher is spawned detached (`Start-Process -WindowStyle Hidden` /
// `nohup`); a machine shutdown or a killed session ends it without running its
// own fatal handler, so `status: "watching"` is NOT self-limiting. These mirror
// post-merge-watcher.js's timing so "how long could it legitimately still be
// alive?" is answered from the watcher's real lifetime rather than a flat
// constant. Legacy entries predate `deadlineAt` and fall back to these.
const DETECT_WINDOW_MS = 5 * 60_000; // POLL_INITIAL_RUN_DETECT_MAX_MS
const DEFAULT_MAX_WAIT_MS = 1800 * 1_000; // --max-wait default
const DEFAULT_VERIFY_TIMEOUT_MS = 600 * 1_000; // verify timeout_seconds default
const GRACE_MS = 5 * 60_000;

const GH_TIMEOUT_MS = 15_000;
const GIT_TIMEOUT_MS = 5_000;

/**
 * Latest instant at which the watcher for `data` could still legitimately be
 * working. An explicit `deadlineAt` (written by post-merge-watcher >= 0.2.0)
 * wins; otherwise reconstruct it from the watcher's phases.
 *
 * @param {object} data parsed watcher state file
 * @returns {number|null} epoch ms, or null when `startedAt` is unusable
 */
function resolveDeadlineMs(data) {
  const started = data?.startedAt ? Date.parse(data.startedAt) : NaN;
  if (!Number.isFinite(started)) return null;

  const explicit = data.deadlineAt ? Date.parse(data.deadlineAt) : NaN;
  if (Number.isFinite(explicit)) return explicit;

  const declared = Number(data.maxWaitSec);
  const maxWaitMs = Number.isFinite(declared) && declared > 0 ? declared * 1_000 : DEFAULT_MAX_WAIT_MS;
  const verifyMs = data.hasVerifyConfig ? DEFAULT_VERIFY_TIMEOUT_MS : 0;
  return started + DETECT_WINDOW_MS + maxWaitMs + verifyMs + GRACE_MS;
}

/**
 * A `watching` entry whose watcher can no longer be alive. An entry with an
 * unusable `startedAt` counts as abandoned: an unjudgeable entry must resolve,
 * never linger.
 *
 * @param {object} data
 * @param {number} now epoch ms
 * @returns {boolean}
 */
function isAbandoned(data, now = Date.now()) {
  if (data?.status !== 'watching') return false;
  const deadline = resolveDeadlineMs(data);
  if (deadline === null) return true;
  return now > deadline;
}

/**
 * The workflow run belonging to this merge, restricted to the watcher's own
 * window. A run created after the deadline is a LATER event on the same commit
 * — in this repo the Release workflow fires on the bare `vX.Y.Z` tag that
 * `/promote` adds to the already-merged commit days afterwards — and must not
 * be reported as the ship's CI.
 *
 * @param {Array|null} runs `gh run list --json ...` output
 * @param {{ mergeSha: string, deadlineMs: number|null }} opts
 * @returns {object|null}
 */
function findRun(runs, { mergeSha, deadlineMs }) {
  if (!Array.isArray(runs) || !mergeSha) return null;
  return (
    runs.find((r) => {
      if (!r?.headSha) return false;
      if (r.headSha !== mergeSha && !r.headSha.startsWith(mergeSha)) return false;
      if (deadlineMs !== null && r.createdAt) {
        const created = Date.parse(r.createdAt);
        if (Number.isFinite(created) && created > deadlineMs) return false;
      }
      return true;
    }) || null
  );
}

/**
 * Turn an abandoned entry into a terminal one. Answers the counterfactual
 * "what would the watcher have concluded had it survived?" — never invents a
 * verdict it cannot support.
 *
 * `lookup.authoritative` is true only for the per-commit query. The
 * branch-scoped fallback misses tag-triggered runs entirely, so an empty
 * result there proves nothing and yields `inconclusive`, not `no-run`.
 *
 * @param {object} data
 * @param {{ runs: Array|null, authoritative: boolean }} lookup
 * @param {number} now epoch ms
 * @returns {object} new terminal state (input is not mutated)
 */
function reconcile(data, lookup, now = Date.now()) {
  const ts = new Date(now).toISOString();
  const next = { ...data, status: 'complete', finishedAt: ts, abandonedAt: ts };
  const run = findRun(lookup?.runs, { mergeSha: data.mergeSha, deadlineMs: resolveDeadlineMs(data) });

  if (run) {
    const finished = run.status === 'completed';
    const passed = finished && run.conclusion === 'success';
    next.ci = {
      status: finished ? (passed ? 'success' : 'failed') : 'watching',
      runId: run.databaseId ?? null,
      runUrl: run.url ?? null,
      workflowName: run.workflowName ?? null,
      conclusion: run.conclusion ?? null,
    };
    next.overall = finished ? (passed ? 'success' : 'failed') : 'inconclusive';
    next.resolution = finished ? (passed ? 'ci-passed' : 'ci-failed') : 'ci-unfinished';
  } else if (Array.isArray(lookup?.runs) && lookup.authoritative) {
    next.ci = {
      status: 'no-run',
      note: 'No GitHub Actions workflow triggered by this merge — repo may not have CI configured for push events.',
    };
    next.overall = 'success';
    next.resolution = 'no-run';
  } else {
    next.ci = data.ci || null;
    next.overall = 'inconclusive';
    next.resolution = 'unreconciled';
  }

  // A configured deploy probe that never ran is an unknown, not a pass — the
  // watcher only reaches Phase 2 after CI, and it died before that.
  if (next.overall === 'success' && data.hasVerifyConfig && !data.verify) {
    next.overall = 'inconclusive';
    next.resolution = 'verify-never-ran';
  }

  return next;
}

/** `PR #318` / `commit abc1234` label for an entry. */
function prRef(data) {
  return data.pr ? `PR #${data.pr}` : `commit ${data.mergeSha?.slice(0, 7) || '?'}`;
}

/**
 * Render one completed (or reconciled-abandoned) entry.
 *
 * @param {object} data
 * @returns {string[]} lines
 */
function renderReport(data) {
  const out = [];
  const icon = data.overall === 'success' ? '✓'
    : data.overall === 'timeout' ? '⏱'
      : data.overall === 'inconclusive' ? '⚠' : '✗';

  const suffix = data.abandonedAt
    ? (data.resolution === 'unreconciled'
      ? ' — watcher process died, result unknown'
      : ' — watcher process died, reconciled from GitHub')
    : '';
  out.push(`${icon} **Ship verify — ${prRef(data)} on \`${data.base}\`**${suffix}`);

  if (data.ci) {
    if (data.ci.status === 'success') {
      out.push(`  - CI (${data.ci.workflowName || 'workflow'}): passed`);
    } else if (data.ci.status === 'no-run') {
      out.push('  - CI: no workflow triggered (repo has no push-event CI)');
    } else {
      const linkPart = data.ci.runUrl ? ` — ${data.ci.runUrl}` : '';
      out.push(`  - CI (${data.ci.workflowName || 'workflow'}): **${data.ci.status}** (${data.ci.conclusion || 'no conclusion'})${linkPart}`);
    }
  }

  if (data.verify) {
    if (data.verify.status === 'success') {
      out.push(`  - Deploy verify (${data.verify.mode}): passed → ${data.verify.target}`);
    } else {
      out.push(`  - Deploy verify (${data.verify.mode}): **${data.verify.status}** after ${data.verify.attempts} attempt(s) — ${data.verify.lastError || 'no error detail'}`);
    }
  } else if (data.resolution === 'verify-never-ran') {
    out.push('  - Deploy verify: never ran (watcher died before the probe phase)');
  }

  if (data.resolution === 'unreconciled') {
    const hint = data.pr ? `gh pr checks ${data.pr}` : `gh run list --commit ${data.mergeSha}`;
    out.push(`  - Could not reach GitHub to reconcile — check manually: \`${hint}\``);
  }

  out.push('');
  return out;
}

/**
 * Render one watcher that is still inside its own window.
 *
 * @param {object} data
 * @param {number} now epoch ms
 * @returns {string[]} lines
 */
function renderInflight(data, now = Date.now()) {
  const out = [];
  const mins = Math.round((now - Date.parse(data.startedAt)) / 60_000);
  out.push(`◷ **Ship verify still running** — ${prRef(data)} on \`${data.base}\` (${mins}m elapsed)`);
  if (data.ci?.runUrl) out.push(`  - Run: ${data.ci.runUrl}`);
  out.push('');
  return out;
}

/**
 * Ask GitHub what actually happened on `mergeSha`. Per-commit is the only
 * authoritative query, and it needs a FULL sha (the API ignores abbreviations),
 * so expand the recorded short sha locally first.
 *
 * @param {{ cwd: string, mergeSha: string, base: string }} opts
 * @returns {{ runs: Array|null, authoritative: boolean }}
 */
function lookupRuns({ cwd, mergeSha, base }) {
  const exec = (cmd, args, timeout) =>
    execFileSync(cmd, args, { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  const fields = 'databaseId,headSha,status,conclusion,workflowName,url,createdAt';

  let fullSha = null;
  try {
    const resolved = exec('git', ['rev-parse', `${mergeSha}^{commit}`], GIT_TIMEOUT_MS);
    if (/^[0-9a-f]{40}$/i.test(resolved)) fullSha = resolved;
  } catch { /* commit not fetched locally, or not a repo */ }

  if (fullSha) {
    try {
      return { runs: JSON.parse(exec('gh', ['run', 'list', '--commit', fullSha, '--limit', '20', '--json', fields], GH_TIMEOUT_MS)), authoritative: true };
    } catch { /* gh missing, unauthenticated, offline */ }
  }

  try {
    return { runs: JSON.parse(exec('gh', ['run', 'list', '--branch', base, '--limit', '50', '--json', fields], GH_TIMEOUT_MS)), authoritative: false };
  } catch {
    return { runs: null, authoritative: false };
  }
}

module.exports = {
  resolveDeadlineMs,
  isAbandoned,
  findRun,
  reconcile,
  renderReport,
  renderInflight,
  lookupRuns,
};

if (require.main === module) {
  require('../lib/plugin-guard');

  const cwd = process.cwd();
  const watcherDir = path.join(cwd, '.claude', '.ship-watcher');

  if (!fs.existsSync(watcherDir)) process.exit(0);

  let entries;
  try {
    entries = fs.readdirSync(watcherDir).filter((f) => f.endsWith('.json'));
  } catch {
    process.exit(0);
  }
  if (entries.length === 0) process.exit(0);

  const now = Date.now();
  const reports = [];
  const inflight = [];

  for (const file of entries) {
    const full = path.join(watcherDir, file);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
      continue;
    }

    if (data.status === 'watching') {
      if (!isAbandoned(data, now)) {
        inflight.push(data);
        continue;
      }
      // Resolve it: report the real outcome once, then never again. The old
      // code left `status: "watching"` here, so the entry re-entered this
      // branch every session and was never reported at all.
      let lookup = { runs: null, authoritative: false };
      try {
        lookup = lookupRuns({ cwd, mergeSha: data.mergeSha, base: data.base });
      } catch { /* stay inconclusive */ }
      reports.push({ file: full, data: reconcile(data, lookup, now) });
      continue;
    }

    if (data.status === 'complete' && !data.acknowledged) {
      reports.push({ file: full, data });
    }
  }

  if (reports.length === 0 && inflight.length === 0) process.exit(0);

  const out = [];
  out.push('Post-ship deploy verification — surface this summary AS-IS to the user as the FIRST action of this turn (Lang: user-preference):');
  out.push('');

  for (const { data } of reports) out.push(...renderReport(data));
  for (const data of inflight) out.push(...renderInflight(data, now));

  // Mark surfaced reports as acknowledged in-place so they don't nag next
  // session. History stays on disk for `gh run view` reference.
  for (const { file, data } of reports) {
    data.acknowledged = true;
    data.acknowledgedAt = new Date(now).toISOString();
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch { /* read-only dir */ }
  }

  process.stdout.write(out.join('\n') + '\n');
  process.exit(0);
}
