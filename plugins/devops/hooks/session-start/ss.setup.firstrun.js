#!/usr/bin/env node
/**
 * @hook ss.setup.firstrun
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description (1) Bootstrap check (#923): git, Git Bash (Windows) and a
 *   usable node. A missing one is named with its `winget install` command and
 *   Claude offers to run it, then asks for an app restart (PATH is read at
 *   start). Repeats every session until fixed — a broken plugin must not be
 *   silent. (2) Offers the setup guide (skills/auto-setup) ONCE per user,
 *   recorded in ~/.claude/devops-setup.json; "devops setup" re-runs it any
 *   time. Fresh `startup` sessions only. Pure fs + one `git --version`
 *   (3 s cap) — boot-window safe; never blocks, exit 0 always.
 */

require('../lib/plugin-guard');

const os = require('os');
const setup = require('../lib/devops-setup');

const SKILL = 'devops:auto-setup';

/** @returns {string|null} additionalContext, or null for nothing to say */
function build({ source, home = os.homedir(), env = process.env, prereqs } = {}) {
  if (env.CI || env.DEVOPS_NO_SETUP_OFFER === '1') return null;
  const lines = [];
  const pre = prereqs || setup.checkPrereqs({ env });
  if (pre.missing.length) {
    lines.push(
      `[ss.setup.firstrun] Missing prerequisite(s): ${pre.missing.join(', ')}. The devops plugin cannot work fully without them.`,
      'Tell the user in ONE short message, then offer with AskUserQuestion to run the install for them',
      `(options: "Ja, installieren (Empfohlen)" / "Nein, ich mache es selbst"): ${pre.winget.join('  and  ')}.`,
      'After it ran: the app must be restarted fully and a NEW session started — PATH is only read at start.',
    );
  }
  if ((source === undefined || source === 'startup') && !setup.wasOffered(home)) {
    try { setup.recordOffer(home); } catch { /* the offer may repeat once — harmless */ }
    lines.push(
      '[ss.setup.firstrun] First start of the devops plugin on this machine.',
      'Offer the user the setup guide in ONE short line of your first reply (Quiet style, plan, API credit, agents, language;',
      `about two minutes). Do not run it unasked; on a yes load the Skill ${SKILL}. Offered once only — never repeat it.`,
      'The user can start it any time with "devops setup".',
    );
  }
  return lines.length ? lines.join('\n') : null;
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    let hook = {};
    const text = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
    try { hook = JSON.parse(text) || {}; } catch { /* no input */ }
    try {
      const ctx = build({ source: hook.source });
      if (ctx) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx },
        }) + '\n');
      }
    } catch { /* never block session start */ }
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { build, SKILL };
