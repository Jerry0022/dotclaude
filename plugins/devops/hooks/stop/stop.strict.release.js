#!/usr/bin/env node
/**
 * @hook stop.strict.release
 * @version 0.1.0
 * @event Stop
 * @plugin devops
 * @description Settles the lifetime of an inline `/claude-strict` mode at the
 *   end of the turn that armed it. If the turn started a multi-turn workflow
 *   (a concept session — `.claude/concept-active.json`; an autonomous run —
 *   `AUTONOMOUS-LOCKOUT.flag`), the mode is bound to that workflow's state
 *   file and lives exactly as long as the file does. Otherwise the inline mode
 *   is released: the next prompt is normal unless it mentions the skill again.
 *
 *   Bound modes whose file has disappeared are released here too, so a
 *   finished concept session never leaves a stale strict behind. A branch mode
 *   (`/claude-strict on`) is never touched — only `off` or a branch switch
 *   ends it.
 *
 *   Never blocks the stop. Advisory line on stderr only.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const S = require('../lib/strict-state');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  const cwd = hook.cwd || process.cwd();
  try {
    const mode = S.readMode(cwd);
    if (!mode || mode.active !== true) process.exit(0);

    if (mode.reason === 'inline') {
      const binding = S.findBinding(cwd);
      if (binding) {
        S.bind(cwd, binding.reason, binding.file);
        process.stderr.write(`[claude-strict] inline strict bound to the running ${binding.reason} workflow (${binding.file}); it ends with it.\n`);
      } else {
        S.deactivate(cwd);
      }
      process.exit(0);
    }

    if (mode.boundTo && !fs.existsSync(path.join(cwd, mode.boundTo))) {
      S.deactivate(cwd);
      process.stderr.write(`[claude-strict] ${mode.reason} workflow ended — strict released.\n`);
    }
  } catch {
    // advisory only
  }
  process.exit(0);
});
