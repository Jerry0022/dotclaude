#!/usr/bin/env node
/**
 * @hook ss.concept.resume
 * @version 0.3.0
 * @event SessionStart
 * @plugin devops
 * @description Recover an open concept session after a Claude restart.
 *   Reads `.claude/concept-active.json` (written by /concept Step 3),
 *   probes the bridge server to confirm it is still running, and instructs
 *   Claude to re-arm everything that watches it — the backup cron AND the two
 *   detached background tasks (keepalive pulser, pickup waker) — plus pick up
 *   any unprocessed submission immediately. All three are session-scoped and
 *   die with the prior session; re-arming only the cron left the resumed
 *   session watching on a path that fires just while the REPL is idle, so a
 *   submission could rot in the bridge while the page still showed a green
 *   indicator (issue #276).
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

/**
 * Directory of the durable store for a concept (#284). Must mirror the
 * server's own derivation in `concept-server.py` __main__ — the HTML basename
 * without its extension, under `.claude/concepts/` in the project root.
 */
function storeDirFor(htmlPath) {
  const base = path.basename(String(htmlPath || '')).replace(/\.html$/i, '');
  return path.join(cwd, '.claude', 'concepts', base);
}

/**
 * Read whatever the bridge managed to persist, WITHOUT needing it to be alive.
 *
 * This is the half that did not exist before. The hook used to probe
 * `/heartbeat` and give up when it failed, because there was nothing on disk
 * to fall back to — which is precisely why a submission lost to a usage-limit
 * watchdog reap was unrecoverable and, worse, invisible.
 *
 * @returns {{unprocessed:boolean, version:number|null, marker:object|null,
 *            lastCheckpoint:object|null, progress:object[], attachments:number,
 *            storeDir:string, present:boolean}}
 */
function readStore(storeDir) {
  const empty = {
    unprocessed: false, version: null, marker: null, lastCheckpoint: null,
    progress: [], attachments: 0, storeDir, present: false,
  };
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(path.join(storeDir, 'state.json'), 'utf8'));
  } catch {
    return empty;
  }
  if (!state || typeof state !== 'object') return empty;

  // `submitted: true` in the persisted payload is the authoritative signal.
  // The marker file is corroborating evidence of HOW the process died
  // (watchdog reap / crash vs. a clean exit), not the source of truth — a
  // marker write can fail on a full disk while the fsynced payload is fine.
  let unprocessed = false;
  try {
    const payload = JSON.parse(state.decisions);
    unprocessed = payload && payload.submitted === true;
  } catch { /* unparseable payload — treat as nothing pending */ }

  let marker = null;
  try {
    marker = JSON.parse(fs.readFileSync(path.join(storeDir, 'UNPROCESSED'), 'utf8'));
  } catch { /* absent = clean teardown */ }

  const progress = [];
  try {
    const raw = fs.readFileSync(path.join(storeDir, 'journal.jsonl'), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && rec.type === 'progress') progress.push(rec);
      } catch { /* skip a torn final line */ }
    }
  } catch { /* no journal yet */ }

  let attachments = 0;
  try {
    attachments = fs.readdirSync(path.join(storeDir, 'attachments')).length;
  } catch { /* none */ }

  return {
    unprocessed,
    version: typeof state.version === 'number' ? state.version : null,
    marker,
    lastCheckpoint: progress.length ? progress[progress.length - 1] : null,
    progress,
    attachments,
    storeDir,
    present: true,
  };
}

/**
 * The verification mandate. The user's rule is auto-resume, but auto-resume
 * that trusts a checkpoint is how you double-ship: the checkpoint records what
 * a previous run *believed* it had done, and it died precisely because
 * something went wrong. So the checkpoint is only ever a place to LOOK.
 * Reality — git, gh — decides what actually happened, and the resumed run
 * continues from the observed state.
 */
