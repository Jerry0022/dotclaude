#!/usr/bin/env node
/**
 * @hook prompt.burn.resume
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description After a usage limit stopped a burn: ask on a manual nudge, apply the chosen policy on an automatic resume.
 *   The model would otherwise simply carry on burning.
 *
 *   A burn run lives in BURN-STATE.json at the project root of its worktree.
 *   When the 5-hour or weekly limit stops the session mid-run, the next
 *   prompt in that session is one of two things:
 *
 *   - **The user nudging by hand** ("weiter", anything typed): the user is
 *     back, and a burn that silently keeps burning at the old depth is not
 *     what they asked for. The hook tells Claude to ask ONE question first —
 *     Burn abschalten (recommended) · Burn fortsetzen · Run beenden — and to
 *     apply the answer with `burn-plan.js resumed --trigger=manual`.
 *   - **An automatic resume** (`BURN_RESUME:` from the burn's own window
 *     pause cron, `AUTONOMOUS_RESUME:` from autonomous mode's reset cron): the
 *     user is away, so nothing is asked. The policy the user chose up front
 *     (do-run follow-up F7, `resume.auto` in the state) is applied with
 *     `--trigger=auto`; a week that has reset since the burn started turns
 *     the burn off regardless — the budget it was burning is gone.
 *
 *   "Stopped by a limit" is read from the transcript: the newest main-chain
 *   assistant line is Claude Code's synthetic rate-limit message
 *   (hooks/lib/burn-state.js), or the state itself says `paused`. Once a
 *   resume was recorded after that stop (`lastResume.at`), the hook is
 *   silent again. A different session opening the worktree of an open,
 *   stale run is asked once per session.
 *
 *   Silent on everything else: no state, a finished or empty run, machine
 *   turns (task notifications, cron-silent prompts), a burn still running.
 */

require('../lib/plugin-guard');

const path = require('path');
const { parseHookInput } = require('../lib/hook-input');
const { projectRoot } = require('../lib/project-root');
const { statePath, readStateFile, isOpenRun, tally, limitEvidence } = require('../lib/burn-state');
const { sessionFile, readSessionFile, writeSessionFile } = require('../lib/session-id');
const { isSilent, isMachineTurn } = require('./prompt.flow.silent-turn');

const AUTO_PREFIX = /^\s*(BURN_RESUME:|AUTONOMOUS_RESUME:)/;
const OTHER_MACHINE_PREFIX = /^\s*(AUTONOMOUS_AUTOSTART:|RUN_BACKLOG_AUTOSTART:)/;
const STALE_HEARTBEAT_MIN = 20;
const ASKED_PREFIX = 'dotclaude-devops-burn-resume-asked';

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'burn-plan.js');
const MODE_DOC = 'skills/do-run/modes/burn.md';

function counts(state) {
  const t = tally(state);
  return `${t.done} gelandet · ${t.queue} offen · ${t.inFlight} unklar`;
}

function afterStop(state, evidence) {
  const last = state.lastResume && Date.parse(state.lastResume.at);
  if (!last) return true;
  const stopAt = evidence && evidence.at ? Date.parse(evidence.at) : NaN;
  if (Number.isFinite(stopAt)) return stopAt > last;
  if (state.status === 'paused' && state.pause && state.pause.since) return Date.parse(state.pause.since) > last;
  return false;
}

function weekRolled(state, nowMs) {
  return !!(state.weekResetAt && nowMs >= Date.parse(state.weekResetAt));
}

function manualBlock({ state, evidence, sessionId, root, crossSession }) {
  const why = crossSession
    ? `Ein Burn-Run in diesem Worktree ist offen und seit über ${STALE_HEARTBEAT_MIN} Minuten still (${counts(state)}).`
    : `Der Burn-Run in diesem Worktree wurde ${evidence && evidence.limited ? `vom ${evidence.kind === 'weekly' ? 'Wochen' : evidence.kind === 'session' ? '5-Stunden-' : ''}Limit gestoppt` : 'pausiert'} (${counts(state)}). Der Nutzer stößt jetzt von Hand an.`;
  const sid = sessionId ? ` --session=${sessionId}` : '';
  return [
    `[burn-resume] ${why}`,
    'Setz den Burn NICHT einfach fort. Frag zuerst — ein AskUserQuestion, Header "Burn", Optionen in genau dieser Reihenfolge:',
    '  1. "Burn abschalten (Recommended)" — Offene Hauptaufgaben normal fertigstellen (Standard-Tiefe, eine Lane); Füll-Tasks entfallen.',
    '  2. "Burn fortsetzen" — Plan aus der aktuellen Usage neu berechnen und weiterbrennen.',
    '  3. "Run beenden" — Nichts Neues starten; laufende Tasks sichern, Report und Card.',
    'Beantwortet der Prompt die Frage schon eindeutig ("burn aus", "weiter burnen", "stopp"), nimm das als Antwort und frag nicht.',
    `Dann: node "${SCRIPT}" resumed --trigger=manual --choice=<off|continue|end>${sid} --state="${statePath(root)}"`,
    `und weiter nach ${MODE_DOC} Step 0.6 (resume-check --apply${sid}, dann der Conveyor).`,
  ].join('\n');
}

