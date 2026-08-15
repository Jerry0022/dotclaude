#!/usr/bin/env node
/**
 * @hook pre.plugin.scope
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Edit|Write|NotebookEdit
 * @description Block hand-edits of installed devops plugin artifacts from a
 *   consumer project.
 *
 *   A plugin defect noticed while working in some other project belongs
 *   upstream as a GitHub issue — not patched into the local install. The
 *   install trees under ~/.claude/plugins/{cache,marketplaces,repos}/ are
 *   rewritten on every sync, so a hand-edit masks the real defect and is
 *   silently lost on the next update.
 *
 *   Bypass conditions (any one of them → exit 0):
 *     - Target is not under a managed plugin install tree
 *     - The current repo IS the plugin source repo (repairing/testing the
 *       local install is expected there)
 *     - DEVOPS_ALLOW_PLUGIN_EDIT=1 in environment
 *
 *   Rules: deep-knowledge/plugin-scope-routing.md
 */

require('../lib/plugin-guard');

const {
  managedPluginArtifact,
  gitTopLevel,
  isPluginSourceRepo,
  upstreamSlug,
} = require('../lib/plugin-scope');

function extractTargetPath(toolName, input) {
  if (!input) return null;
  if (toolName === 'Edit' || toolName === 'Write') return input.file_path || null;
  if (toolName === 'NotebookEdit') return input.notebook_path || null;
  return null;
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  const toolName = hook.tool_name || '';
  if (!['Edit', 'Write', 'NotebookEdit'].includes(toolName)) process.exit(0);

  const target = extractTargetPath(toolName, hook.tool_input || {});
  if (!target) process.exit(0);

  if (process.env.DEVOPS_ALLOW_PLUGIN_EDIT === '1') process.exit(0);

  const managed = managedPluginArtifact(target);
  if (!managed) process.exit(0);

  const cwd = hook.cwd || process.cwd();
  if (isPluginSourceRepo(gitTopLevel(cwd))) process.exit(0);

  const slug = upstreamSlug();

  process.stderr.write(
    `BLOCKED: '${target}' is an installed plugin artifact (~/.claude/plugins/${managed}/**).\n` +
    `Rule: this session is NOT the plugin source repo, so a plugin fix does not belong here.\n` +
    `      Managed install trees are overwritten on the next sync — the edit would be lost\n` +
    `      and the real defect would stay unfixed for every other project.\n` +
    `Fix: invoke the /setup-issue skill and file the defect against ${slug}\n` +
    `     ([BUG]/[FEAT], body = symptom + which skill/hook/agent + "captured from a session in <this project>").\n` +
    `     Anything that is genuinely about THIS project belongs in this project's own\n` +
    `     .claude/ instructions instead. See deep-knowledge/plugin-scope-routing.md.\n` +
    `Bypass (only when the user explicitly asked to patch the local install): set env DEVOPS_ALLOW_PLUGIN_EDIT=1.\n`
  );
  process.exit(2);
});
