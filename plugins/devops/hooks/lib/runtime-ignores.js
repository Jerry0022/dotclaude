'use strict';
/**
 * @module runtime-ignores
 * @version 1.0.0
 * @plugin devops
 * @description The canonical `.claude` ignore policy of a project, and the one
 *   marked block that carries it in the repo's `.gitignore`:
 *
 *     # >>> claude (managed) >>>
 *     …
 *     # <<< claude (managed) <<<
 *
 *   VERSIONED (never ignored): CLAUDE.md, .claude/settings.json, .claude/skills/
 *   commands/ hooks/ agents/ deep-knowledge/, .claude/project-map.md,
 *   .claude/launch.example.json, docs/concepts/.
 *   LOCAL (the block): Claude Code's session state, the per-clone settings
 *   (settings.local.json, launch.json, devops-config.json) and every runtime
 *   file this plugin writes into a project's `.claude/`.
 *
 *   The block lives in `.gitignore` — visible, reviewed, and effective for
 *   every clone and collaborator, with or without the plugin. Earlier plugin
 *   versions wrote it into `.git/info/exclude`; `migrate()` moves a repo over:
 *   one current block in `.gitignore`, hand-grown duplicates of its entries
 *   removed there, the plugin's lines removed from `info/exclude`.
 *   `scripts/claude-ignore.js` is the CLI; ship_preflight checks the block
 *   when a ship touches `.gitignore` or `.claude/`;
 *   `scripts/check-claude-artifacts.js` fails the build when the plugin writes
 *   a project-rooted path these lists do not cover.
 *
 *   Entries are written as `**\/.claude/<name>` so a `.claude/` a session
 *   creates in a subfolder (cwd-keyed /auto-concept state, a plugin dir used
 *   as cwd) is covered as well. Home-rooted state (`~/.claude/…`) can never
 *   dirty a repo and is not listed.
 */

/** Written by Claude Code itself into a project's `.claude/`. */
const CLAUDE_CODE_STATE = Object.freeze([
  '.claude/worktrees/',
  '.claude/todos/',
  '.claude/plans/',
  '.claude/projects/',
  '.claude/session-env/',
  '.claude/sessions/',
  '.claude/shell-snapshots/',
  '.claude/backups/',
  '.claude/telemetry/',
  '.claude/token-cache/',
  '.claude/cache/',
  '.claude/.cache/',
  '.claude/*.log',
  '.claude/token-config.json',
  '.claude/concept-active.json',
  '.claude/concepts/',
  '.claude/session-opened-files.json',
  '.claude/scheduled_tasks.lock',
  '.claude/scheduled_tasks.json',
  '.claude/routines/.state/',
  '.claude/checkpoints/',
  '.claude/mailbox/',
  '.claude/agent-registry.json',
  '.claude/agent-memory-local',
  '.claude/first-run',
  '.claude/assistant-daemon-state.json',
]);

/** Per clone / per machine — never shared. */
const LOCAL_SETTINGS = Object.freeze([
  '.claude/settings.local.json',
  '.claude/launch.json',
  '.claude/devops-config.json',
]);

/** Written by the devops plugin (and adjacent MCP servers seen dirtying repos). */
const PLUGIN_STATE = Object.freeze([
  '.claude/batch-activity',
  '.claude/batch-assets/',
  '.claude/batch-mode.json',
  '.claude/batch-watchdog.lock',
  '.claude/batch.md',
  // AUD-C023: archived collections (batch-state archiveNotes) and the
  // web-guide's active flag (scripts/guide-active-state.js).
  '.claude/batch-*.md',
  '.claude/auto-guide-active.json',
  '.claude/strict-mode.json',
  '.claude/run-contract.json',
  // AUD-016: the store's siblings of the header — the `.lock` mutex, its
  // `.lock.stale-<pid>-<rand>` takeover leftovers, the quarantined
  // `.corrupt-<ts>-<pid>-<rand>` copies and the `.corrupt.pending` marker.
  '.claude/run-contract.json.*',
  '.claude/run-contract.events.jsonl',
  '.claude/run-contract.prev.json',
  '.claude/run-contract.pending',
  '.claude/run-task.md',
  '.claude/runs/',
  '.claude/batch-handoff.json',
  '.claude/.ship-in-progress',
  '.claude/.ship-checkpoint.json',
  '.claude/.ship-lockout',
  '.claude/.ship-queue',
  '.claude/.ship-watcher/',
  '.claude/handoffs/',
  '.claude/devops-livebrief/',
  '.claude/audit/',
  '.claude/rethink/',
  '.claude/local-llm/',
  // AUD-013: writeJsonAtomic's temp files (`.claude/<name>.<pid>.<rand>.tmp`)
  // — a hook killed between write and rename leaves one behind.
  '.claude/*.tmp',
]);

