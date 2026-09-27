#!/usr/bin/env node
/**
 * @hook post.design.remind
 * @version 0.4.2
 * @event PostToolUse
 * @plugin devops
 * @matcher Edit|Write
 * @description Once per context, when a UI file is written or edited,
 *   reminds Claude of the standing UI rules (deep-knowledge/ui-defaults.md)
 *   so the app-style, tooltip, dropdown, spacing, hotkey and scrollbar
 *   conventions are in context while the element is written — not only
 *   measured afterwards by `/auto-polish`. Honours a project/user override
 *   (`.claude/skills/auto-polish/reference.md` § "## UI rules", falling back
 *   to the pre-PR-2 `.claude/skills/tune-polish/` dir) that can
 *   disable rules, widen the UI-file detection (a `files:` glob also opts in
 *   plugin source that is excluded by default) and change the two tooltip
 *   delay tiers. Concept pages get the reminder like any other page. Never
 *   blocks: every failure path exits 0 silently.
 *
 *   The reminder goes out as `hookSpecificOutput.additionalContext`: plain
 *   stdout of a PostToolUse hook only shows in transcript mode and never
 *   reaches the model (CONVENTIONS.md), so before 0.4.0 it was never read.
 *   Delivered, it stays in the context for the rest of the session, so each
 *   context gets it once: the main thread and every subagent (`agent_id`) on
 *   their own first UI edit.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const { sessionFile } = require('../lib/session-id');
const { isUiFile, loadOverride, DEFAULT_TOOLTIP_DELAY } = require('../lib/ui-files');
const { deepKnowledgePath } = require('../lib/plugin-root');

const RULES = [
  { id: 'R0', text: "app style everywhere: every element in the app's tokens (surface, border, radius, type, shadow, motion) in every theme, never the browser/OS default look; part of every rule, project rules included" },
  { id: 'R1', text: (d) => `tooltips through the app's styled tooltip component, never a native title; delay Info ${d.info} ms (default), Label ${d.label} ms only when the tooltip is the only name, shows cut-off content or explains a disabled control; instant on keyboard focus and within 300 ms of the previous tooltip` },
  { id: 'R2a', text: "dropdowns styled with the app's tokens, not native" },
  { id: 'R2b', text: 'uniform item structure within a menu' },
  { id: 'R3', text: 'same component type -> same spacing tokens as siblings' },
  { id: 'R4', text: 'every interaction has a hotkey shown discreetly in the control or tooltip' },
  { id: 'R5', text: 'scrollbars styled once, globally, from tokens (scrollbar-color/-width, ::-webkit-scrollbar fallback, color-scheme per theme); no local divergence' },
  { id: 'R6', text: 'platform matrix: design, UX and function checked on Windows + Linux desktop, Android + iOS tablet, Android + iOS phone; no hover/right-click/shortcut-only action without a touch path, no 100vh, safe-area insets, fonts with generic fallback' },
];

function buildReminder(disable, extra, delay = DEFAULT_TOOLTIP_DELAY, docPath = deepKnowledgePath('ui-defaults.md')) {
  const lines = [];
  lines.push(
    `[ui-defaults] UI file touched — standing UI rules apply to the elements you are writing (${docPath}):`
  );
  const enabled = RULES.filter(r => !disable.has(r.id));
  for (const r of enabled) {
    const text = typeof r.text === 'function' ? r.text(delay) : r.text;
    lines.push(`${r.id} ${text}`);
  }
  for (const line of extra) {
    lines.push(line);
  }
  const disabledIds = RULES.filter(r => disable.has(r.id)).map(r => r.id);
  if (disabledIds.length > 0) {
    lines.push(`disabled by project override: ${disabledIds.join(', ')}`);
  }
  // Absolute path: a relative `deep-knowledge/…` does not exist in a consumer
  // project, and the model then searched `/` for it (2026-09-24).
  lines.push(`Read ${docPath} for the full rules and the detection allowlist.`);
  return lines.join('\n');
}

function main() {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      let hook;
      try { hook = JSON.parse(inputData); }
      catch { process.exit(0); }

      const toolName = hook.tool_name || '';
      if (toolName !== 'Edit' && toolName !== 'Write') process.exit(0);

      const filePath = (hook.tool_input && hook.tool_input.file_path) || null;
      if (!filePath) process.exit(0);

      const cwd = hook.cwd || process.cwd();
      const override = loadOverride(cwd);

      if (!isUiFile(filePath, override.files)) process.exit(0);

      // Once per context: a delivered reminder stays there for the rest of
      // the session. A subagent is its own context — its copy never reaches
      // the main thread, so it must not spend the main thread's (keyed like
      // post.flow.debug). The exclusive create is the claim: parallel UI edits
      // run this hook side by side, and only one of them may send it. A marker
      // that cannot be written sends nothing — never the same text every call.
      const contextKey = hook.agent_id ? `${hook.session_id || 'unknown'}-agent-${hook.agent_id}` : hook.session_id;
      try {
        fs.writeFileSync(sessionFile('dotclaude-devops-design-reminded', contextKey), '1', { flag: 'wx' });
      } catch {
        process.exit(0);
      }

      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: buildReminder(override.disable, override.extra, override.delay),
        },
      }));
      process.exit(0);
    } catch {
      process.exit(0);
    }
  });
}

main();
