#!/usr/bin/env node
/**
 * @hook post.design.remind
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Edit|Write
 * @description Once per session, when a UI file is written or edited,
 *   reminds Claude of the standing UI rules (deep-knowledge/ui-defaults.md)
 *   so tooltip, dropdown, spacing and hotkey conventions are in context
 *   while the element is written — not only measured afterwards by
 *   `/tune-polish`. Honours a project/user override
 *   (`.claude/skills/tune-polish/reference.md` § "## UI rules") that can
 *   disable rules and widen the UI-file detection. Never blocks: every
 *   failure path exits 0 silently.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const os = require('os');
const { sessionFile, readSessionFile, writeSessionFile } = require('../lib/session-id');

const DEFAULT_UI_EXTENSIONS = [
  '.tsx', '.jsx', '.vue', '.svelte', '.html', '.css', '.scss', '.sass',
  '.less', '.razor', '.xaml', '.axaml',
];
const DEFAULT_UI_BASENAME_PATTERNS = [/\.styled\./i, /\.component\./i];

const EXCLUDE_PATTERNS = [
  /(^|\/)docs\/concepts\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.claude\//,
  /(^|\/)plugins\/[^/]+\/skills\//,
  /(^|\/)plugins\/[^/]+\/deep-knowledge\//,
];

const RULES = [
  { id: 'R1', text: 'tooltips on icon-only controls (delay 300-700 ms)' },
  { id: 'R2a', text: "dropdowns styled with the app's tokens, not native" },
  { id: 'R2b', text: 'uniform item structure within a menu' },
  { id: 'R3', text: 'same component type -> same spacing tokens as siblings' },
  { id: 'R4', text: 'every interaction has a hotkey shown discreetly in the control or tooltip' },
];

function normalize(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function isExcluded(filePath) {
  const norm = normalize(filePath);
  return EXCLUDE_PATTERNS.some(re => re.test(norm));
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
  if (isExcluded(filePath)) return false;
  const norm = normalize(filePath);
  const lower = norm.toLowerCase();
  const basename = path.posix.basename(lower);

  if (DEFAULT_UI_EXTENSIONS.some(ext => lower.endsWith(ext))) return true;
  if (DEFAULT_UI_BASENAME_PATTERNS.some(re => re.test(basename))) return true;
  if ((extraGlobs || []).some(g => matchesExtraGlob(norm, g))) return true;
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
    if (bullet) extra.push(bullet);
  }

  return { disable, files, extra };
}

function loadOverride(cwd) {
  const projectPath = path.join(cwd, '.claude', 'skills', 'tune-polish', 'reference.md');
  const userPath = path.join(os.homedir(), '.claude', 'skills', 'tune-polish', 'reference.md');

  const project = parseUiRules(readUiRulesSection(projectPath));
  const user = parseUiRules(readUiRulesSection(userPath));

  const disable = new Set([...project.disable, ...user.disable]);
  const files = [...project.files, ...user.files];
  const extra = [...project.extra, ...user.extra];

  return { disable, files, extra };
}

function buildReminder(disable, extra) {
  const lines = [];
  lines.push(
    '[ui-defaults] UI file touched — standing UI rules apply to the elements you are writing (deep-knowledge/ui-defaults.md):'
  );
  const enabled = RULES.filter(r => !disable.has(r.id));
  for (const r of enabled) {
    lines.push(`${r.id} ${r.text}`);
  }
  for (const line of extra) {
    lines.push(line);
  }
  const disabledIds = RULES.filter(r => disable.has(r.id)).map(r => r.id);
  if (disabledIds.length > 0) {
    lines.push(`disabled by project override: ${disabledIds.join(', ')}`);
  }
  lines.push('Read deep-knowledge/ui-defaults.md for the full rules and the detection allowlist.');
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

      process.stdout.write(buildReminder(override.disable, override.extra));
      process.exit(0);
    } catch {
      process.exit(0);
    }
  });
}

main();