function buildVerificationMandate(store) {
  const cp = store.lastCheckpoint;
  const lines = [
    `RECOVERY (concept bridge, store ${store.storeDir}): an unprocessed submission ` +
    `(version ${store.version}) survived a teardown` +
    (store.marker && store.marker.reason ? ` — cause: ${store.marker.reason}` : '') +
    `. The user's work was preserved on disk; do NOT ask them to redo it.`,
  ];
  if (cp) {
    lines.push(
      `A previous run got as far as: action=${cp.action || '?'}, step=${cp.step || '?'}, ` +
      `status=${cp.status || '?'}, artifacts=${JSON.stringify(cp.artifacts || {})}.`
    );
  } else {
    lines.push(`No progress checkpoint was written — the previous run died before it started processing.`);
  }
  lines.push(
    `VERIFY BEFORE YOU ACT — the checkpoint says where to look, never what to trust. ` +
    `Establish the real state first: for a branch, \`git rev-parse --verify <branch>\` and \`git log\`; ` +
    `for a PR, \`gh pr view <n> --json state,mergedAt\`; for issues, \`gh issue view <n>\`; ` +
    `for code changes, read the files. THEN resume from what you observed, not from the checkpoint: ` +
    `never re-create a branch/PR/issue that exists, never re-merge a merged PR, never re-run a ` +
    `completed step. Checkpoint each further step via POST /progress as you go.`
  );
  if (store.attachments > 0) {
    lines.push(
      `${store.attachments} attachment(s) are in ${path.join(store.storeDir, 'attachments')} — ` +
      `read the referenced images with the Read tool when processing the comments.`
    );
  }
  return lines.join(' ');
}

/**
 * Fire-and-forget POST /shutdown. We don't wait for the response — even on
 * Windows with PID recycling, the server's listening socket is on the port
 * we know, and the watchdog already handles the no-response case. Best-effort
 * graceful termination; the watchdog is the safety net.
 */
function postShutdown(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/shutdown', method: 'POST', timeout: timeoutMs },
      (res) => { res.resume(); res.on('end', resolve); }
    );
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.on('error', () => resolve());
    req.end();
  });
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

/**
 * The combined heartbeat + auto-poll cron body. Canonical definition lives in
 * `skills/concept/deep-knowledge/bridge-server.md` § step 3; this mirrors it so
 * a resumed session re-arms exactly what the original session had.
 */
function buildCronBody(port) {
  return (
    `Silently service the concept bridge on port ${port}. ` +
    `(0) Self-cleanup gate (FIRST step every tick): Read \`.claude/concept-active.json\`. ` +
    `Cleanup triggers if the file is missing, OR state.port ≠ ${port}, OR state.html_path does not exist on disk. ` +
    `On trigger: (a) Bash: curl -s -X POST http://localhost:${port}/shutdown > /dev/null 2>&1 || true; ` +
    `(b) CronDelete the cron_id from the still-readable state file — or, if the state file is gone, ` +
    `CronList and delete every cron whose prompt mentions \`port ${port}\`. ` +
    `Produce NO output and skip steps 1+2. ` +
    `(1) Heartbeat POST: Bash: curl -s -X POST http://localhost:${port}/heartbeat > /dev/null. ` +
    // The quotes here must reach Python bare. Escaping them as \' emits a
    // literal backslash — bash does not strip it inside double quotes, so
    // Python got a line-continuation SyntaxError and the resumed session's
    // backup pickup path was dead on arrival. Pinned by a byte-for-byte test
    // against bridge-server.md.
    `(2) Pending check via /pending: Bash: curl -s http://localhost:${port}/pending | python -c "import sys,json; d=json.load(sys.stdin); print('true' if d.get('pending') else 'false')". ` +
    `If exactly "false" → produce NO output (silent tick). ` +
    `If exactly "true" → curl -s http://localhost:${port}/decisions, parse JSON, note _version, process per concept SKILL.md Step 5 (rewrite HTML, POST /reload, then conditionally POST /reset with the noted version). On 409 retry with the new version. Report the outcome to the user.`
  );
}

