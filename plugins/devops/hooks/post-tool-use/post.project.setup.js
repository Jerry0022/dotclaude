#!/usr/bin/env node
/**
 * @hook post.project.setup
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Bash|PowerShell
 * @description Runs `ss.project.setup`'s logic right after a mid-session
 *   `git init` instead of waiting for the next SessionStart (#503). Without
 *   this, a session that starts in a plain folder and runs `git init` for a
 *   new project never gets the one-time setup offer or the runtime-ignores
 *   block in `.git/info/exclude` for the rest of that session.
 *
 *   Detects `git init`, `git init <dir>` and `git -C <dir> init` (see
 *   `lib/git-init-detect.js`) in the completed Bash/PowerShell command, then
 *   calls the SAME `setupProject()` used by `ss.project.setup` against the
 *   directory `git init` just created — so the one-time offer and its state
 *   file (`~/.claude/devops-project-setup.json`) are shared: whichever hook
 *   runs first wins, the other one is silent.
 *
 *   Silent for a re-init of an existing repo (already has a commit and a
 *   `.gitignore`) and for a repeated `git init` in the same clone (already
 *   recorded in the state file) — `setupProject()` already handles both.
 */

require('../lib/plugin-guard');

const { parseHookInput } = require('../lib/hook-input');
const { detectGitInitTargets } = require('../lib/git-init-detect');
const { setupProject } = require('../session-start/ss.project.setup');

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * @param {string} inputData raw stdin
 * @returns {string} JSON to print, or ''
 */
function run(inputData) {
  const hook = parseHookInput(inputData);
  if (!hook) return '';
  if (!SHELL_TOOLS.has(hook.tool_name)) return '';

  const command = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input.command : '';
  const targets = detectGitInitTargets(command, hook.cwd);
  if (!targets.length) return '';

  const offers = [];
  for (const target of targets) {
    let res;
    try {
      res = setupProject({ cwd: target });
    } catch {
      continue;
    }
    if (res && res.offer) offers.push(res.offer);
  }
  if (!offers.length) return '';

  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: offers.join('\n\n') },
  });
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      const out = run(inputData);
      if (out) process.stdout.write(out);
    } catch { /* never surface an internal error */ }
    process.exitCode = 0;
  });
}

module.exports = { run };