/** Tracked on purpose — a block or a hand-written line that ignores one of these is a policy deviation. */
const VERSIONED = Object.freeze([
  'CLAUDE.md',
  '.claude/settings.json',
  '.claude/skills/',
  '.claude/commands/',
  '.claude/hooks/',
  '.claude/agents/',
  '.claude/deep-knowledge/',
  '.claude/project-map.md',
  '.claude/launch.example.json',
  'docs/concepts/',
]);

const BLOCK_START = '# >>> claude (managed) >>>';
const BLOCK_END = '# <<< claude (managed) <<<';
/** Marker prefixes of the earlier plugin block (`.gitignore` by /setup-project, `info/exclude` by ss.project.setup). */
const LEGACY_START = '# >>> devops-plugin runtime state';
const LEGACY_END = '# <<< devops-plugin runtime state';
/** Header Claude Code puts above its own lines in `info/exclude`. */
const CLAUDE_CODE_EXCLUDE_HEADER = '# claude-code-runtime';

/** Every LOCAL entry, as `.claude/<name>`: Claude Code state, per-clone settings, plugin state. */
function allEntries() {
  return [...CLAUDE_CODE_STATE, ...LOCAL_SETTINGS, ...PLUGIN_STATE];
}

/** `.claude/x` → the line written into the block. */
function toLine(entry) {
  return `**/${entry}`;
}

/** The marked block as it is written into `.gitignore`. */
function renderBlock() {
  return [
    BLOCK_START,
    '# Managed by the devops plugin — rewrite with `node <devops-plugin>/scripts/claude-ignore.js migrate`, do not edit.',
    '# Versioned on purpose: CLAUDE.md, .claude/settings.json, .claude/{skills,commands,hooks,agents,deep-knowledge}/,',
    '# .claude/project-map.md, .claude/launch.example.json, docs/concepts/.',
    '# Claude Code session state',
    ...CLAUDE_CODE_STATE.map(toLine),
    '# Per-clone settings',
    ...LOCAL_SETTINGS.map(toLine),
    '# devops plugin runtime state',
    ...PLUGIN_STATE.map(toLine),
    BLOCK_END,
  ].join('\n');
}

function lf(text) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n') : '';
}

/**
 * A gitignore pattern reduced to compare against the policy: `/`, `**\/`
 * prefixes and a trailing `/` dropped. null for comments, blanks, negations.
 */
function normalizePattern(line) {
  const t = String(line).trim();
  if (!t || t.startsWith('#') || t.startsWith('!')) return null;
  return t.replace(/^\/+/, '').replace(/^(\*\*\/)+/, '').replace(/\/+$/, '');
}

const COVERED = new Set(allEntries().map((e) => normalizePattern(e)));

/** Is `line` one of the block's own entries in another spelling? */
function isBlockEntry(line) {
  const n = normalizePattern(line);
  return n !== null && COVERED.has(n);
}

/** Every [start, end] line range of blocks marked by `startPrefix` … `endPrefix`; a START without END is no block. */
function blockRanges(lines, startPrefix, endPrefix) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(startPrefix)) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith(endPrefix) && !lines[j].startsWith(startPrefix)) j++;
    if (j < lines.length && lines[j].startsWith(endPrefix)) {
      out.push([i, j]);
      i = j;
    }
  }
  return out;
}

/** Lines with the given ranges removed, plus the index of the first removed line (-1 when none). */
function cut(lines, ranges) {
  const drop = new Set();
  for (const [a, b] of ranges) for (let i = a; i <= b; i++) drop.add(i);
  return { kept: lines.filter((_, i) => !drop.has(i)), first: ranges.length ? Math.min(...ranges.map((r) => r[0])) : -1 };
}

