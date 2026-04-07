#!/usr/bin/env node
/**
 * @script build-id
 * @version 0.1.0
 * @plugin devops
 * @description Compute build-ID from source code and assets only.
 *   Excludes config, docs, build artifacts, lock files, and metadata.
 *   Same source code + assets = same build-ID (deterministic, idempotent).
 *   Output: 7-char hash to stdout.
 */

const { execSync } = require('child_process');

// Detect worktree name (used as prefix, not replacement).
function getWorktreeName() {
  try {
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
    const match = gitDir.match(/[/\\]worktrees[/\\]([^/\\]+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const worktreeName = getWorktreeName();

// Patterns excluded from the build hash — only source code and assets matter.
const EXCLUDE = [
  // Documentation
  '*.md',
  'LICENSE',
  // Package metadata & lock files
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '*.lock',
  // Config files
  'tsconfig*.json',
  'jest.config.*',
  'vitest.config.*',
  '*.config.*',
  '.editorconfig',
  '.gitignore',
  '.gitattributes',
  '.prettierrc*',
  '.eslintrc*',
  'eslint.config.*',
  '.env*',
  // Build outputs
  'dist/',
  'build/',
  'out/',
  '.next/',
  '.nuxt/',
  '.cache/',
  // Tooling
  '.claude/',
  '.vscode/',
  '.idea/',
  'node_modules/',
  // Build log
  'BUILDLOG.md',
];

const pathspecs = EXCLUDE.map(p => `:(exclude)${p}`);

try {
  // List source files (tracked + untracked, excluding gitignored)
  const filesRaw = execSync(
    `git ls-files --cached --others --exclude-standard -- . ${pathspecs.map(p => `"${p}"`).join(' ')}`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  ).trim();

  if (!filesRaw) {
    process.stdout.write('0000000\n');
    process.exit(0);
  }

  const files = filesRaw.split('\n').filter(Boolean).sort();

  // Hash each file's content via git (reads from working tree)
  const hashes = execSync('git hash-object --stdin-paths', {
    input: files.join('\n'),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  }).trim();

  // Combine all hashes into a single deterministic hash
  const combined = execSync('git hash-object --stdin', {
    input: hashes,
    encoding: 'utf8',
  }).trim();

  const hash = combined.substring(0, 7);
  const buildId = worktreeName ? `${worktreeName}-${hash}` : hash;
  process.stdout.write(buildId + '\n');
} catch (e) {
  process.stderr.write(`build-id error: ${e.message}\n`);
  process.exit(1);
}
