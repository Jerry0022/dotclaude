'use strict';
/**
 * @lib graphify-metrics
 * @version 0.1.0
 * @plugin devops
 * @description Append-only usage telemetry for the graphify enforcement chain.
 *   Audit finding: 634 graphify mentions across session transcripts but only 5
 *   real `graphify query` executions (~0.8%) — and zero telemetry existed to
 *   even measure that. This lib gives the enforcement chain a single,
 *   fail-silent event sink so query-adoption can be measured going forward.
 *   Writes one JSON line per event to `~/.claude/graphify-metrics.jsonl`
 *   (override via `opts.path` — tests MUST inject a temp path, never the real
 *   home dir). Every write is wrapped so a metrics failure can NEVER break the
 *   hook that called it — record() never throws.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_METRICS_PATH = path.join(os.homedir(), '.claude', 'graphify-metrics.jsonl');

// Growth cap: once the file exceeds this size, keep only the newest half of
// lines on the next write. Simple truncate-rewrite, not a rotating log —
// good enough for a diagnostic stream nobody rotates by hand.
const MAX_BYTES = 2 * 1024 * 1024;

function metricsPath(opts = {}) {
  return opts.path || DEFAULT_METRICS_PATH;
}

/** Keep only the newest half of lines if `file` is over the size cap. Fail-silent. */
function capIfNeeded(file) {
  try {
    const st = fs.statSync(file);
    if (st.size <= MAX_BYTES) return;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const kept = lines.slice(Math.floor(lines.length / 2));
    fs.writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '');
  } catch { /* never break the caller over a cap failure */ }
}

/**
 * Append one telemetry event. `extra` is merged into the record (event-
 * specific fields, e.g. `{ source: 'value_moment' }` or `{ newerCount: 3 }`).
 * `opts.path` overrides the metrics file (tests only). `opts.cwd`/`opts.sid`
 * populate `project`/`sid`; both default sensibly. Never throws — a metrics
 * failure (unwritable path, full disk, etc.) is swallowed so it can never
 * break the hook that is recording the event.
 */
function record(event, extra = {}, opts = {}) {
  try {
    const file = metricsPath(opts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const entry = Object.assign(
      {
        ts: new Date().toISOString(),
        event,
        project: opts.cwd || process.cwd(),
        sid: opts.sid || 'nosid',
      },
      extra
    );
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    capIfNeeded(file);
  } catch { /* fail-silent — telemetry must never break a hook */ }
}

module.exports = {
  DEFAULT_METRICS_PATH,
  MAX_BYTES,
  metricsPath,
  record,
};