function tidy(lines) {
  const out = [];
  for (const l of lines) {
    if (l.trim() === '' && out.length && out[out.length - 1].trim() === '') continue;
    out.push(l);
  }
  while (out.length && out[0].trim() === '') out.shift();
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

function join(lines) {
  const t = tidy(lines);
  return t.length ? t.join('\n') + '\n' : '';
}

const PLACEHOLDER = '\u0000claude-managed-block';
const CLAUDE_COMMENT = /claude|\bai\b|devops|plugin|session|runtime/i;

/**
 * Remove `isClaudeLine` lines. A paragraph (lines between blank lines) whose
 * every pattern line goes loses its Claude-ish comments too (CLAUDE_COMMENT),
 * so no orphaned "# AI tooling" header stays behind; other comments stay.
 * The first removed line becomes PLACEHOLDER.
 * @returns {{kept:string[], removed:string[]}}
 */
function dropLines(lines, isClaudeLine) {
  const removed = [];
  const drop = new Set();
  let first = -1;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    let j = i;
    while (j < lines.length && lines[j].trim() !== '') j++;
    const patterns = [];
    const hits = [];
    for (let k = i; k < j; k++) {
      if (lines[k] === PLACEHOLDER || lines[k].trim().startsWith('#')) continue;
      patterns.push(k);
      if (isClaudeLine(lines[k])) hits.push(k);
    }
    if (hits.length) {
      const whole = hits.length === patterns.length;
      for (let k = i; k < j; k++) {
        if (lines[k] === PLACEHOLDER) continue;
        const isComment = lines[k].trim().startsWith('#');
        if (hits.includes(k) || (whole && isComment && CLAUDE_COMMENT.test(lines[k]))) drop.add(k);
      }
      if (first === -1) first = whole ? i : hits[0];
      for (const k of hits) removed.push(lines[k].trim());
    }
    i = j;
  }
  const kept = [];
  lines.forEach((l, k) => {
    if (k === first) kept.push(PLACEHOLDER);
    if (!drop.has(k)) kept.push(l);
  });
  return { kept, removed };
}

/** Insert `block` (string) at `index` in `lines` (end when -1), separated by blank lines. */
function insertAt(lines, index, block) {
  const at = index < 0 || index > lines.length ? lines.length : index;
  return [...lines.slice(0, at), '', ...block.split('\n'), '', ...lines.slice(at)];
}

/**
 * `text` (a `.gitignore`) with exactly one current managed block: the first
 * one replaced in place, any further one removed, appended when there is
 * none. Nothing else changes. Idempotent.
 */
function applyBlock(text) {
  const lines = lf(text).split('\n');
  const ranges = blockRanges(lines, BLOCK_START, BLOCK_END);
  if (!ranges.length) return join(insertAt(lines, -1, renderBlock()));
  const { kept } = cut(lines, ranges.slice(1));
  const [a, b] = ranges[0];
  return join([...kept.slice(0, a), ...renderBlock().split('\n'), ...kept.slice(b + 1)]);
}

/**
 * How the normalized pattern `n` ignores the normalized VERSIONED path `v`:
 * "dir" (n is a parent folder of `v` — git cannot re-include anything below
 * an excluded folder), "glob" (`v` itself, `<dir>/*`, `<dir>/**` or a long
 * `prefix*` — a later `!` line can re-include) or null.
 */
function ignoresVersioned(n, v) {
  if (v.startsWith(`${n}/`)) return 'dir';
  if (n === v) return 'glob';
  const base = n.replace(/\/\*\*?$/, '');
  if (base !== n && (v === base || v.startsWith(`${base}/`))) return 'glob';
  if (n.endsWith('*') && n.length > 8 && v.startsWith(n.slice(0, -1))) return 'glob';
  return null;
}

/** A `!pattern` line, normalized like normalizePattern, or null. */
function normalizeNegation(line) {
  const t = String(line).trim();
  return t.startsWith('!') ? normalizePattern(t.slice(1)) : null;
}

/**
 * Lines that ignore a VERSIONED path (outside the block): policy deviations to
 * report, never auto-fixed. Parent folders (`.claude/`, `**\/.claude/`) and
 * globs (`.claude/*`, `.claude/**`) count; a later `!` line that re-includes
 * the path clears a glob, never a parent folder (git cannot re-include below
 * an excluded folder).
 */
function policyDeviations(text) {
  const lines = lf(text).split('\n');
  const inBlock = new Set();
  for (const [a, b] of blockRanges(lines, BLOCK_START, BLOCK_END)) for (let i = a; i <= b; i++) inBlock.add(i);
  const versioned = VERSIONED.map((v) => normalizePattern(v));
  const out = [];
  lines.forEach((line, i) => {
    if (inBlock.has(i)) return;
    const n = normalizePattern(line);
    if (n === null) return;
    const hit = versioned.findIndex((v) => {
      const how = ignoresVersioned(n, v);
      if (!how) return false;
      if (how === 'dir') return true;
      // re-included by a later negation?
      return !lines.slice(i + 1).some((l, k) => {
        if (inBlock.has(i + 1 + k)) return false;
        const m = normalizeNegation(l);
        return m !== null && (m === v || v.startsWith(`${m}/`));
      });
    });
    if (hit !== -1) out.push({ line: line.trim(), path: VERSIONED[hit] });
  });
  return out;
}