function autoBlock({ state, evidence, sessionId, root, prompt, nowMs }) {
  const policy = weekRolled(state, nowMs) ? 'off' : (state.resume && state.resume.auto === 'off' ? 'off' : 'continue');
  const reason = weekRolled(state, nowMs)
    ? 'die Woche wurde seit dem Burn-Start zurückgesetzt — das verbrannte Budget gibt es nicht mehr'
    : `Vorab-Antwort des Nutzers (F7): ${policy === 'continue' ? 'Burn fortsetzen' : 'Burn abschalten'}`;
  const sid = sessionId ? ` --session=${sessionId}` : '';
  const lines = [
    `[burn-resume] Auto-Resume: der Burn-Run in diesem Worktree wurde ${evidence && evidence.limited ? 'vom Limit gestoppt' : 'für das 5-Stunden-Fenster pausiert'} (${counts(state)}). Der Nutzer ist weg — keine Frage.`,
    `Richtlinie: ${policy} (${reason}).`,
    `Führe aus: node "${SCRIPT}" resumed --trigger=auto --choice=${policy}${sid} --state="${statePath(root)}"`,
    `dann weiter nach ${MODE_DOC} Step 0.6 (resume-check --apply${sid}, dann der Conveyor).`,
  ];
  if (/^\s*AUTONOMOUS_RESUME:/.test(prompt)) {
    lines.push('Danach autonomous mode Step 0.2 für die ÜBRIGEN Worktrees — diesen hier nicht noch einmal anstoßen.');
  }
  return lines.join('\n');
}

/**
 * Pure decision — exported for tests.
 * @returns {string|null} the instruction block, or null for silence
 */
function decide({ prompt, state, evidence, sessionId, root, nowMs, askedThisSession }) {
  if (!state || !isOpenRun(state)) return null;
  const text = typeof prompt === 'string' ? prompt : '';
  if (OTHER_MACHINE_PREFIX.test(text)) return null;

  const auto = AUTO_PREFIX.test(text);
  if (!auto && (isMachineTurn(text) || isSilent(text))) return null;

  const stopped = !!(evidence && evidence.limited) || state.status === 'paused';
  if (stopped && afterStop(state, evidence)) {
    return auto
      ? autoBlock({ state, evidence, sessionId, root, prompt: text, nowMs })
      : manualBlock({ state, evidence, sessionId, root, crossSession: false });
  }

  if (auto) {
    if (/^\s*BURN_RESUME:/.test(text)) {
      return '[burn-resume] Der Burn läuft ohne Limit-Stopp — nichts fortzusetzen. Warte weiter auf die laufenden Lanes; keine Aktion.';
    }
    return null;
  }

  // Another session opened the worktree of an open run that went quiet.
  const beat = state.heartbeatAt ? Date.parse(state.heartbeatAt) : NaN;
  const stale = Number.isFinite(beat) && (nowMs - beat) / 60000 > STALE_HEARTBEAT_MIN;
  const other = sessionId && state.sessionId && state.sessionId !== sessionId;
  if (other && stale && !askedThisSession && ['running', 'draining', 'paused', undefined].includes(state.status)) {
    return manualBlock({ state, evidence, sessionId, root, crossSession: true });
  }
  return null;
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      const hook = parseHookInput(inputData);
      if (!hook) process.exit(0);
      const root = projectRoot(hook.cwd || process.cwd());
      const state = readStateFile(statePath(root));
      if (!state || !isOpenRun(state)) process.exit(0);
      const sessionId = hook.session_id || null;
      let asked = false;
      try { asked = !!(sessionId && readSessionFile(ASKED_PREFIX, sessionId, { exact: true })); } catch { /* unreadable marker = not asked yet */ }
      const block = decide({
        prompt: hook.prompt || '',
        state,
        evidence: limitEvidence(hook.transcript_path),
        sessionId,
        root,
        nowMs: Date.now(),
        askedThisSession: asked,
      });
      if (!block) process.exit(0);
      if (/AskUserQuestion/.test(block) && sessionId) {
        try { writeSessionFile(sessionFile(ASKED_PREFIX, sessionId), String(Date.now())); } catch { /* worst case: the question comes once more */ }
      }
      process.stdout.write(block + '\n');
    } catch {
      // never surface an internal error as a hook failure
    }
    process.exit(0);
  });
}

module.exports = { decide, AUTO_PREFIX, STALE_HEARTBEAT_MIN };
