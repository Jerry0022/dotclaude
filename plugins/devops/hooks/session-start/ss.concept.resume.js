#!/usr/bin/env node
/**
 * @hook ss.concept.resume
 * @version 0.2.0
 * @event SessionStart
 * @plugin devops
 * @description Recover an open concept session after a Claude restart.
 *   Reads `.claude/concept-active.json` (written by /devops-concept Step 3),
 *   probes the bridge server to confirm it is still running, and instructs
 *   Claude to re-arm the polling cron — and pick up any unprocessed
 *   submission immediately. Without this hook the polling cron (which is
 *   session-only) dies with the prior session and any pending submission
 *   silently rots in the bridge server until the user notices.
 *
 *   Trust model: `.claude/concept-active.json` is treated as a per-project
 *   state file, NOT as authenticated control input. We accept that anyone
 *   with write access to the project tree can author it, but we do NOT let
 *   `html_path` steer Claude at arbitrary paths — it must be a clean
 *   relative path under `docs/concepts/` and end in `.html`. The file is
 *   also gitignored so a malicious branch cannot smuggle one in via PR.
 *
 *   Multi-session caveat: this hook does not coordinate ownership across
 *   parallel Claude sessions on the same project. If two sessions are open,
 *   both will arm a polling cron and both may process the same submission;
 *   the bridge's optimistic /reset (409 on version mismatch) prevents data
 *   loss but cannot prevent duplicate Step 5 work. This is a known limit —
 *   the realistic case (one user, one active session per worktree) is
 *   the only one we optimize for.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const http = require('http');

const cwd = process.cwd();
const STATE_PATH = path.join(cwd, '.claude', 'concept-active.json');

// Age-out: if a state file is older than 24h and the server is gone,
// we just delete the orphan. Real concept sessions almost never run that long.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Validate the html_path field. Constraints:
 *   - relative (no drive letter, no leading / or \)
 *   - no traversal segments (`..`)
 *   - lives under `docs/concepts/`
 *   - ends in `.html`
 * The hook injects this string into stdout instructions that Claude will
 * act on, so we tighten the allowed shape to make sure a forged state
 * file cannot point Claude at arbitrary repository files.
 */
function isValidHtmlPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 256) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return false; // windows drive
  if (p.startsWith('/') || p.startsWith('\\')) return false; // absolute posix
  const norm = p.replace(/\\/g, '/');
  if (norm.split('/').includes('..')) return false; // traversal
  if (!norm.startsWith('docs/concepts/')) return false;
  if (!norm.endsWith('.html')) return false;
  return true;
}

function readState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.port !== 'number') return null;
    if (!Number.isInteger(obj.port) || obj.port < 1 || obj.port > 65535) return null;
    if (!isValidHtmlPath(obj.html_path)) return null;
    if (obj.slug !== undefined && typeof obj.slug !== 'string') return null;
    if (obj.slug && !/^[a-zA-Z0-9._-]{1,80}$/.test(obj.slug)) return null;
    return obj;
  } catch {
    return null;
  }
}

function deleteState() {
  try { fs.unlinkSync(STATE_PATH); } catch { /* already gone */ }
}

function isStale(state) {
  if (!state.started_at) return false;
  const t = Date.parse(state.started_at);
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) > STALE_AFTER_MS;
}

/**
 * GET http://localhost:{port}{pathname}, returns parsed JSON or null.
 * Short timeout — if the server is dead the connect should fail fast on
 * localhost and we don't want to block SessionStart on a slow probe.
 */
function probe(port, pathname, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: pathname, timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

(async () => {
  const state = readState();
  if (!state) process.exit(0);

  const heartbeat = await probe(state.port, '/heartbeat');
  if (!heartbeat) {
    // Server gone. If the file is also stale, prune it; otherwise leave it
    // alone — the user might be restarting the server in another terminal.
    if (isStale(state)) deleteState();
    process.exit(0);
  }

  // Server is alive. Check whether a submission is sitting unprocessed.
  // We must distinguish three states explicitly:
  //   - probe ok, pending: false → safe to wait on cron schedule
  //   - probe ok, pending: true  → process immediately
  //   - probe failed              → AMBIGUOUS, do NOT pretend it's false.
  //     Hiding "I don't know" as "no submission pending" is the worst
  //     failure mode for a waiting user. Tell Claude to fetch /decisions
  //     once now so the answer is resolved authoritatively.
  const pending = await probe(state.port, '/pending');
  let pendingState; // 'pending' | 'idle' | 'unknown'
  if (pending && typeof pending.pending === 'boolean') {
    pendingState = pending.pending ? 'pending' : 'idle';
  } else {
    pendingState = 'unknown';
  }

  const cronBody =
    `Silently run both steps for the concept bridge on port ${state.port}: ` +
    `(1) Heartbeat POST: Bash: curl -s -X POST http://localhost:${state.port}/heartbeat > /dev/null. ` +
    `(2) Pending check via /pending: Bash: curl -s http://localhost:${state.port}/pending | python -c "import sys,json; d=json.load(sys.stdin); print(\\'true\\' if d.get(\\'pending\\') else \\'false\\')". ` +
    `If exactly "false" → produce NO output (silent tick). ` +
    `If exactly "true" → curl -s http://localhost:${state.port}/decisions, parse JSON, note _version, process per devops-concept SKILL.md Step 5 (rewrite HTML, POST /reload, then conditionally POST /reset with the noted version). On 409 retry with the new version. Report the outcome to the user.`;

  const lines = [];
  lines.push(
    `An open /devops-concept session was found in this project ` +
    `(port ${state.port}, html_path ${state.html_path}, slug ${state.slug || '?'}). ` +
    `The bridge server is alive but the polling cron from the previous Claude session is gone (crons are session-only). ` +
    `Re-arm it now: call CronCreate with cron "* * * * *" (recurring: true) and prompt: '${cronBody}'.`
  );

  if (pendingState === 'pending') {
    lines.push(
      `IMMEDIATELY ALSO process the pending submission BEFORE waiting for the first cron tick: ` +
      `curl -s http://localhost:${state.port}/decisions, parse, then run devops-concept SKILL.md Step 5 ` +
      `(rewrite HTML at ${state.html_path}, POST /reload, conditional /reset with the captured _version). ` +
      `The user already submitted and is waiting — do not delay this on the cron schedule.`
    );
  } else if (pendingState === 'unknown') {
    lines.push(
      `The /pending probe was inconclusive (timeout, non-200, or malformed JSON). ` +
      `Do NOT assume idle. Fetch /decisions once now: curl -s http://localhost:${state.port}/decisions. ` +
      `If submitted=true, run Step 5 immediately (rewrite ${state.html_path}, /reload, conditional /reset). ` +
      `If submitted=false, just continue with the cron — the next tick will catch any later submission.`
    );
  } else {
    lines.push(
      `No submission is pending right now — just keeping the cron alive is enough. ` +
      `When the user submits, the next cron tick (≤60s) will pick it up automatically.`
    );
  }

  process.stdout.write(lines.join(' ') + '\n');
})();
