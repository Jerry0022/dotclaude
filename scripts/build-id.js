#!/usr/bin/env node
// Compute build ID from source code and assets only.
// Excludes config, docs, build artifacts, lock files, and metadata.
// Same source code + assets = same build ID, guaranteed.

const { execSync } = require('child_process');

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
  // List tracked source files, excluding non-source patterns
  const filesRaw = execSync(
    `git ls-files -- . ${pathspecs.map(p => `"${p}"`).join(' ')}`,
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

  process.stdout.write(combined.substring(0, 7) + '\n');
} catch (e) {
  process.stderr.write(`build-id error: ${e.message}\n`);
  process.exit(1);
}
