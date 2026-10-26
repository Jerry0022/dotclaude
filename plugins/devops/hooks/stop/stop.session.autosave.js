#!/usr/bin/env node
/**
 * @hook stop.session.autosave
 * @version 0.3.0
 * @event Stop
 * @plugin devops
 * @description Safety net for session worktrees: a turn that ends with
 *   uncommitted work or unpushed commits in .claude/worktrees/<name> and no
 *   open PR is snapshotted to the local branch parked/autosave/<name>
 *   (lib/session-autosave.js) — the user's branch, index and files are never
 *   touched. Config: sessionEnd.autosave = local (default) | push | off.
 *
 *   Time budget: the save runs in a detached, windowless worker
 *   (lib/session-autosave-worker.js). The hook waits at most
 *   sessionEnd.autosaveWaitSeconds (default 8). If the save is not done by
 *   then it keeps running, and the hook prints ONE systemMessage line (de/en):
 *   archive the session only after it finishes — pre.session.archive blocks
 *   archiving while the worker's running marker is live.
 *
 *   Output: the "autosaved ..." line when something was saved in time, plus
 *   the landing-decision ask (DECIDE) unless the turn shipped; "Save
 *   finished." when this turn's last completion card was ship-successful or
 *   released and the save finished in time; otherwise silent. Never blocks,
 *   never fails the stop.
 */

require('../lib/plugin-guard');

const { parseHookInput } = require('../lib/hook-input');

const RUNNING = {
  de: 'Sicherung offener Änderungen läuft noch — Session erst danach archivieren.',
  en: 'Saving open changes is still running — archive the session only after it finishes.',
};
const FINISHED = { de: 'Sicherung abgeschlossen.', en: 'Save finished.' };
// a snapshot is a crash net, not a decision: say so on the turn it is taken
const DECIDE = {
  de: 'Noch nicht gelandet — shippen, mit Grund parken oder verwerfen; sonst meldet der Start-Hinweis es nach 3 Tagen.',
  en: 'Not landed yet — ship it, park it with a reason, or discard it; otherwise the start nudge reports it after 3 days.',
};
const SHIP_CARDS = new Set(['ship-successful', 'released']);
const POLL_MS = 40;

/** Variant of the last completion card of this turn (transcript tail), or null. */
function lastCardVariant(transcriptPath) {
  try {
    const { safeReadTranscript, TRANSCRIPT_TAIL_BYTES } = require('../lib/card-guard');
    const lines = safeReadTranscript(transcriptPath, TRANSCRIPT_TAIL_BYTES).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (!l) continue;
      if (l.includes('render_completion_card')) {
        const m = /"variant"\s*:\s*"([a-z-]+)"/.exec(l);
        if (m) return m[1];
      }
      // the user's own prompt ends this turn's scope
      if (/"type"\s*:\s*"user"/.test(l) && !l.includes('tool_result')) return null;
    }
  } catch { /* unknown */ }
  return null;
}

function spawnWorker(payload) {
  const child = require('child_process').spawn(process.execPath,
    [require('path').join(__dirname, '..', 'lib', 'session-autosave-worker.js'), JSON.stringify(payload)],
    { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

/**
 * @param {object} hook
 * @param {{waitMs?:number, delayMs?:number, spawn?:Function}} [opts] test seams
 */
async function main(hook, opts = {}) {
  if (hook.agent_id) return null;
  const cwd = hook.cwd || process.cwd();
  // A session worktree is the only place the save acts; skip the worker start elsewhere.
  if (!/[\\/]\.claude[\\/]worktrees[\\/]/.test(cwd)) return null;
  const cfg = require('../lib/devops-config').load(cwd).values.sessionEnd;
  if (cfg.autosave === 'off') return null;
  const waitMs = opts.waitMs !== undefined ? opts.waitMs : cfg.autosaveWaitSeconds * 1000;
  const worker = require('../lib/session-autosave-worker');
  const fs = require('fs');
  let lang = 'de';
  try { lang = require('../lib/locale').getLocale(hook.session_id); } catch { /* default */ }
  // the previous turn's save is still going: never start a second one next to it
  if (worker.isRunning(hook.session_id)) return JSON.stringify({ systemMessage: RUNNING[lang] || RUNNING.en });
  const result = `${worker.markerFile(hook.session_id)}.result`;
  try { fs.unlinkSync(result); } catch { /* none */ }
  (opts.spawn || spawnWorker)({ sessionId: hook.session_id, cwd, mode: cfg.autosave, delayMs: opts.delayMs });

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    let out = null;
    try { out = JSON.parse(fs.readFileSync(result, 'utf8')); } catch { /* not yet */ }
    if (out) {
      try { fs.unlinkSync(result); } catch { /* none */ }
      if (out.message) {
        const ship = SHIP_CARDS.has(lastCardVariant(hook.transcript_path));
        return JSON.stringify({ systemMessage: ship ? out.message : `${out.message} ${DECIDE[lang] || DECIDE.en}` });
      }
      if (SHIP_CARDS.has(lastCardVariant(hook.transcript_path))) {
        return JSON.stringify({ systemMessage: FINISHED[lang] || FINISHED.en });
      }
      return null;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return JSON.stringify({ systemMessage: RUNNING[lang] || RUNNING.en });
}

module.exports = { main, lastCardVariant, RUNNING, FINISHED, DECIDE };

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', async () => {
    try {
      const hook = parseHookInput(raw);
      const out = hook ? await main(hook) : null;
      if (out) process.stdout.write(`${out}\n`);
    } catch {
      // fail open
    }
    process.exitCode = 0;
  });
}
