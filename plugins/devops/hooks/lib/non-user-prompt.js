/**
 * @module non-user-prompt
 * @description One answer to "did the user type this?" for UserPromptSubmit
 *   hooks. Cron/loop ticks, AFK resumes, scheduled tasks, task notifications
 *   and channel messages all arrive through UserPromptSubmit, and a hook that
 *   scans them as user text acts on words nobody typed — a red-team report
 *   naming "PR #471" flipped issues to In Progress (#473), a subagent
 *   notification fired the app-start card mandate (#474).
 */

const { isMachinePrompt } = require('./batch-state');
const { isMachineTurn, isSilent, isScheduledTask } = require('../user-prompt-submit/prompt.flow.silent-turn');

/**
 * True when the prompt was not typed by the user.
 * @param {string} message
 */
function isNonUserPrompt(message) {
  if (typeof message !== 'string') return true;
  return isMachinePrompt(message) || isMachineTurn(message) || isSilent(message) || isScheduledTask(message);
}

module.exports = { isNonUserPrompt };
