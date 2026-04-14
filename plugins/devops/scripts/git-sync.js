#!/usr/bin/env node
/**
 * @script git-sync
 * @version 0.3.0
 * @plugin devops
 * @description Core git sync logic — fetch remote, merge parent chain into
 *   current branch. Supports branch hierarchy (feat/auth/login merges
 *   main → feat → feat/auth). Conflicts are resolved semantically by
 *   Claude when possible. Only truly ambiguous conflicts produce a warning
 *   for the developer to handle.
 *   Standalone: called by prompt.git.sync hook and session-start cron.
 */

const { execSync } = require('child_process');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const cwd = process.cwd();
const MAIN = 'main';

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

// Only run in a git repo
if (git('rev-parse --is-inside-work-tree') !== 'true') {
  process.exit(0);
}

const remote = git('remote');
if (!remote) process.exit(0);
const origin = remote.split('\n')[0];

const branch = git('rev-parse --abbrev-ref HEAD');
if (!branch || branch === MAIN) process.exit(0);

// Ensure diff3 is set for meaningful conflict markers
const conflictStyle = git('config --get merge.conflictstyle');
if (conflictStyle !== 'diff3' && conflictStyle !== 'zdiff3') {
  git('config merge.conflictstyle diff3');
}

// Build parent chain from branch name hierarchy.
// For "feat/auth/login" → [main, feat, feat/auth]
function getParentChain(branchName) {
  const parts = branchName.split('/');
  const parents = [MAIN];
  for (let i = 1; i < parts.length; i++) {
    parents.push(parts.slice(0, i).join('/'));
  }
  return parents;
}

/**
 * Parse conflict markers from file content (diff3 format).
 * Returns array of { ours, base, theirs, startLine } or null if no markers found.
 */
function parseConflicts(content) {
  const lines = content.split('\n');
  const conflicts = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const startLine = i + 1;
      const ours = [];
      const base = [];
      const theirs = [];
      let section = 'ours';
      i++;

      while (i < lines.length) {
        if (lines[i].startsWith('|||||||')) {
          section = 'base';
          i++;
          continue;
        }
        if (lines[i].startsWith('=======')) {
          section = 'theirs';
          i++;
          continue;
        }
        if (lines[i].startsWith('>>>>>>>')) {
          conflicts.push({
            ours: ours.join('\n'),
            base: base.join('\n'),
            theirs: theirs.join('\n'),
            startLine,
          });
          i++;
          break;
        }
        if (section === 'ours') ours.push(lines[i]);
        else if (section === 'base') base.push(lines[i]);
        else theirs.push(lines[i]);
        i++;
      }
    } else {
      i++;
    }
  }

  return conflicts.length > 0 ? conflicts : null;
}

/**
 * Determine if a conflict is trivially resolvable without semantic analysis.
 * Returns the resolved content string, or null if the conflict needs Claude.
 */
function tryTrivialResolve(conflict) {
  const { ours, base, theirs } = conflict;

  // One side unchanged from base → take the other side's change
  if (ours === base) return theirs;
  if (theirs === base) return ours;

  // Both sides made identical changes → take either
  if (ours === theirs) return ours;

  // Whitespace-only difference on one side
  if (ours.replace(/\s+/g, '') === base.replace(/\s+/g, '')) return theirs;
  if (theirs.replace(/\s+/g, '') === base.replace(/\s+/g, '')) return ours;

  // Not trivially resolvable
  return null;
}

/**
 * Attempt to resolve all conflicts in a file.
 * Returns { resolved: true, content } or { resolved: false, ambiguousCount, file }.
 */
