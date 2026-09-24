#!/usr/bin/env node
/**
 * @script check-claude-artifacts
 * @description Fail when the plugin writes a PROJECT-rooted `.claude/` file that
 *   the `/setup-project` ignore block does not cover (issue #292).
 *
 *   Without this, every plugin release that starts writing a new artifact
 *   silently dirties every repo that installs it — the user finds out at their
 *   next commit, adds one line by hand, and the next release does it again. The
 *   ignore list only stays complete if completeness is checked.
 *
 *   Scope is deliberately narrow: only paths built from the PROJECT's `.claude/`
 *   (`claudeDir(cwd)`, `join(cwd, '.claude', …)`). Home-rooted state
 *   (`os.homedir()/.claude/…`) can never dirty a repo and must NOT be listed —
 *   see setup-project/SKILL.md § 2.2.
 *
 *   Second check: a runtime artifact must be anchored at the REPO ROOT
 *   (hooks/lib/project-root.js), never joined onto the raw cwd. Hooks get the
 *   session's current cwd, which follows every `cd` — a cwd-rooted writer
 *   drops `<subdir>/.claude/<file>` wherever the session happens to stand, and
 *   the root-anchored ignore entries do not cover it.
 *
 * Usage: node plugins/devops/scripts/check-claude-artifacts.js [repoRoot]
 * Exit 0 = every project-rooted artifact is covered and anchored, 1 = gaps found.
 */

const fs = require('fs');
const path = require('path');

const BLOCK_START = '# >>> devops-plugin runtime state';
const BLOCK_END = '# <<< devops-plugin runtime state';

/** Directories whose sources are scanned for artifact writes. */
const SCAN_DIRS = ['hooks', 'scripts', 'mcp-server'];

/**
 * Paths the scan cannot see because they are named only in skill prose (the
 * skill instructs Claude to create them rather than calling fs itself). Listed
 * explicitly so the guard stays honest about what it does and does not detect.
 */
const PROSE_DECLARED = ['.ship-lockout', '.ship-queue'];

/**
 * Names that are configuration or authored content, never runtime state — they
 * are tracked on purpose, so their absence from the ignore list is correct.
 */
const NOT_RUNTIME = new Set([
  'settings.json', 'settings.local.json', 'graphify.json', 'CLAUDE.md',
  'project-map.md', 'agents.json', 'launch.json',
  'skills', 'commands', 'hooks', 'agents', 'deep-knowledge',
]);

/**
 * Runtime artifacts that are keyed to the SESSION cwd on purpose, not the repo
 * root: the /auto-concept skill writes its state file into `{session-cwd}/.claude/`
 * and every reader must look in that same place (concept/SKILL.md § state
 * file). Anything else joined onto the raw cwd is a finding.
 */
const CWD_ANCHORED_BY_DESIGN = new Set(['concept-active.json', 'concepts']);

/**
 * Every `.claude/` entry the skill tells a project to ignore — the generic
 * Claude Code state list AND the plugin's marked block. Coverage is coverage:
 * an artifact already handled by the generic list must not be reported as a
 * gap just because it predates the marked block.
 */
