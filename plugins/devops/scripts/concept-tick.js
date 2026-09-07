#!/usr/bin/env node
/**
 * @script concept-tick
 * @version 0.1.0
 * @plugin devops
 * @description One tick of the concept bridge's backup cron, as a script instead
 *   of a 1128-character prompt.
 *
 *   Claude Code renders a cron's full prompt text as its card in the background
 *   tasks panel, so the old inline body — self-cleanup gate, heartbeat POST,
 *   `/pending` probe via `curl | python -c`, and the whole pending-branch
 *   procedure — made a single card fill the entire panel and hid every other
 *   background task. The cron prompt is now two sentences; everything it used to
 *   spell out inline happens here.
 *
 *   Nothing was dropped, only moved. The steps map 1:1 onto the numbered steps
 *   of `skills/concept/deep-knowledge/bridge-server.md` § step 3:
 *     (0) self-cleanup gate — state file missing / foreign port / concept HTML
 *         gone ⇒ POST /shutdown and tell Claude which cron to delete
 *     (1) heartbeat POST — keeps the page's connection indicator green
 *     (2) pending check via the deterministic `/pending` endpoint (never a
 *         substring match on `/decisions`: `json.dumps` emits `"submitted": true`
 *         WITH a space, so a substring test misses every submission)
 *
 *   Output contract — this is what makes the cron prompt short. stdout is
 *   Claude's instruction, and there is stdout ONLY when Claude must actually do
 *   something:
 *     - idle tick        → NOTHING on stdout. The cron tick costs no tokens.
 *     - cleanup needed   → the CronDelete instruction (only Claude has the tool)
 *     - submission ready → the full pending-branch procedure
 *
 *   Why not have the cron read a file per tick instead: a Read call every 60 s
 *   costs tokens on every idle tick, which is the common case by far. A Bash
 *   call that prints nothing costs nothing, and it replaces the TWO curl calls
 *   the old body already made — so this is strictly cheaper than what it
 *   replaces, not a new per-tick cost.
 *
 *   Exit code is 0 for every tick outcome, including an unreachable bridge:
 *   a non-zero exit would surface as a failed Bash call in the transcript on
 *   every tick of a dying bridge. Bridge liveness is owned by the pulser and
 *   the server-side `--html` watchdog, not by this script — with one
 *   edge-triggered exception (#348): after RELAUNCH_AFTER_FAILURES consecutive
 *   heartbeat misses the tick prints the relaunch instruction ONCE and then
 *   stays silent until the bridge answers again. Only invalid arguments exit 2.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const DEFAULTS = {
  timeout: 8, // seconds per request
};

function parseArgs(argv) {
  const out = { port: 0, state: '', ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (!key) continue;
    const raw = argv[i + 1];
    if (raw === undefined || raw.startsWith('--')) continue;
    i++;
    if (key === 'state') out[key] = raw;
    // hasOwn, not `in` — `in` walks the prototype chain, so `--toString 5`
    // would set junk on the options object.
    else if (Object.prototype.hasOwnProperty.call(DEFAULTS, key) || key === 'port') out[key] = Number(raw);
  }
  return out;
}

function validate(opts) {
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) return 'port must be 1-65535';
  // Enforced, not merely described: a relative path resolved against the cron
  // task's cwd is the exact defect `concept-watch.js` already had to fix.
  if (!opts.state || !path.isAbsolute(opts.state)) return 'state must be the ABSOLUTE path to concept-active.json';
  if (!(opts.timeout > 0)) return 'timeout must be a positive number';
  return null;
}

/**
 * Step (0), the read half. Does the concept on disk still belong to this cron?
 *
 * A transient read error is NOT a dead concept — EBUSY/EPERM during a state
 * rewrite on Windows or EMFILE under load would otherwise make one tick tear
 * down a live session. Only ENOENT and a parsed-but-wrong state file are
 * terminal, matching `concept-watch.js` § checkState.
 *
 * @returns {{cleanup:boolean, reason?:string, cronId?:string|null, stateReadable:boolean}}
 */
function inspectState(statePath, port, exists = fs.existsSync) {
  let raw;
  try {
    raw = fs.readFileSync(statePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { cleanup: true, reason: 'state file is gone', cronId: null, stateReadable: false };
    }
    return { cleanup: false, stateReadable: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A half-written file during a state rewrite is not a dead concept.
    return { cleanup: false, stateReadable: false };
  }
  if (!parsed || typeof parsed !== 'object') return { cleanup: false, stateReadable: false };

  const cronId = typeof parsed.cron_id === 'string' ? parsed.cron_id : null;

  // Numeric, so no `"port": 8883` spacing dependency and no 8883-vs-88831 slip.
  if (parsed.port !== port) {
    return { cleanup: true, reason: `state file now owns port ${parsed.port}, not ${port}`, cronId, stateReadable: true };
  }

  // The concept HTML is the source of truth for "is this session still real?".
  // `html_path` is relative to the project root, which is the state file's
  // grandparent (`<root>/.claude/concept-active.json`).
  const root = path.dirname(path.dirname(statePath));
  const html = typeof parsed.html_path === 'string' ? parsed.html_path : '';
  if (!html || !exists(path.join(root, html))) {
    return { cleanup: true, reason: `concept HTML ${html || '(unset)'} no longer exists`, cronId, stateReadable: true };
  }

  return { cleanup: false, stateReadable: true };
}

function request(port, pathname, method, timeoutSec) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method, timeout: timeoutSec * 1000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ ok: res.statusCode === 200, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, body: '' }); });
    req.on('error', () => resolve({ ok: false, body: '' }));
    req.end();
  });
}

