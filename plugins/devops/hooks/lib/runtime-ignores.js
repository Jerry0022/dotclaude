'use strict';
/**
 * @module runtime-ignores
 * @version 0.1.0
 * @plugin devops
 * @description The one list of PROJECT-rooted `.claude/` paths git must never
 *   see: Claude Code's own session state, everything this plugin writes into a
 *   project's `.claude/`, and the per-clone settings file.
 *
 *   `ss.project.setup` writes it as a marked block into the clone's
 *   `.git/info/exclude` at every session start — local to the clone, shared
 *   by all its worktrees (git reads info/exclude from the common dir), never a
 *   diff in the repo. The plugin only writes these files where it runs, so the
 *   clone that runs it is exactly the scope that needs the entries.
 *   `scripts/check-claude-artifacts.js` fails the build when the plugin writes
 *   a project-rooted path this list does not cover.
 *
 *   Only PROJECT-rooted artifacts belong here. Home-rooted state
 *   (`~/.claude/claude-batch.json`, `usage-live.json`, `devops-concepts/`, …)
 *   can never dirty a repo. Plugin CONFIGURATION that a team shares
 *   (`settings.json`, `graphify.json`, skills, deep-knowledge) is tracked and
 *   never listed.
 */

/** Written by Claude Code itself into a project's `.claude/`. */
const CLAUDE_CODE_STATE = Object.freeze([
  '.claude/worktrees/',
  '.claude/todos/',
  '.claude/plans/',
  '.claude/projects/',
  '.claude/session-env/',
  '.claude/shell-snapshots/',
  '.claude/backups/',
  '.claude/telemetry/',
  '.claude/token-cache/',
  '.claude/.cache/',
  '.claude/*.log',
  '.claude/token-config.json',
  '.claude/concept-active.json',
  '.claude/concepts/',
  '.claude/session-opened-files.json',
]);

/** Written by the devops plugin (and adjacent MCP servers seen dirtying repos). */
const PLUGIN_STATE = Object.freeze([
  '.claude/batch-activity',
  '.claude/batch-assets/',
  '.claude/batch-mode.json',
  '.claude/batch-watchdog.lock',
  '.claude/batch.md',
  '.claude/strict-mode.json',
  '.claude/run-contract.json',
  '.claude/run-contract.events.jsonl',
  '.claude/run-contract.prev.json',
  '.claude/run-contract.pending',
  '.claude/batch-handoff.json',
  '.claude/.ship-in-progress',
  '.claude/.ship-lockout',
  '.claude/.ship-queue',
  '.claude/.ship-watcher/',
  '.claude/devops-config.json',
  '.claude/handoffs/',
  '.claude/devops-livebrief/',
  '.claude/scheduled_tasks.lock',
]);

const BLOCK_START = '# >>> devops-plugin runtime state';
const BLOCK_END = '# <<< devops-plugin runtime state';

/** Every entry, Claude Code state first. */
function allEntries() {
  return [...CLAUDE_CODE_STATE, ...PLUGIN_STATE];
}

/** The marked block as it is written into `.git/info/exclude`. */
function renderBlock() {
  return [
    `${BLOCK_START} — managed by the devops plugin (ss.project.setup), do not edit >>>`,
    '# Claude Code session state',
    ...CLAUDE_CODE_STATE,
    '# devops plugin runtime state and per-clone settings',
    ...PLUGIN_STATE,
    `${BLOCK_END} <<<`,
  ].join('\n');
}

/**
 * `text` with the marked block replaced in place, or appended when there is
 * none. Idempotent. The block is the first END and the last START before it:
 * a stray START without an END (a hand-damaged block) is left alone together
 * with every line after it — never guess where a broken block ends.
 * @param {string} text current file content ('' when absent)
 * @returns {string}
 */
function applyBlock(text) {
  const src = typeof text === 'string' ? text.replace(/\r\n/g, '\n') : '';
  const block = renderBlock();
  const lines = src.split('\n');
  const end = lines.findIndex((l) => l.startsWith(BLOCK_END));
  let start = -1;
  for (let i = 0; i < end; i++) if (lines[i].startsWith(BLOCK_START)) start = i;
  if (start !== -1) {
    return [...lines.slice(0, start), block, ...lines.slice(end + 1)].join('\n');
  }
  const body = src.replace(/\n*$/, '');
  return (body ? `${body}\n\n` : '') + block + '\n';
}

module.exports = {
  CLAUDE_CODE_STATE, PLUGIN_STATE, BLOCK_START, BLOCK_END,
  allEntries, renderBlock, applyBlock,
};