function readCoveredEntries(skillPath) {
  const text = fs.readFileSync(skillPath, 'utf8');
  if (!text.includes(BLOCK_START) || !text.includes(BLOCK_END)) return null;
  const out = [];
  for (const m of text.matchAll(/```gitignore\n([\s\S]*?)```/g)) {
    for (const raw of m[1].split('\n')) {
      const l = raw.trim();
      if (!l || l.startsWith('#') || !l.startsWith('.claude/')) continue;
      out.push(l.replace(/^\.claude\//, '').replace(/\/$/, ''));
    }
  }
  return out;
}

/** Does any ignore entry cover `name`? Supports the `*.log` style wildcard. */
function isCovered(name, entries) {
  return entries.some(e => {
    if (e === name) return true;
    if (!e.includes('*')) return false;
    const rx = new RegExp('^' + e.split('*').map(s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
    return rx.test(name);
  });
}

/**
 * Collect basenames written under the PROJECT's `.claude/`. Matches the three
 * shapes the codebase actually uses (`claudeDir(…)`, `join(cwd, '.claude', …)`,
 * `join(projectRoot(…), '.claude', …)`); a home-rooted join reads as
 * `homedir(), '.claude'` and is skipped by the negative lookbehind on the line.
 */
function scanArtifacts(pluginRoot) {
  const found = new Map(); // name → first file that writes it
  const projectJoin = /claudeDir\([^)]*\)\s*,\s*['"]([^'"]+)['"]/g;
  const cwdJoin = /join\(\s*cwd\s*,\s*['"]\.claude['"]\s*,\s*['"]([^'"]+)['"]/g;
  const rootJoin = /join\(\s*projectRoot\([^)]*\)\s*,\s*['"]\.claude['"]\s*,\s*['"]([^'"]+)['"]/g;

  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.js') || e.name.endsWith('.test.js')) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const re of [projectJoin, cwdJoin, rootJoin]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src)) !== null) {
          const name = m[1].replace(/\/$/, '');
          if (!name || name.includes('${') || NOT_RUNTIME.has(name)) continue;
          if (!found.has(name)) found.set(name, path.relative(pluginRoot, p));
        }
      }
    }
  };

  for (const d of SCAN_DIRS) walk(path.join(pluginRoot, d));
  return found;
}

/**
 * Find `.claude/` paths joined onto the raw cwd (`join(cwd, '.claude'…)`,
 * `join(cwd || process.cwd(), '.claude')`, `join(process.cwd(), '.claude'…)`).
 * A bare directory join is always reported — it is the helper shape
 * (`claudeDir(cwd)`) every runtime writer then builds on. A join naming a file
 * is reported unless that file is configuration (NOT_RUNTIME) or cwd-keyed by
 * design (CWD_ANCHORED_BY_DESIGN).
 * @returns {Array<{file:string,name:string}>}
 */
function scanUnanchored(pluginRoot) {
  const out = [];
  const re = /join\(\s*(?:cwd|process\.cwd\(\))(?:\s*\|\|\s*process\.cwd\(\))?\s*,\s*['"]\.claude['"]\s*(?:,\s*['"]([^'"]+)['"])?/g;
  const self = path.resolve(__filename);
  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!e.name.endsWith('.js') || e.name.endsWith('.test.js') || path.resolve(p) === self) continue;
      const src = fs.readFileSync(p, 'utf8');
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        const name = m[1] ? m[1].replace(/\/$/, '') : '';
        if (name && (NOT_RUNTIME.has(name) || CWD_ANCHORED_BY_DESIGN.has(name))) continue;
        out.push({ file: path.relative(pluginRoot, p), name: name || '(directory)' });
      }
    }
  };
  for (const d of SCAN_DIRS) walk(path.join(pluginRoot, d));
  return out;
}

function main() {
  const repoRoot = process.argv[2] || path.resolve(__dirname, '..', '..', '..');
  const pluginRoot = path.join(repoRoot, 'plugins', 'devops');
  const skillPath = path.join(pluginRoot, 'skills', 'setup-project', 'SKILL.md');

  const listed = readCoveredEntries(skillPath);
  if (listed === null) {
    console.error('[check-claude-artifacts] ignore block markers not found in setup-project/SKILL.md');
    process.exit(1);
  }

  const found = scanArtifacts(pluginRoot);
  for (const name of PROSE_DECLARED) found.set(name, '(declared in skill prose)');

  const missing = [...found.entries()].filter(([name]) => !isCovered(name, listed));
  const unanchored = scanUnanchored(pluginRoot);
  if (missing.length === 0 && unanchored.length === 0) {
    console.log(`[check-claude-artifacts] OK — ${found.size} project-rooted artifact(s) all covered and anchored`);
    process.exit(0);
  }

  if (missing.length) {
    console.error('[check-claude-artifacts] Project-rooted .claude/ artifacts missing from the');
    console.error('  /setup-project ignore block (setup-project/SKILL.md § 2.2):');
    for (const [name, src] of missing) console.error(`  .claude/${name}   ← written by ${src}`);
    console.error('\nAdd them to the marked block, or the next release dirties every consumer repo.');
  }
  if (unanchored.length) {
    console.error('[check-claude-artifacts] .claude/ paths joined onto the raw cwd — a session in a');
    console.error('  subdirectory scatters untracked <subdir>/.claude/ files:');
    for (const u of unanchored) console.error(`  ${u.file}   → .claude/${u.name}`);
    console.error('\nAnchor them with projectRoot()/projectClaudeDir() from hooks/lib/project-root.js.');
  }
  process.exit(1);
}

if (require.main === module) main();

module.exports = {
  readCoveredEntries, isCovered, scanArtifacts, scanUnanchored,
  CWD_ANCHORED_BY_DESIGN, BLOCK_START, BLOCK_END,
};