// (#348) A bridge that dies WITHOUT a session restart — a crash, a manual
// kill, the server-side watchdog — has nobody to bring it back: the pulser
// only notices while its own session is alive, and this cron used to log the
// failure to stderr forever. So the tick relaunches, but edge-triggered: the
// consecutive-failure count and a one-shot marker live in the state file, the
// instruction is printed exactly once after RELAUNCH_AFTER_FAILURES misses,
// and the next successful heartbeat re-arms the edge. One transient miss
// (a slow /heartbeat under load) never fires it.
const RELAUNCH_AFTER_FAILURES = 2;

function readStateJson(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// Atomic where the platform allows it; a direct write is the fallback for the
// Windows EPERM-on-rename case (another process holds the file open).
function writeStateJson(statePath, obj) {
  const data = JSON.stringify(obj, null, 2);
  const tmp = `${statePath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, statePath);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* never existed */ }
    fs.writeFileSync(statePath, data);
  }
}

/**
 * Record one heartbeat outcome in the state file.
 * @returns {{relaunch:boolean, failures:number}} — `relaunch` is true on the
 *   ONE tick that crosses the threshold with no relaunch already requested.
 */
function noteHeartbeat(statePath, ok) {
  const state = readStateJson(statePath);
  if (!state) return { relaunch: false, failures: 0 };
  if (ok) {
    if (!state.tick_heartbeat_failures && !state.relaunch_requested_at) return { relaunch: false, failures: 0 };
    delete state.tick_heartbeat_failures;
    delete state.relaunch_requested_at;
    try { writeStateJson(statePath, state); } catch { /* next success retries */ }
    return { relaunch: false, failures: 0 };
  }
  const prior = Number.isInteger(state.tick_heartbeat_failures) ? state.tick_heartbeat_failures : 0;
  const failures = prior + 1;
  state.tick_heartbeat_failures = failures;
  let relaunch = false;
  if (failures >= RELAUNCH_AFTER_FAILURES && !state.relaunch_requested_at) {
    state.relaunch_requested_at = new Date().toISOString();
    relaunch = true;
  }
  // If the marker cannot be persisted, do not fire: without it every later
  // tick would fire again, which is the per-minute spam this design avoids.
  try { writeStateJson(statePath, state); } catch { return { relaunch: false, failures }; }
  return { relaunch, failures };
}

/**
 * The relaunch instruction (#348). Mirrors the SessionStart hook's dead-bridge
 * mandate: same port, --html, both watchers — the pieces a restart or a crash
 * takes away together.
 */
function relaunchInstruction(port, statePath, htmlPath) {
  const root = path.dirname(path.dirname(statePath));
  const server = path.join(__dirname, 'concept-server.py');
  const watch = path.join(__dirname, 'concept-watch.js');
  return (
    `The concept bridge on port ${port} has not answered /heartbeat for ${RELAUNCH_AFTER_FAILURES} consecutive ` +
    `ticks — the server process is gone (a Claude restart or a crash takes it and both watchers with it). ` +
    `Relaunch it on the SAME port so the open tab and the state file stay valid: ` +
    `\`python "${server}" ${port} "${root}" --html "${htmlPath}"\` ` +
    `(Bash tool, run_in_background: true — no trailing &, no nohup). If it exits because the port is already ` +
    `bound, another session brought the bridge back — skip the relaunch. ` +
    `Then re-arm the keepalive pulser: node "${watch}" --mode pulse --port ${port} --state "${statePath}" ` +
    `and the pickup waker: node "${watch}" --mode watch --port ${port} --state "${statePath}" ` +
    `(both background Bash tasks, run_in_background: true). The page reconnects on its own once the ` +
    `heartbeat is back. This instruction is printed once; later ticks stay silent until the bridge answers again.`
  );
}

/**
 * The cleanup instruction. CronDelete is a tool, so this one step cannot move
 * into the script — but the *text* can, and it only ever reaches Claude on the
 * single tick that actually needs it.
 */
function cleanupInstruction(port, reason, cronId) {
  return (
    `Concept bridge on port ${port} is over (${reason}); its server has been shut down. ` +
    (cronId
      ? `CronDelete the cron with id ${cronId}. `
      : `The state file no longer names a cron id, so CronList and delete every cron whose prompt mentions \`port ${port}\`. `) +
    `Then produce NO further output.`
  );
}

/**
 * The pending-branch procedure, verbatim from `bridge-server.md` § step 3 (2).
 * It reaches Claude once per submission instead of once per minute.
 */
