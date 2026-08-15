#!/usr/bin/env node
/**
 * @hook prompt.plugin.scope
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Inject the scope-routing rule when a consumer project's session
 *   starts talking about the devops plugin itself.
 *
 *   Without this, a plugin defect noticed mid-session in some other project
 *   gets "fixed" right there — as a local workaround or a hand-edit of the
 *   installed copy — instead of becoming an upstream issue. The rule only
 *   reaches Claude when it is in context BEFORE the fix is attempted, so it
 *   is injected on the first plugin-flavored prompt of the session.
 *
 *   Silent when: the session IS the plugin source repo (direct fixes expected),
 *   the prompt carries no plugin signal, or the rule already fired this session.
 *
 *   Rules: deep-knowledge/plugin-scope-routing.md
 */

require('../lib/plugin-guard');

const fs = require('fs');
const { sessionFile, writeSessionFile } = require('../lib/session-id');
const { gitTopLevel, isPluginSourceRepo, upstreamSlug } = require('../lib/plugin-scope');

/**
 * Signals that the user is talking about the plugin, not their own code.
 * Deliberately narrow: bare "skill"/"hook"/"agent" are everyday words in most
 * projects, so they only count next to an explicit plugin marker.
 */
const PLUGIN_SIGNALS = [
  /\bdotclaude\b/i,
  /\bdevops[- ]?plugin\b/i,
  /\bdevops\s+(skill|hook|agent|command|mcp)\b/i,
  // Plugin slash commands, enumerated by name. A `/(setup|run|auto)-\w+`
  // wildcard would also swallow a project's own /run-tests or /setup-db.
  /(^|\s)\/(ship|commit|promote|fix|concept)\b/,
  /(^|\s)\/setup-(issue|project|readme|cleanup)\b/,
  /(^|\s)\/run-(agents|autonomous|backlog|burn)\b/,
  /(^|\s)\/tune-(harden|polish|rethink)\b/,
  /(^|\s)\/claude-(learn|lint|extend-skill)\b/,
  /(^|\s)\/auto-(update|usage|graph)\b/,
  /\bcompletion[- ]card\b/i,
  // Hook filenames: {event}.{domain}.{action}.js — action segments may be
  // hyphenated (prompt.flow.silent-turn.js, pre.worktree.split-guard.js).
  /\b(ss|pre|post|prompt|stop)\.[a-z-]+\.[a-z.-]+\.js\b/,
  /\bplugin\s+(cache|marketplace|install)\b/i,
  // Matches both the POSIX shorthand and a full Windows path
  // (C:\Users\me\.claude\plugins\…, %USERPROFILE%\.claude\plugins\…).
  /\.claude[/\\]plugins\b/i,
];

function hasPluginSignal(message) {
  if (typeof message !== 'string' || message.length === 0) return false;
  return PLUGIN_SIGNALS.some(re => re.test(message));
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  // `prompt` is what the runtime actually sends; the others are defensive.
  const message = hook.prompt || hook.user_message || hook.message || '';
  if (!hasPluginSignal(message)) process.exit(0);

  const cwd = hook.cwd || process.cwd();
  const repoRoot = gitTopLevel(cwd);

  // Plugin source repo → direct implementation is the correct route, no nudge.
  if (isPluginSourceRepo(repoRoot)) process.exit(0);

  const marker = sessionFile('dotclaude-devops-scope-routed', hook.session_id);
  try { if (fs.existsSync(marker)) process.exit(0); } catch {}
  try { writeSessionFile(marker, '1'); } catch {}

  const slug = upstreamSlug();
  const project = repoRoot || cwd;

  process.stdout.write(
    `This session is a CONSUMER of the devops plugin (${project}), not its source repo. ` +
    `Scope routing is therefore mandatory before any fix:\n` +
    `1. Defect/gap in the devops plugin itself (skill, hook, agent, MCP server, ` +
    `convention, installed copy under ~/.claude/plugins/**) → do NOT fix it here and ` +
    `do NOT hand-edit the installed copy. Invoke the /setup-issue skill and file it ` +
    `against ${slug}: [BUG] for a defect, [FEATURE] for a gap, body = symptom + affected ` +
    `plugin part + "Captured from a session in ${project}." + a mandatory ` +
    `"**User value:**" line (setup-issue rejects issues without one).\n` +
    `2. Anything about THIS project (its build, architecture, conventions, or a ` +
    `deliberate deviation from a plugin default) → persist it in this project's own ` +
    `.claude/ instructions (deep-knowledge > skill extension > CLAUDE.md).\n` +
    `Read deep-knowledge/plugin-scope-routing.md before deciding if the split is unclear. ` +
    `Do not surface this note as its own message — apply it when routing the work.\n`
  );
});

module.exports = { hasPluginSignal, PLUGIN_SIGNALS };