/**
 * `text` (a `.git/info/exclude`) carrying the current managed block — the
 * fallback for a repo whose `.gitignore` has no block yet, so a fresh clone or
 * a new worktree of it is covered until `migrate` moves the block into
 * `.gitignore` (and `stripExclude` removes this copy). The old plugin block is
 * replaced; everything else stays. Idempotent.
 */
function applyExcludeFallback(text) {
  const lines = lf(text).split('\n');
  const legacy = blockRanges(lines, LEGACY_START, LEGACY_END);
  return applyBlock(join(cut(lines, legacy).kept));
}

/**
 * Tracked files of the repo at `root` that the block ignores — already
 * committed, so the block alone does not stop them from being committed
 * again. `git ls-files -c -i -X <block>`; [] on any failure.
 * @returns {string[]} repo-relative paths
 */
function trackedUnderBlock(root, { timeoutMs = 10_000 } = {}) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const tmp = path.join(os.tmpdir(), `claude-block-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    fs.writeFileSync(tmp, renderBlock() + '\n');
    const out = execFileSync('git', ['ls-files', '-z', '-c', '-i', '-X', tmp], {
      cwd: root, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\0').filter(Boolean);
  } catch {
    return [];
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* temp file */ }
  }
}

/** `s` as one POSIX shell word: single-quoted, `'` written as `'\''` — no `$`, backtick or `"` expansion. */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * The command the user runs to stop tracking `files` (they stay on disk).
 * Display only — the plugin never runs it; code that untracks must pass the
 * paths as an argv array (`git rm --cached -- <files>`, no shell, a timeout).
 * File names come from the repo and are untrusted: each is single-quoted.
 */
function untrackCommand(files) {
  return `git rm --cached -- ${files.map(shellQuote).join(' ')}`;
}

/**
 * Migrate a `.gitignore`: drop the earlier plugin block and every hand-grown
 * line that is one of the block's entries in another spelling, then place the
 * one current block where the first of them stood (end of file otherwise).
 * Project-specific lines — including deliberate deviations from the policy —
 * stay; they are reported by `check()`.
 * @returns {{text:string, removed:string[]}}
 */
function migrateGitignore(text) {
  const lines = lf(text).split('\n');
  const removed = [];
  const legacy = blockRanges(lines, LEGACY_START, LEGACY_END);
  for (const [a, b] of legacy) {
    for (let i = a + 1; i < b; i++) if (normalizePattern(lines[i]) !== null) removed.push(lines[i].trim());
  }
  const ranges = [...legacy, ...blockRanges(lines, BLOCK_START, BLOCK_END)];
  const starts = new Set(ranges.map((r) => r[0]));
  const inRange = new Set();
  for (const [a, b] of ranges) for (let i = a; i <= b; i++) inRange.add(i);
  const marked = [];
  lines.forEach((l, i) => {
    if (!inRange.has(i)) marked.push(l);
    else if (starts.has(i)) marked.push(PLACEHOLDER);
  });
  const dropped = dropLines(marked, isBlockEntry);
  removed.push(...dropped.removed);
  const out = [];
  let placed = false;
  for (const l of dropped.kept) {
    if (l !== PLACEHOLDER) out.push(l);
    else if (!placed) {
      out.push('', ...renderBlock().split('\n'), '');
      placed = true;
    }
  }
  return { text: placed ? join(out) : applyBlock(join(out)), removed };
}

/**
 * Strip the Claude lines from `.git/info/exclude`: the earlier plugin block
 * and every line that is one of the block's entries (Claude Code's own
 * `# claude-code-runtime` lines included); everything else stays.
 * @returns {{text:string, removed:string[]}}
 */
function stripExclude(text) {
  let lines = lf(text).split('\n');
  const removed = [];
  const ranges = [...blockRanges(lines, LEGACY_START, LEGACY_END), ...blockRanges(lines, BLOCK_START, BLOCK_END)];
  for (const [a, b] of ranges) {
    for (let i = a + 1; i < b; i++) if (normalizePattern(lines[i]) !== null) removed.push(lines[i].trim());
  }
  lines = cut(lines, ranges).kept;
  const dropped = dropLines(lines, isBlockEntry);
  removed.push(...dropped.removed);
  let kept = dropped.kept;
  // Claude Code's header goes with its lines
  kept = kept.filter((l) => l !== PLACEHOLDER && !(removed.length && l.trim() === CLAUDE_CODE_EXCLUDE_HEADER));
  const original = lf(text);
  if (!removed.length) return { text: original, removed };
  return { text: join(kept), removed };
}

/**
 * Deviations from the canonical layout. Only structure counts as an issue
 * (fixable by `migrate`); policy deviations are reported apart.
 * A managed block in `info/exclude` is the expected fallback while
 * `.gitignore` has none; once `.gitignore` carries the block it is a leftover.
 * `tracked` (from trackedUnderBlock) lists committed files the block ignores —
 * an issue migrate cannot fix; its detail carries the `git rm --cached` fix.
 * @param {{gitignore:string|null, exclude:string|null, tracked?:string[]}} files current contents ('' / null when absent)
 * @returns {{ok:boolean, issues:{code:string, detail:string}[], policy:{line:string, path:string}[]}}
 */
function check({ gitignore, exclude, tracked = [] }) {
  const gi = lf(gitignore || '');
  const lines = gi.split('\n');
  const issues = [];
  const ranges = blockRanges(lines, BLOCK_START, BLOCK_END);
  if (!ranges.length) issues.push({ code: 'missing-block', detail: '.gitignore has no `# >>> claude (managed) >>>` block' });
  if (ranges.length > 1) issues.push({ code: 'duplicate-block', detail: `.gitignore has ${ranges.length} managed blocks` });
  if (ranges.length) {
    const [a, b] = ranges[0];
    if (lines.slice(a, b + 1).join('\n') !== renderBlock()) issues.push({ code: 'stale-block', detail: 'the managed block differs from the current policy' });
  }
  const legacy = blockRanges(lines, LEGACY_START, LEGACY_END);
  if (legacy.length) {
    issues.push({ code: 'legacy-block', detail: '.gitignore still has the old `# >>> devops-plugin runtime state` block' });
  }
  const inAnyBlock = new Set();
  for (const [a, b] of [...ranges, ...legacy]) for (let i = a; i <= b; i++) inAnyBlock.add(i);
  const outside = lines.filter((l, i) => !inAnyBlock.has(i) && isBlockEntry(l)).map((l) => l.trim());
  if (outside.length) issues.push({ code: 'duplicate-lines', detail: `${outside.length} hand-written Claude line(s) the block already covers: ${outside.slice(0, 5).join(', ')}` });
  const ex = lf(exclude || '').split('\n');
  if (blockRanges(ex, LEGACY_START, LEGACY_END).length) {
    issues.push({ code: 'exclude-block', detail: '.git/info/exclude still has the plugin block from an earlier version' });
  } else if (ranges.length && blockRanges(ex, BLOCK_START, BLOCK_END).length) {
    issues.push({ code: 'exclude-block', detail: '.git/info/exclude still has the fallback block although .gitignore carries it now' });
  }
  if (tracked && tracked.length) {
    issues.push({
      code: 'tracked-local',
      detail: `${tracked.length} committed file(s) the block ignores (${tracked.slice(0, 5).join(', ')}) — untrack them: ${untrackCommand(tracked)}`,
    });
  }
  return { ok: issues.length === 0, issues, policy: policyDeviations(gi) };
}

/** Does a ship that changed `files` (repo-relative, `/`-separated) touch the ignore policy? */
function touchesIgnorePolicy(files) {
  return (files || []).some((f) => {
    const p = String(f).replace(/\\/g, '/').replace(/^"|"$/g, '');
    return p === '.gitignore' || p === '.git/info/exclude' || p.startsWith('.claude/') || p.includes('/.claude/');
  });
}

module.exports = {
  CLAUDE_CODE_STATE, LOCAL_SETTINGS, PLUGIN_STATE, VERSIONED,
  BLOCK_START, BLOCK_END, LEGACY_START, LEGACY_END,
  allEntries, renderBlock, applyBlock, normalizePattern, isBlockEntry,
  migrateGitignore, stripExclude, check, policyDeviations, touchesIgnorePolicy,
  applyExcludeFallback, trackedUnderBlock, untrackCommand, shellQuote,
};