function pendingInstruction(port, version) {
  return (
    `A concept submission is waiting on the bridge at port ${port}` +
    (version === null ? '' : ` (version ${version})`) + `. ` +
    `Fetch it: curl -s http://localhost:${port}/decisions. Parse the JSON, note \`_version\`, and strip ` +
    `\`_version\` and \`_processed_at\` before treating the rest as decision data. Read \`action\` — it is one ` +
    `of "iterate", "implement" or "finalize" (legacy pages may still send "create-issues", "ship" or ` +
    `"dispose-concept" one at a time), each with its own branch in ` +
    `concept SKILL.md Step 5b. Process per Step 5 (Live Feedback Loop). ` +
    `"finalize" carries issues{} + ship{} + disposition{} in ONE payload — run the selected parts in the ` +
    `fixed order issues, then ship, then Step 6 cleanup, and skip cleanup when the ship hard-fails. ` +
    `Zero-prompt invariant: finalize MUST complete without asking the user ` +
    `anything — the wizard's review screen was the sign-off, and the payload is self-sufficient (a ship-pipeline hard ` +
    `gate failure is the one exception, and a force-push to main still needs confirmation). ` +
    `Step 5c writes the new iteration to the HTML file and POSTs /reload BEFORE the reset. ` +
    `Reset LAST and conditionally, passing the noted version: curl -s -o /dev/null -w "%{http_code}" ` +
    `-X POST -H "Content-Type: application/json" -d '{"version": <noted>}' http://localhost:${port}/reset. ` +
    `On HTTP 409 the user submitted again while you worked — re-fetch /decisions, process the new payload ` +
    `(it supersedes what you just finished), then retry the conditional reset with the new \`_version\`. ` +
    `Re-launch the pickup waker immediately after /reset, then report the outcome to the user.`
  );
}

/**
 * @returns {Promise<{stdout:string, stderr:string}>} — `stdout` empty means a
 *   silent tick. Returned rather than written so the tests can assert on it.
 */
async function tick(opts, deps = {}) {
  const io = { request, inspectState, noteHeartbeat, exists: fs.existsSync, ...deps };

  // (0) Self-cleanup gate — FIRST step every tick, before any bridge traffic.
  const state = io.inspectState(opts.state, opts.port, io.exists);
  if (state.cleanup) {
    await io.request(opts.port, '/shutdown', 'POST', opts.timeout);
    return { stdout: cleanupInstruction(opts.port, state.reason, state.cronId), stderr: '' };
  }

  // (1) Heartbeat POST — what keeps the page's indicator green when the pulser
  // is gone. A single failure is stderr only: a per-tick complaint about a
  // dying bridge would spam the transcript once a minute. The SECOND
  // consecutive failure prints the relaunch instruction exactly once (#348);
  // the state file carries the edge so later ticks stay silent until the
  // bridge answers again.
  const beat = await io.request(opts.port, '/heartbeat', 'POST', opts.timeout);
  if (!beat.ok) {
    const note = io.noteHeartbeat(opts.state, false);
    if (note.relaunch) {
      const st = readStateJson(opts.state) || {};
      return { stdout: relaunchInstruction(opts.port, opts.state, String(st.html_path || '')), stderr: '' };
    }
    return { stdout: '', stderr: `concept-tick: bridge on port ${opts.port} did not answer /heartbeat\n` };
  }
  io.noteHeartbeat(opts.state, true);

  // (2) Pending check via /pending — a strict `{"pending": bool, "version": N}`,
  // never a substring match on /decisions.
  const res = await io.request(opts.port, '/pending', 'GET', opts.timeout);
  if (!res.ok) {
    return { stdout: '', stderr: `concept-tick: bridge on port ${opts.port} did not answer /pending\n` };
  }

  let body;
  try {
    body = JSON.parse(res.body);
  } catch {
    return { stdout: '', stderr: `concept-tick: /pending returned unparseable JSON\n` };
  }
  if (!body || body.pending !== true) return { stdout: '', stderr: '' };

  const version = typeof body.version === 'number' ? body.version : null;
  return { stdout: pendingInstruction(opts.port, version), stderr: '' };
}

module.exports = {
  parseArgs,
  validate,
  inspectState,
  noteHeartbeat,
  cleanupInstruction,
  pendingInstruction,
  relaunchInstruction,
  tick,
  DEFAULTS,
  RELAUNCH_AFTER_FAILURES,
};

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const err = validate(opts);
  if (err) {
    process.stderr.write(`concept-tick: ${err}\n`);
    process.stderr.write('usage: concept-tick.js --port <n> --state <abs path> [--timeout 8]\n');
    process.exit(2);
  }
  tick(opts)
    .then(({ stdout, stderr }) => {
      if (stderr) process.stderr.write(stderr);
      if (stdout) process.stdout.write(`${stdout}\n`);
    })
    // An internal error must stay a silent tick, not a failed Bash call every
    // minute — and never a stack trace Claude would try to act on.
    .catch((e) => process.stderr.write(`concept-tick: ${e && e.message}\n`));
}
