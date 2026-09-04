#!/usr/bin/env node
/**
 * @hook prompt.strict.enforce
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Arms and enforces `/claude-strict` — literal scope, discretionary
 *   parameters. A prompt that mentions `/claude-strict` arms the mode for this
 *   worktree + branch (`on`), for this turn (`<task>`), or clears it (`off`).
 *   Whenever the mode is active the contract block is injected as
 *   additionalContext — once per turn, and on machine prompts too (autonomous
 *   resumes, concept-bridge crons), because those are exactly the turns that
 *   must stay strict without the user re-typing the skill.
 *
 *   This hook is the ONLY injector of the contract. The Agent gate
 *   (pre.strict.agent-gate) refuses spawns that lack it but injects nothing,
 *   so one turn never carries the block twice.
 *
 *   Never arms on a prompt that `/claude-batch` will collect: that prompt is
 *   erased by the harness, so an armed mode would be invisible and answered by
 *   nobody (see batch-state.willBeCollected).
 *
 *   Branch switch: a mode armed on branch A is inactive on branch B. The first
 *   prompt on B gets a one-line notice, later ones nothing — the mode file
 *   stays so `/claude-strict on` can re-arm and `off` can clear it.
 *
 *   Spec: docs/superpowers/specs/2026-09-04-claude-strict-design.md
 */

require('../lib/plugin-guard');

const S = require('../lib/strict-state');
const { willBeCollected } = require('../lib/batch-state');

function emit(text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text },
  }));
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  const text = hook.prompt || hook.user_message || hook.message || '';
  const cwd  = hook.cwd || process.cwd();

  try {
    if (willBeCollected(hook)) process.exit(0);

    const mention = S.detectMention(text);
    if (mention.mentioned) {
      const existing = S.readMode(cwd);
      if (mention.route === 'off') {
        S.deactivate(cwd);
        emit('[claude-strict] strict mode is off for this worktree. Confirm that in one line; nothing else changes.');
        process.exit(0);
      }
      if (mention.route === 'on') {
        S.activate(cwd, { reason: 'on', sessionId: hook.session_id });
      } else if (mention.route === 'task') {
        // A branch mode already covers this turn — never downgrade it to inline.
        if (!(existing && existing.reason === 'on' && S.evaluate(cwd).active)) {
          S.activate(cwd, { reason: 'inline', sessionId: hook.session_id });
        }
      }
      // route 'status': the skill reports; the injection below shows the state.
    }

    const branch = S.currentBranch(cwd);
    const ev = S.evaluate(cwd, { branch });
    if (ev.active) {
      emit(S.contractText({ mode: ev.mode, branch }));
      process.exit(0);
    }

    if (ev.why === 'branch-mismatch' && ev.mode && branch && !S.branchNoticed(cwd, branch)) {
      S.markBranchNoticed(cwd, branch);
      emit(
        `[claude-strict] strict was armed on branch \`${ev.mode.branch}\`; this worktree is now on ` +
        `\`${branch}\`, so strict is inactive here. Tell the user in one line. ` +
        '`/claude-strict on` re-arms for this branch, `/claude-strict off` clears the old mode.',
      );
    }
  } catch {
    // Advisory hook — a bug here must never cost the user a turn.
  }
  process.exit(0);
});
