'use strict';
/**
 * @module ui-files
 * @version 0.1.0
 * @plugin devops
 * @description The one UI-file detection (deep-knowledge/ui-defaults.md
 *   § UI file detection) and the project/user `## UI rules` override that
 *   widens or narrows it. Shared by post.design.remind (the reminder on a UI
 *   edit) and the run contract (Polish is owed only when UI files changed).
 *
 *   isUiFile(path, extraGlobs?)  → boolean
 *   loadOverride(cwd)            → { disable:Set, files:string[], extra:string[], delay }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveExtensionFile } = require('./skill-names');

const DEFAULT_UI_EXTENSIONS = [
  '.tsx', '.jsx', '.vue', '.svelte', '.html', '.css', '.scss', '.sass',
  '.less', '.razor', '.xaml', '.axaml',
  // Locale files carry the UI's text (R7 wording).
  '.po', '.arb', '.xlf', '.xliff', '.resx', '.strings',
];
const DEFAULT_UI_BASENAME_PATTERNS = [/\.styled\./i, /\.component\./i];
// Generic data formats count only inside a locale directory — a bare `.json`
// would make package.json a UI file.
const LOCALE_DIR_PATTERN = /(^|\/)(locales?|i18n|lang|translations)\/(.+\/)?[^/]+\.(json|ya?ml)$/i;

// Never UI: dependencies and Claude's own config. Concept pages are NOT
// excluded — the rules apply to them like to any other page.
// `.claude/worktrees/<name>/` is the container every Desktop session works
// in, not config: a `.claude/` segment followed by `worktrees/<name>/` does
// not exclude, while a worktree's own `.claude/…` still does.
const HARD_EXCLUDE_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)\.claude\/(?!worktrees\/[^/]+\/)/,
];
// Plugin source docs are not UI by default; an override `files:` glob that
// names one (the plugin's own concept templates, say) opts it back in.
const DEFAULT_EXCLUDE_PATTERNS = [
  /(^|\/)plugins\/[^/]+\/skills\//,
  /(^|\/)plugins\/[^/]+\/deep-knowledge\//,
];

// R1's two delay tiers (ms); `tooltip.delay:` in the override changes them.
const DEFAULT_TOOLTIP_DELAY = { info: 1500, label: 500 };

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
  if (LOCALE_DIR_PATTERN.test(lower)) return true;
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

module.exports = { isUiFile, loadOverride, parseUiRules, DEFAULT_TOOLTIP_DELAY };