/**
 * The two detached background tasks from `bridge-server.md` § step 3, now a
 * single script in two modes rather than a shell loop duplicated across three
 * documents.
 *
 * Background Bash tasks are session-scoped exactly like crons, so a restart
 * kills them too — and this hook used to re-arm only the cron. That left a
 * resumed session with the failure mode from issue #276: the cron is idle-only
 * and lags by minutes, so a submission could sit unread while the page still
 * showed a green indicator.
 *
 * The state path is passed ABSOLUTE. The shell version tested a relative
 * `.claude/concept-active.json` against the task cwd, which is not always the
 * project root the state file lives in — both watchers then exited STATE_GONE
 * on their first iteration.
 *
 * @param {number} port
 * @param {string} statePath absolute path to .claude/concept-active.json
 */
function buildBackgroundTasks(port, statePath) {
  const script = path.join(__dirname, '..', '..', 'scripts', 'concept-watch.js');
  const invoke = (mode) =>
    `node "${script}" --mode ${mode} --port ${port} --state "${statePath}"`;
  return { pulser: invoke('pulse'), waker: invoke('watch') };
}


/**
 * The instruction text handed to the resumed Claude session.
 * @param {{port:number, html_path:string, slug?:string}} state
 * @param {'pending'|'idle'|'unknown'} pendingState
 */
function buildResumeInstructions(state, pendingState, statePath = STATE_PATH, store = null) {
  const bg = buildBackgroundTasks(state.port, statePath);
  const lines = [];

  lines.push(
    `An open /concept session was found in this project ` +
    `(port ${state.port}, html_path ${state.html_path}, slug ${state.slug || '?'}). ` +
    `The bridge server is alive, but everything that watched it is gone — background Bash tasks ` +
    `are session-scoped just like crons. Re-arm all three now.`
  );
  lines.push(
    `(a) BACKUP pickup path — CronCreate with cron "* * * * *" (recurring: true) and prompt: ` +
    `'${buildCronBody(state.port)}'.`
  );
  lines.push(
    `(b) Keepalive pulser — launch as a background Bash task (run_in_background: true). Without it ` +
    `the page's connection indicator goes red within 90s: ${bg.pulser}`
  );
  lines.push(
    `(c) PRIMARY pickup path, the pickup waker — launch as a background Bash task ` +
    `(run_in_background: true). It exits the moment a submission lands and wakes you, with no user ` +
    `chat message required, and MUST be re-launched after every processing round: ${bg.waker}`
  );

  if (pendingState === 'pending') {
    lines.push(
      `IMMEDIATELY ALSO process the pending submission BEFORE waiting on any of the above: ` +
      `curl -s http://localhost:${state.port}/decisions, parse, then run concept SKILL.md Step 5 ` +
      `(rewrite HTML at ${state.html_path}, POST /reload, conditional /reset with the captured _version). ` +
      `The user already submitted and is waiting — do not delay this on a schedule.`
    );
    // A checkpoint means a PREVIOUS run already started processing this very
    // submission and died partway. Re-running it blind is how a half-finished
    // ship becomes a double ship, so the verification mandate applies here
    // just as it does to a dead-bridge recovery.
    if (store && store.lastCheckpoint) {
      lines.push(buildVerificationMandate(store));
    }
  } else if (pendingState === 'unknown') {
    lines.push(
      `The /pending probe was inconclusive (timeout, non-200, or malformed JSON). ` +
      `Do NOT assume idle. Fetch /decisions once now: curl -s http://localhost:${state.port}/decisions. ` +
      `If submitted=true, run Step 5 immediately (rewrite ${state.html_path}, /reload, conditional /reset). ` +
      `If submitted=false, the waker from (c) catches any later submission.`
    );
  } else {
    lines.push(
      `No submission is pending right now. Once (b) and (c) are running the waker picks up the next ` +
      `submission within ~20s on its own — the user does not have to announce it in chat.`
    );
  }

  return lines.join(' ');
}

