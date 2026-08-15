#!/usr/bin/env node
/**
 * @module plugin-scope
 * @version 0.1.0
 * @description Answers "where does a fix belong?" for the devops plugin.
 *
 *   Two orthogonal facts every scope decision needs:
 *     1. Is the current session running INSIDE the plugin source repo?
 *        → direct fixes are expected, no upstream issue needed.
 *     2. Is a write target a MANAGED plugin install artifact
 *        (~/.claude/plugins/cache|marketplaces|repos/**)?
 *        → never hand-edit; overwritten on the next sync.
 *
 *   Canonical routing rules: deep-knowledge/plugin-scope-routing.md
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('node:child_process');

/** Last-resort slug when no installed marketplace can be read. */
const FALLBACK_SLUG = 'Jerry0022/dotclaude';

/** Install roots that are managed by the plugin installer, never by hand. */
const MANAGED_SUBDIRS = ['cache', 'marketplaces', 'repos'];

function gitTopLevel(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * True when `repoRoot` is the devops plugin's own source repo.
 * Matches the detection contract used by /claude-learn Step 2:
 * `{root}/plugins/devops/.claude-plugin/plugin.json` with `name === 'devops'`.
 * The root marketplace.json is accepted as a secondary signal so a repo layout
 * change does not silently turn the source repo into a "consumer".
 *
 * A checkout that lives INSIDE a managed install tree is never the source repo,
 * however true its metadata looks: the marketplace clone under
 * `~/.claude/plugins/marketplaces/dotclaude` carries both signals, and treating
 * it as the source would stand the guard down inside the very tree it protects.
 */
function isPluginSourceRepo(repoRoot, home = os.homedir()) {
  if (!repoRoot) return false;
  if (managedPluginArtifact(repoRoot, home)) return false;

  const pluginJson = readJson(
    path.join(repoRoot, 'plugins', 'devops', '.claude-plugin', 'plugin.json')
  );
  if (pluginJson && pluginJson.name === 'devops') return true;

  const marketplace = readJson(
    path.join(repoRoot, '.claude-plugin', 'marketplace.json')
  );
  if (marketplace && Array.isArray(marketplace.plugins)) {
    return marketplace.plugins.some(p => p && p.name === 'devops');
  }
  return false;
}

/** Normalize for comparison — Windows paths are case-insensitive. */
function normalize(p) {
  const abs = path.resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

function isUnder(parent, child) {
  const rel = path.relative(normalize(parent), normalize(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * True when `target` points into an installed (managed) plugin artifact.
 * Those trees are rewritten by the installer on every sync, so a hand-edit
 * masks the real defect and is silently lost.
 *
 * @param {string} target absolute or relative path
 * @param {string} [home] override for tests
 * @returns {string|null} the managed subdir that matched, or null
 */
function managedPluginArtifact(target, home = os.homedir()) {
  // A non-string target (malformed hook stdin, a future tool payload shape)
  // must never throw — a PreToolUse crash is user-visible.
  if (typeof target !== 'string' || !target) return null;
  try {
    const pluginsRoot = path.join(home, '.claude', 'plugins');
    for (const sub of MANAGED_SUBDIRS) {
      const dir = path.join(pluginsRoot, sub);
      // The directory itself is not an edit target — only paths beneath it.
      if (isUnder(dir, target) && normalize(dir) !== normalize(target)) return sub;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolve the upstream GitHub slug (`owner/repo`) for the devops plugin from
 * the installed marketplace metadata, falling back to the known canonical slug.
 *
 * @param {string} [home] override for tests
 */
function upstreamSlug(home = os.homedir()) {
  const marketplacesDir = path.join(home, '.claude', 'plugins', 'marketplaces');
  let entries = [];
  try { entries = fs.readdirSync(marketplacesDir); } catch { return FALLBACK_SLUG; }

  for (const entry of entries) {
    const meta = readJson(
      path.join(marketplacesDir, entry, '.claude-plugin', 'marketplace.json')
    );
    if (!meta || !Array.isArray(meta.plugins)) continue;
    if (!meta.plugins.some(p => p && p.name === 'devops')) continue;
    const owner = meta.owner && meta.owner.name;
    if (owner && meta.name) return `${owner}/${meta.name}`;
  }
  return FALLBACK_SLUG;
}

/**
 * Full scope snapshot for the current working directory.
 *
 * @param {string} cwd
 * @param {string} [home] override for tests
 * @returns {{repoRoot: string|null, isPluginRepo: boolean, slug: string}}
 */
function scopeFor(cwd, home = os.homedir()) {
  const repoRoot = gitTopLevel(cwd);
  return {
    repoRoot,
    isPluginRepo: isPluginSourceRepo(repoRoot, home),
    slug: upstreamSlug(home),
  };
}

module.exports = {
  FALLBACK_SLUG,
  MANAGED_SUBDIRS,
  gitTopLevel,
  isPluginSourceRepo,
  managedPluginArtifact,
  upstreamSlug,
  scopeFor,
};
