#!/usr/bin/env node
/**
 * @hook post.design.remind
 * @version 0.3.1
 * @event PostToolUse
 * @plugin devops
 * @matcher Edit|Write
 * @description Once per session, when a UI file is written or edited,
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
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const os = require('os');
const { sessionFile, readSessionFile, writeSessionFile } = require('../lib/session-id');
const { resolveExtensionFile } = require('../lib/skill-names');
const { deepKnowledgePath } = require('../lib/plugin-root');

const DEFAULT_UI_EXTENSIONS = [
  '.tsx', '.jsx', '.vue', '.svelte', '.html', '.css', '.scss', '.sass',
  '.less', '.razor', '.xaml', '.axaml',
];
const DEFAULT_UI_BASENAME_PATTERNS = [/\.styled\./i, /\.component\./i];

// Never UI: dependencies and Claude's own config. Concept pages are NOT
// excluded — the rules apply to them like to any other page.
const HARD_EXCLUDE_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)\.claude\//,
];
// Plugin source docs are not UI by default; an override `files:` glob that
// names one (the plugin's own concept templates, say) opts it back in.
const DEFAULT_EXCLUDE_PATTERNS = [
  /(^|\/)plugins\/[^/]+\/skills\//,
  /(^|\/)plugins\/[^/]+\/deep-knowledge\//,
];

// R1's two delay tiers (ms); `tooltip.delay:` in the override changes them.
const DEFAULT_TOOLTIP_DELAY = { info: 1500, label: 500 };

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

function normalize(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function globToRegex(glob) {
  const PLACEHOLDER = '@@DOUBLESTAR@@';
  const norm = glob.replace(/\\/g, '/');
  const escaped = norm.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withDouble = escaped.replace(/\*\*/g, PLACEHOLDER);
  const withSingle = withDouble.replace(/\*/g, '[^/]*');
  const restored = withSingle.split(PLACEHOLDER).join('.*');
  return new RegExp(restored + '$');
}

function matchesExtraGlob(filePath, glob) {
  const norm = normalize(filePath);
  const g = String(glob || '').trim();
  if (!g) return false;
  // Plain extension: no glob chars, no path separator (".ts").
  if (g.startsWith('.') && !g.includes('*') && !g.includes('/')) {
    return norm.toLowerCase().endsWith(g.toLowerCase());
  }
  try {
    return globToRegex(g).test(norm);
  } catch {
    return false;
  }
}

function isUiFile(filePath, extraGlobs) {
  if (!filePath) return false;
  const norm = normalize(filePath);
  if (HARD_EXCLUDE_PATTERNS.some(re => re.test(norm))) return false;
  if ((extraGlobs || []).some(g => matchesExtraGlob(norm, g))) return true;
  if (DEFAULT_EXCLUDE_PATTERNS.some(re => re.test(norm))) return false;
  const lower = norm.toLowerCase();
  const basename = path.posix.basename(lower);

  if (DEFAULT_UI_EXTENSIONS.some(ext => lower.endsWith(ext))) return true;
  if (DEFAULT_UI_BASENAME_PATTERNS.some(re => re.test(basename))) return true;
  return false;
}

/**
 * Extract the "## UI rules" section from a reference.md, returning its
 * bullet lines (without the leading "- "), or [] when the file/section is
 * absent.
 */
function readUiRulesSection(mdPath) {
  let content;
  try { content = fs.readFileSync(mdPath, 'utf8'); }
  catch { return []; }

  const lines = content.split(/\r?\n/);
  const startIdx = lines.findIndex(l => /^##\s+UI rules\s*$/i.test(l.trim()));
  if (startIdx === -1) return [];

  const bullets = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line.trim())) break;
    const m = line.match(/^\s*-\s+(.*)$/);
    if (m) bullets.push(m[1].trim());
  }
  return bullets;
}

/**
 * Strip an inline "  # comment" trailer from a bullet line, without
 * touching a leading "#" that is part of the content itself.
 */
function stripInlineComment(text) {
  const idx = text.search(/\s#/);
  if (idx === -1) return text.trim();
  return text.slice(0, idx).trim();
}

function parseUiRules(bullets) {
  const disable = new Set();
  const files = [];
  const extra = [];
  const delay = {};

  for (const raw of bullets) {
    const bullet = stripInlineComment(raw);
    const disableMatch = bullet.match(/^disable:\s*(.*)$/i);
    if (disableMatch) {
      disableMatch[1].split(',').map(s => s.trim()).filter(Boolean)
        .forEach(id => disable.add(id));
      continue;
    }
    const filesMatch = bullet.match(/^files:\s*(.*)$/i);
    if (filesMatch) {
      filesMatch[1].split(',').map(s => s.trim()).filter(Boolean)
        .forEach(g => files.push(g));
      continue;
    }
    const delayMatch = bullet.match(/^tooltip\.delay:\s*(.*)$/i);
    if (delayMatch) {
      const info = delayMatch[1].match(/\binfo\s*[:=]?\s*(\d+)/i);
      const label = delayMatch[1].match(/\blabel\s*[:=]?\s*(\d+)/i);
      if (info) delay.info = Number(info[1]);
      if (label) delay.label = Number(label[1]);
      continue;
    }
    if (bullet) extra.push(bullet);
  }

  return { disable, files, extra, delay };
}

function loadOverride(cwd) {
  // New extension dir first, the pre-PR-2 `tune-polish` dir as fallback.
  const projectPath = resolveExtensionFile(cwd, 'auto-polish', 'reference.md');
  const userPath = resolveExtensionFile(os.homedir(), 'auto-polish', 'reference.md');

  const project = parseUiRules(readUiRulesSection(projectPath));
  const user = parseUiRules(readUiRulesSection(userPath));

  const disable = new Set([...project.disable, ...user.disable]);
  const files = [...project.files, ...user.files];
  const extra = [...project.extra, ...user.extra];
  // Delay values are settings, not additive rules: project beats user-global.
  const delay = { ...DEFAULT_TOOLTIP_DELAY, ...user.delay, ...project.delay };

  return { disable, files, extra, delay };
}

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
  return lines.join('\n') + '\n';
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

      const markerFile = sessionFile('dotclaude-devops-design-reminded', hook.session_id);
      const already = readSessionFile('dotclaude-devops-design-reminded', hook.session_id, { exact: true });
      if (already) process.exit(0);

      try { writeSessionFile(markerFile, '1'); } catch {}

      process.stdout.write(buildReminder(override.disable, override.extra, override.delay));
      process.exit(0);
    } catch {
      process.exit(0);
    }
  });
}

main();
