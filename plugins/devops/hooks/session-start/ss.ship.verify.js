#!/usr/bin/env node
/**
 * @hook ss.ship.verify
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Surface results from the post-merge watcher (post-ship CI +
 *   optional deploy verify). Reads <cwd>/.claude/.ship-watcher/*.json and:
 *
 *     - reports completed runs that have not yet been acknowledged
 *     - flags watcher state files older than 24h as stale (auto-acknowledged)
 *     - mentions in-flight watchers ("ship verify still running")
 *
 *   Acknowledged entries are marked in-place (no deletion) so the user can
 *   re-inspect history with `gh run view <id>`.
 *
 *   Silent when there are no watcher files at all.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const watcherDir = path.join(cwd, '.claude', '.ship-watcher');
const STALE_MS = 24 * 60 * 60 * 1000;

if (!fs.existsSync(watcherDir)) process.exit(0);

let entries;
try {
  entries = fs.readdirSync(watcherDir).filter((f) => f.endsWith('.json'));
} catch {
  process.exit(0);
}
if (entries.length === 0) process.exit(0);

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

  const startedMs = data.startedAt ? new Date(data.startedAt).getTime() : 0;
  const age = Date.now() - startedMs;

  if (data.status === 'watching') {
    if (age > STALE_MS) {
      // Mark stale-acknowledged so it does not nag forever
      data.acknowledged = true;
      data.staleAt = new Date().toISOString();
      try { fs.writeFileSync(full, JSON.stringify(data, null, 2)); } catch {}
      continue;
    }
    inflight.push(data);
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

for (const { data } of reports) {
  const prRef = data.pr ? `PR #${data.pr}` : `commit ${data.mergeSha?.slice(0, 7) || '?'}`;
  const icon = data.overall === 'success' ? '✓' : (data.overall === 'timeout' ? '⏱' : '✗');
  out.push(`${icon} **Ship verify — ${prRef} on \`${data.base}\`**`);

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
  } else if (data.hasVerifyConfig === false) {
    // not configured — no line needed
  }

  out.push('');
}

for (const data of inflight) {
  const prRef = data.pr ? `PR #${data.pr}` : `commit ${data.mergeSha?.slice(0, 7) || '?'}`;
  const mins = Math.round((Date.now() - new Date(data.startedAt).getTime()) / 60_000);
  out.push(`◷ **Ship verify still running** — ${prRef} on \`${data.base}\` (${mins}m elapsed)`);
  if (data.ci?.runUrl) out.push(`  - Run: ${data.ci.runUrl}`);
  out.push('');
}

// Mark surfaced reports as acknowledged in-place so they don't nag next session.
// History stays on disk for `gh run view` reference.
for (const { file, data } of reports) {
  data.acknowledged = true;
  data.acknowledgedAt = new Date().toISOString();
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {}
}

process.stdout.write(out.join('\n') + '\n');
process.exit(0);