function resolveFile(filePath) {
  const fullPath = join(cwd, filePath);
  let content;
  try {
    content = readFileSync(fullPath, 'utf8');
  } catch {
    return { resolved: false, ambiguousCount: 1, file: filePath };
  }

  const conflicts = parseConflicts(content);
  if (!conflicts) return { resolved: true, content };

  let ambiguousCount = 0;
  let result = content;

  // Process conflicts in reverse order to preserve line positions
  for (let i = conflicts.length - 1; i >= 0; i--) {
    const conflict = conflicts[i];
    const resolution = tryTrivialResolve(conflict);

    if (resolution !== null) {
      // Build the full conflict block regex for this specific conflict
      const lines = result.split('\n');
      let blockStart = -1;
      let blockEnd = -1;
      let currentConflictIdx = 0;

      for (let j = 0; j < lines.length; j++) {
        if (lines[j].startsWith('<<<<<<<')) {
          if (currentConflictIdx === i) {
            blockStart = j;
          }
          currentConflictIdx++;
        }
        if (blockStart >= 0 && lines[j].startsWith('>>>>>>>')) {
          blockEnd = j;
          break;
        }
      }

      if (blockStart >= 0 && blockEnd >= 0) {
        lines.splice(blockStart, blockEnd - blockStart + 1, ...resolution.split('\n'));
        result = lines.join('\n');
      }
    } else {
      ambiguousCount++;
    }
  }

  if (ambiguousCount > 0) {
    return { resolved: false, ambiguousCount, file: filePath };
  }

  writeFileSync(fullPath, result, 'utf8');
  git(`add -- "${filePath}"`);
  return { resolved: true, content: result };
}

// Try merging source into HEAD. Resolve trivial conflicts automatically,
// warn only for genuinely ambiguous conflicts that need human judgment.
function tryMerge(source) {
  const behind = git(`rev-list --count HEAD..${source}`);
  if (!behind || parseInt(behind) === 0) return null; // already up to date

  const count = parseInt(behind);

  // Normal merge (clean — no conflicts)
  if (git(`merge ${source} --no-edit --quiet`) !== null) {
    return { source, commits: count };
  }

  // Merge conflicted — try resolving trivial conflicts
  const conflictOutput = git('diff --name-only --diff-filter=U');
  const files = conflictOutput ? conflictOutput.split('\n').filter(Boolean) : [];

  if (files.length === 0) {
    git('merge --abort');
    return { source, commits: count, conflict: true, files: [] };
  }

  let totalAmbiguous = 0;
  const ambiguousFiles = [];

  for (const file of files) {
    const result = resolveFile(file);
    if (!result.resolved) {
      totalAmbiguous += result.ambiguousCount;
      ambiguousFiles.push(file);
    }
  }

  if (totalAmbiguous > 0) {
    // Some conflicts couldn't be resolved — abort and warn
    git('merge --abort');
    return {
      source,
      commits: count,
      conflict: true,
      files: ambiguousFiles,
      partialResolve: files.length - ambiguousFiles.length,
    };
  }

  // All conflicts resolved — complete the merge
  git('commit --no-edit');
  return { source, commits: count, autoResolved: files.length };
}

// Fetch main
if (git(`fetch ${origin} ${MAIN} --quiet`) === null) {
  process.exit(0);
}
git(`fetch ${origin} ${MAIN}:${MAIN} --quiet`);

// Build parent chain, fetch each from origin, keep only existing branches
const parents = getParentChain(branch).filter(p => {
  if (p === MAIN) return true;
  // Fetch and update local ref from origin (fast-forward)
  git(`fetch ${origin} ${p}:${p} --quiet`);
  return git(`rev-parse --verify ${p}`) !== null;
});

// Merge each parent into current branch (root → closest parent)
const messages = [];
for (const parent of parents) {
  const result = tryMerge(parent);
  if (!result) continue;

  if (result.conflict) {
    const partialNote = result.partialResolve
      ? ` (${result.partialResolve} conflict(s) auto-resolved)`
      : '';
    messages.push(
      `✗ ${parent} → ${branch}: ${result.files.length} file(s) with ambiguous conflicts — ` +
      `merge aborted${partialNote}. These conflicts need your input:\n` +
      `  ${result.files.join(', ')}`
    );
  } else if (result.autoResolved) {
    messages.push(
      `✓ ${parent} → ${branch}: ${result.commits} commit(s), ` +
      `${result.autoResolved} conflict(s) auto-resolved`
    );
  } else {
    messages.push(`✓ ${parent} → ${branch}: ${result.commits} commit(s)`);
  }
}

if (messages.length) {
  process.stdout.write(`[git-sync] ${messages.join(' | ')}\n`);
}