/**
 * Instructions for the case the hook could not handle at all before: the
 * bridge process is GONE, but the user's submission is on disk.
 *
 * The old code path exited 0 here. That silence is the bug the user actually
 * hit — Claude ran out of budget, the watchdog reaped the bridge 30 min later,
 * and the next session had no idea anything had ever been submitted.
 */
function buildDeadBridgeRecovery(state, store) {
  const server = path.join(__dirname, '..', '..', 'scripts', 'concept-server.py');
  const bg = buildBackgroundTasks(state.port, STATE_PATH);
  return [
    buildVerificationMandate(store),
    `The bridge process itself is gone. Relaunch it on the SAME port so the open tab and the ` +
    `state file stay valid — it restores the pending submission from the store automatically: ` +
    `\`python "${server}" ${state.port} "${cwd}" --html "${state.html_path}"\` ` +
    `(Bash tool, run_in_background: true — no trailing &, no nohup).`,
    `Then confirm the recovery with \`curl -s http://localhost:${state.port}/recovery\`, ` +
    `re-arm the keepalive pulser (${bg.pulser}) and the pickup waker (${bg.waker}), ` +
    `and process the recovered submission.`,
  ].join(' ');
}

module.exports = {
  isValidHtmlPath,
  isStale,
  buildCronBody,
  buildBackgroundTasks,
  buildResumeInstructions,
  storeDirFor,
  readStore,
  buildVerificationMandate,
  buildDeadBridgeRecovery,
};

if (require.main === module) {
  require('../lib/plugin-guard');

  (async () => {
    const state = readState();
    if (!state) process.exit(0);

    // Consistency check: the concept HTML on disk is the source of truth for
    // "is this session still real?" If the file is gone, the concept was
    // discarded / moved / never persisted and any running bridge is an orphan.
    // We do this BEFORE the heartbeat probe so a still-running ghost server
    // gets shut down explicitly — relying on the watchdog alone would leave
    // the server alive for up to 30 s after this hook returns, surfacing
    // misleading "concept active" state in the meantime.
    // Read the durable store FIRST. Every branch below needs to know whether
    // the user has unprocessed work sitting on disk, and none of them may
    // throw that away just because a process or a file went missing.
    const store = readStore(storeDirFor(state.html_path));

    const htmlAbs = path.join(cwd, state.html_path);
    if (!fs.existsSync(htmlAbs)) {
      await postShutdown(state.port);
      deleteState();
      // The concept HTML is gone, so there is no page left to iterate on —
      // but an unprocessed submission must not disappear with it. Surface it
      // and leave the store alone; deleting it is the user's call, made
      // through the disposition flow, not a side effect of a missing file.
      if (store.unprocessed) {
        process.stdout.write(
          buildVerificationMandate(store) +
          ` NOTE: the concept HTML (${state.html_path}) no longer exists, so there is no page to ` +
          `iterate on. Report the recovered submission to the user and ask how they want to use it ` +
          `BEFORE removing anything under ${store.storeDir}.\n`
        );
      }
      process.exit(0);
    }

    const heartbeat = await probe(state.port, '/heartbeat');
    if (!heartbeat) {
      // The bridge process is dead. This branch used to exit silently, which
      // is exactly how a usage-limit watchdog reap turned into an invisible
      // loss. Now the store answers the question the dead server cannot.
      if (store.unprocessed) {
        process.stdout.write(buildDeadBridgeRecovery(state, store) + '\n');
        process.exit(0);
      }
      // Nothing pending. If the state file is also stale, prune it; otherwise
      // leave it — the user might be restarting the server in another terminal.
      if (isStale(state)) deleteState();
      process.exit(0);
    }

    // Server is alive. Check whether a submission is sitting unprocessed.
    // We must distinguish three states explicitly:
    //   - probe ok, pending: false → safe to leave to the waker
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

    process.stdout.write(buildResumeInstructions(state, pendingState, STATE_PATH, store) + '\n');
  })();
}
