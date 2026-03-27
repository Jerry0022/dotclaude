#!/usr/bin/env node
/**
 * @hook pre.ship.guard
 * @version 0.2.0
 * @event PreToolUse
 * @plugin dotclaude-dev-ops
 * @description Block git push when uncommitted files exist or version references
 *   are inconsistent. Checks plugin.json, marketplace.json, README.md, and
 *   CHANGELOG.md for matching versions before allowing a push.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, filePath), 'utf8'));
  } catch {
    return null;
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(path.join(cwd, filePath), 'utf8');
  } catch {
    return null;
  }
}

// --- Version consistency checks ---

function checkVersionConsistency() {
  const mismatches = [];

  // Source of truth: .claude-plugin/plugin.json
  const plugin = readJson('.claude-plugin/plugin.json');
  if (!plugin || !plugin.version) {
    // No plugin.json or no version field — skip version checks
    return mismatches;
  }

  const version = plugin.version;

  // Check .claude-plugin/marketplace.json
  const marketplace = readJson('.claude-plugin/marketplace.json');
  if (marketplace) {
    const mktVersion = marketplace.metadata && marketplace.metadata.version;
    if (mktVersion && mktVersion !== version) {
      mismatches.push({
        file: '.claude-plugin/marketplace.json',
        expected: version,
        found: mktVersion,
      });
    }
  }

  // Check package.json (if exists)
  const pkg = readJson('package.json');
  if (pkg && pkg.version && pkg.version !== version) {
    mismatches.push({
      file: 'package.json',
      expected: version,
      found: pkg.version,
    });
  }

  // Check README.md for **Version: X.Y.Z**
  const readme = readFile('README.md');
  if (readme) {
    const match = readme.match(/\*\*Version:\s*([^\s*]+)\*\*/);
    if (match && match[1] !== version) {
      mismatches.push({
        file: 'README.md',
        expected: version,
        found: match[1],
      });
    } else if (!match) {
      mismatches.push({
        file: 'README.md',
        expected: `**Version: ${version}**`,
        found: '(no version badge found)',
      });
    }
  }

  // Check CHANGELOG.md — top entry must match
  const changelog = readFile('CHANGELOG.md');
  if (changelog) {
    const clMatch = changelog.match(/##\s*\[([^\]]+)\]/);
    if (clMatch && clMatch[1] !== version) {
      mismatches.push({
        file: 'CHANGELOG.md',
        expected: version,
        found: clMatch[1],
      });
    }
  } else {
    mismatches.push({
      file: 'CHANGELOG.md',
      expected: 'file to exist',
      found: '(missing)',
    });
  }

  return mismatches;
}

// --- Hook registry consistency check ---

function checkHookRegistry() {
  const missing = [];

  const plugin = readJson('.claude-plugin/plugin.json');
  const hooksJson = readJson('hooks/hooks.json');
  if (!plugin || !hooksJson) return missing;

  const registered = new Set(Array.isArray(plugin.hooks) ? plugin.hooks : []);

  // Collect all hook names from hooks.json
  const defined = [];
  for (const hooks of Object.values(hooksJson.hooks || {})) {
    for (const h of hooks) {
      if (h.name) defined.push(h.name);
    }
  }

  for (const name of defined) {
    if (!registered.has(name)) {
      missing.push(name);
    }
  }

  return missing;
}

// Read hook input from stdin
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const cmd = (hook.tool_input && hook.tool_input.command) || '';

  // Only guard git push commands — strip heredoc/quoted content first
  // to avoid false positives from commit messages containing "git push"
  const cmdBeforeHeredoc = cmd.split(/<<['"]?\w*['"]?$/m)[0] || cmd;
  const cmdStripped = cmdBeforeHeredoc.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');
  if (!/\bgit\s+push\b/.test(cmdStripped)) {
    process.exit(0);
  }

  // --- Check 1: Dirty state ---
  const status = git('status --porcelain');
  if (status) {
    const lines = status.split('\n').filter(Boolean);
    const untracked = lines.filter(l => l.startsWith('??'));
    const modified = lines.filter(l => !l.startsWith('??'));

    console.error(`\n⛔ PUSH BLOCKED — dirty working tree`);
    console.error('─'.repeat(50));

    if (modified.length > 0) {
      console.error(`\nUncommitted changes (${modified.length}):`);
      modified.slice(0, 10).forEach(l => console.error(`  ${l}`));
      if (modified.length > 10) console.error(`  ... and ${modified.length - 10} more`);
    }

    if (untracked.length > 0) {
      console.error(`\nUntracked files (${untracked.length}):`);
      untracked.slice(0, 10).forEach(l => console.error(`  ${l}`));
      if (untracked.length > 10) console.error(`  ... and ${untracked.length - 10} more`);
    }

    console.error('─'.repeat(50));
    console.error('Commit or discard changes before pushing.');
    console.error('');
    process.exit(2);
  }

  // --- Check 2: Version consistency ---
  const mismatches = checkVersionConsistency();
  if (mismatches.length > 0) {
    console.error(`\n⛔ PUSH BLOCKED — version mismatch`);
    console.error('─'.repeat(50));
    console.error('\nSource of truth: .claude-plugin/plugin.json');
    console.error('');

    for (const m of mismatches) {
      console.error(`  ${m.file}`);
      console.error(`    expected: ${m.expected}`);
      console.error(`    found:    ${m.found}`);
    }

    console.error('\n' + '─'.repeat(50));
    console.error('Update all version files before pushing.');
    console.error('See: skills/ship/deep-knowledge/versioning.md');
    console.error('');
    process.exit(2);
  }

  // --- Check 3: Hook registry consistency ---
  const missingHooks = checkHookRegistry();
  if (missingHooks.length > 0) {
    console.error(`\n⛔ PUSH BLOCKED — hook registry mismatch`);
    console.error('─'.repeat(50));
    console.error('\nHooks defined in hooks/hooks.json but missing from .claude-plugin/plugin.json:');
    missingHooks.forEach(name => console.error(`  - ${name}`));
    console.error('\n' + '─'.repeat(50));
    console.error('Add missing hooks to .claude-plugin/plugin.json "hooks" array.');
    console.error('');
    process.exit(2);
  }

  // All checks passed
  process.exit(0);
});
