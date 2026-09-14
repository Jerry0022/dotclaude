#!/usr/bin/env node
/**
 * @hook ss.knowledge.index
 * @version 0.2.0
 * @event SessionStart
 * @plugin devops
 * @description Inject deep-knowledge INDEX.md into context at session start,
 *   plus the always-on policy docs in full (ALWAYS_ON below). The index gives
 *   Claude awareness of all reference docs before message #1; the always-on
 *   docs are behavioral rules that must hold on every prompt — a pull-only
 *   reference would never flip the harness default they override (e.g. the
 *   agent delegation tiers). Fires on startup/clear/compact, skips resume.
 *   Uses run-once to prevent duplicate injection within a session.
 */

const { runOnce } = require('../lib/run-once');
const fs = require('fs');
const path = require('path');

/**
 * Deep-knowledge files injected IN FULL at every session start. Keep this
 * list short and each file small — the byte cap below is the hard guard.
 * `prompt.knowledge.dispatch` must NOT list these (they are already loaded).
 */
const ALWAYS_ON = ['agent-proactivity.md'];

// Hard limit on the always-on payload so a growing policy doc cannot bloat
// every session's preload. Files past the cap are skipped, index still goes.
const MAX_ALWAYS_ON_BYTES = 6144;

/**
 * Build the additionalContext string for a plugin root, or null when there
 * is nothing to inject. Pure — no session/run-once state — so tests can
 * pin the payload shape.
 */
function buildContext(pluginRoot) {
  const dkDir = path.join(pluginRoot, 'deep-knowledge');
  const indexPath = path.join(dkDir, 'INDEX.md');
  if (!fs.existsSync(indexPath)) return null;

  const blocks = [
    '[deep-knowledge] The following reference docs are available.',
    'Read individual files from deep-knowledge/ when a topic is relevant to the task.',
    '',
    fs.readFileSync(indexPath, 'utf8').trim(),
  ];

  let bytes = 0;
  for (const file of ALWAYS_ON) {
    const filePath = path.join(dkDir, file);
    let content;
    try { content = fs.readFileSync(filePath, 'utf8').trim(); }
    catch { continue; }
    const entryBytes = Buffer.byteLength(content, 'utf8');
    if (bytes + entryBytes > MAX_ALWAYS_ON_BYTES) continue;
    bytes += entryBytes;
    blocks.push(
      '',
      `[deep-knowledge always-on] deep-knowledge/${file} — a standing rule, in effect for every prompt:`,
      '',
      content,
    );
  }

  return blocks.join('\n');
}

function main() {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    let hook;
    try { hook = JSON.parse(inputData); }
    catch { process.exit(0); }

    // Skip on resume — index + policies are still in context from startup
    const source = hook.source || hook.trigger || '';
    if (source === 'resume') process.exit(0);

    // Run-once guard per session (reset on clear/compact via new session_id)
    if (!runOnce('ss-knowledge-index', hook.session_id)) process.exit(0);

    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
      || path.resolve(__dirname, '..', '..');
    const additionalContext = buildContext(pluginRoot);
    if (!additionalContext) process.exit(0);

    // Output as additionalContext (discrete injection, not visible in transcript)
    const output = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    };

    process.stdout.write(JSON.stringify(output));
  });
}

if (require.main === module) {
  require('../lib/plugin-guard');
  main();
}

module.exports = { buildContext, ALWAYS_ON, MAX_ALWAYS_ON_BYTES };
