#!/usr/bin/env node
/**
 * @hook ss.plugin.update
 * @version 0.12.0
 * @event SessionStart
 * @plugin devops
 * @description Auto-update plugin marketplace clones, rebuild cache, and update registry.
 *   Workaround for anthropics/claude-code#14061 — Desktop never runs git pull
 *   on marketplace clones and never rebuilds the plugin cache.
 *   Shares the same update logic as /auto-update (see SKILL.md).
 *
 *   CHANNEL-AWARE (ring model): once the repo has a stable/* tag, the clone is
 *   pinned to the highest version visible to the marketplace's channel pin
 *   (~/.claude/plugins/.channels.json, default stable) via a detached tag
 *   checkout instead of branch-tip pulling. Until then a bootstrap fallback
 *   keeps the legacy pull behavior (migration safety — spec §5.2/§5.4).
 *
 *   When a plugin with an MCP server is upgraded mid-session, the running
 *   MCP processes point at the now-deleted old installPath. A sentinel file
 *   (~/.claude/plugins/.mcp-stale.json) is written so pre.mcp.health can
 *   block MCP tool calls until the user restarts Claude Code. The sentinel is
 *   written whenever a rebuild MOVES the installPath to a different version dir
 *   — not only on a git-HEAD version bump. A cacheStale rebuild can repoint the
 *   installPath with headChanged=false (marketplace pulled in an earlier
 *   session, cache still on the old version), which equally invalidates the
 *   running MCP processes.
 *
 *   A same-version cache REPAIR overwrites the existing version dir in place
 *   instead of deleting + recreating it. Nuking the dir mid-session changes its
 *   identity and de-registers the plugin's skills/slash-commands from Claude
 *   Code's already-loaded registry for the rest of the session (issue #219) —
 *   an in-place overwrite keeps the dir so /devops-* stays registered.
 *
 *   OUTPUT POLICY: only version changes and failures are printed. A successful
 *   same-version cache repair is housekeeping the user cannot act on, so it is
 *   done silently — see the `reportable` filter at the bottom.
 *
 *   BOOT DISCIPLINE (#324): this hook runs concurrently with the MCP servers'
 *   30 s connect window, and the cache dir it rewrites is those servers' cwd.
 *   Three mitigations: a 6 h cooldown gate (bypassed by /auto-update's
 *   `--force` AND by a network-free local cache-integrity probe, so a broken
 *   cache still self-heals next session), node_modules excluded from the copy, and a rebuild that targets
 *   a version dir a live session already claims handed to a detached child that
 *   sleeps past the window. The mechanics live in ../lib/cache-rebuild.js.
 */

require('../lib/plugin-guard');

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { t } = require('../lib/locale');
const { latestVisible, readChannelPin } = require('../lib/channels');
const { runOnce, releaseOnce } = require('../lib/run-once');
const {
  DEFER_DELAY_MS,
  cacheBroken,
  deferRebuild,
  getVersion,
  missingMcpFiles,
  rebuildCache,
  targetIsLive,
} = require('../lib/cache-rebuild');

// Translations for user-facing output. SessionStart fires before any user
// prompt — there is no detected locale yet and no session_id in hook input
// here. Default to English; the DICT is pre-wired so a future improvement
// (e.g. reading hook stdin for session_id and calling getLocale) can switch
// languages without restructuring the output.
const DICT = {
  en: {
    header: 'Plugin updates applied (workaround for claude-code#14061):',
    restart: '⚡ **Plugin updated ({names}) — restart Claude to activate the new version.**',
    dk_reread: 'Deep-knowledge index may have changed — re-read INDEX.md on next relevant task.',
    show_asis: 'Show the user this restart notice as-is.',
  },
  de: {
    header: 'Plugin-Updates angewendet (Workaround für claude-code#14061):',
    restart: '⚡ **Plugin aktualisiert ({names}) — Claude neu starten, um die neue Version zu aktivieren.**',
    dk_reread: 'Deep-Knowledge-Index hat sich evtl. geändert — INDEX.md beim nächsten relevanten Task neu lesen.',
    show_asis: 'Diese Restart-Notice dem User unverändert zeigen.',
  },
};

const lang = 'en';

const home = process.env.HOME || process.env.USERPROFILE || '';
const marketplacesDir = path.join(home, '.claude', 'plugins', 'marketplaces');
const cacheDir = path.join(home, '.claude', 'plugins', 'cache');
const registryFile = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
const sentinelFile = path.join(home, '.claude', 'plugins', '.mcp-stale.json');

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }).trim();
  } catch {
    return '';
  }
}

/**
 * Fire an OS-level notification (tray / toast / notification center).
 * Non-blocking on Windows (spawns detached), sync elsewhere.
 * Fails silently — never blocks or crashes the hook.
 */
function notifyDesktop(title, body) {
  try {
    if (process.platform === 'win32') {
      const { spawn } = require('child_process');
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$n = New-Object System.Windows.Forms.NotifyIcon',
        '$n.Icon = [System.Drawing.SystemIcons]::Information',
        '$n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info',
        `$n.BalloonTipTitle = '${title.replace(/'/g, "''")}'`,
        `$n.BalloonTipText = '${body.replace(/'/g, "''")}'`,
        '$n.Visible = $true',
        '$n.ShowBalloonTip(10000)',
        'Start-Sleep -Seconds 10',
        '$n.Dispose()',
      ].join('; ');
      const child = spawn('powershell', ['-NoProfile', '-Command', script], {
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      execSync(
        `osascript -e 'display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`,
        { timeout: 5000, stdio: 'ignore' },
      );
    } else {
      execSync(`notify-send "${title.replace(/"/g, '\\"')}" "${body.replace(/"/g, '\\"')}"`, {
        timeout: 5000, stdio: 'ignore',
      });
    }
  } catch {
    // Notification failed — non-fatal
  }
}


/**
 * Drop a lingering MCP-stale sentinel from a previous session. Must run on
 * EVERY early-exit path: the sentinel makes pre.mcp.health block every MCP tool
 * call, so leaving one behind disables the plugin's own tooling for a whole
 * session. It is only meaningful for the session that wrote it.
 */
function clearSentinel() {
  if (!fs.existsSync(sentinelFile)) return;
  try { fs.unlinkSync(sentinelFile); } catch { /* ignore */ }
}

// If the marketplaces directory is missing, there are no updates to run.
if (!fs.existsSync(marketplacesDir)) {
  clearSentinel();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Cooldown gate (#324)
//
// Everything below is expensive and network-bound: one `git fetch --tags` per
// marketplace, tag resolution, and potentially a full cache rebuild — all of it
// racing three MCP servers through a 30 s connect budget on the same machine.
// A plugin update is not time-critical to the minute, so it runs at most once
// per COOLDOWN_MS. The sentinel is still cleared on the skip path (see above).
//
// Bypass: the EXPLICIT path. /auto-update runs this hook with `--force`, and
// DEVOPS_PLUGIN_UPDATE_FORCE=1 does the same for scripted callers. A user who
// asked for an update gets one now, cooldown or not.
//
// The token is handed back (releaseOnce) whenever a rebuild reported failure,
// so a broken cache retries next session instead of waiting out the interval.
//
// Bypass: the IMPLICIT path. releaseOnce only covers rebuilds that were TRIED
// and failed — it cannot cover a cache that broke while the gate was closed
// (registry installPath deleted, cached version drifted from the clone, MCP
// files dropped). ss.mcp.verify tells the user a restart self-heals exactly
// that state, so the gate follows ss.mcp.deps' rule: it only applies when
// NOTHING is broken. cacheBroken() is pure fs — no git, no network — so
// deciding costs a fraction of the work it can unblock.
// ---------------------------------------------------------------------------
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const FORCE = process.argv.includes('--force') || process.env.DEVOPS_PLUGIN_UPDATE_FORCE === '1';

const integrity = cacheBroken({ marketplacesDir, registryFile });
if (integrity.broken) {
  process.stderr.write(`[ss.plugin.update] cooldown bypassed: cache integrity (${integrity.reason})
`);
}

if (!FORCE && !integrity.broken && !runOnce('ss-plugin-update', null, { cooldownMs: COOLDOWN_MS })) {
  clearSentinel();
  process.exit(0);
}

const updated = [];
// Tracks plugins whose installPath moved and that expose MCP servers.
// Used at the end to either write or clear the stale sentinel.
const mcpAffected = [];

for (const marketplace of fs.readdirSync(marketplacesDir)) {
  const mDir = path.join(marketplacesDir, marketplace);
  if (!fs.statSync(mDir).isDirectory()) continue;
  if (!fs.existsSync(path.join(mDir, '.git'))) continue;

  // Find all plugin dirs within this marketplace
  const pluginsRoot = path.join(mDir, 'plugins');
  const pluginDirs = [];
  if (fs.existsSync(pluginsRoot)) {
    for (const p of fs.readdirSync(pluginsRoot)) {
      const pd = path.join(pluginsRoot, p);
      if (fs.statSync(pd).isDirectory()) pluginDirs.push({ name: p, dir: pd });
    }
  }
  // Also check root-level plugin (single-plugin repos)
  if (fs.existsSync(path.join(mDir, '.claude-plugin', 'plugin.json'))) {
    pluginDirs.push({ name: marketplace, dir: mDir });
  }

  // Capture versions before pull
  const beforeVersions = {};
  for (const { name, dir } of pluginDirs) {
    beforeVersions[name] = getVersion(dir);
  }

  // Update strategy (ring model, spec §5.2): resolve the marketplace's channel
  // pin against channel tags. Bootstrap fallback: until the FIRST stable/* tag
  // exists, behave exactly like the legacy hook (branch pull) — this is what
  // makes the migration oscillation-free (R1): old and new hook versions do
  // the same thing until a stable promotion exists, then every consumer
  // converges on the resolved tag.
  const channel = readChannelPin(path.join(home, '.claude', 'plugins'), marketplace);
  const localHead = run('git rev-parse HEAD', mDir);
  run('git fetch origin --tags 2>&1', mDir);
  const tagList = run('git tag --list', mDir).split('\n').filter(Boolean);
  const hasStableTag = tagList.some((tag) => tag.startsWith('stable/'));
  let newHead = localHead;

  if (!hasStableTag) {
    // Legacy path (pre-channel repo state): branch-tip tracking.
    const pullResult = run('git pull --ff-only origin main 2>&1 || git pull --ff-only origin master 2>&1', mDir);
    newHead = run('git rev-parse HEAD', mDir);

    // If pull failed (dirty tree), reset and retry
    if (localHead === newHead && !pullResult) {
      run('git checkout -- .', mDir);
      run('git clean -fd', mDir);
      run('git pull --ff-only origin main 2>&1 || git pull --ff-only origin master 2>&1', mDir);
      newHead = run('git rev-parse HEAD', mDir);
    }
  } else {
    // Channel pin: highest version visible to the pinned channel
    // (own channel ∪ all more-stable ∪ bare pre-channel tags).
    const resolved = latestVisible(tagList, channel);
    const targetSha = resolved ? run(`git rev-list -n 1 "${resolved.tag}"`, mDir) : '';
    if (targetSha && targetSha !== localHead) {
      // Repair-then-pin: a dirty or half-merged clone (e.g. a native `git pull`
      // that failed on the detached HEAD) must never block the pin (R8). NEVER
      // pull in this path — on a detached HEAD that is an ancestor of main,
      // --ff-only would silently fast-forward to the alpha tip and defeat the
      // pin (R2). Re-resolving + re-pinning every SessionStart is the
      // self-healing property.
      run('git reset --hard', mDir);
      run('git clean -fd', mDir);
      run(`git checkout --detach "${resolved.tag}" 2>&1`, mDir);
      newHead = run('git rev-parse HEAD', mDir);
    }
  }

  const newSha = newHead.substring(0, 7);
  const headChanged = localHead !== newHead;

  // Rebuild cache for plugins that changed version OR have missing cache
  for (const { name, dir } of pluginDirs) {
    const after = getVersion(dir);
    if (!after) continue;

    const versionChanged = headChanged && after !== beforeVersions[name];

    // Cache-existence guard: rebuild if registry points to a missing path
    let cacheMissing = false;
    // Cache-staleness guard: rebuild if cached plugin.json version doesn't match marketplace
    let cacheStale = false;
    // The installPath the running MCP servers were spawned from this session.
    // Captured BEFORE rebuildCache rewrites the registry, so we can detect an
    // installPath MOVE and flag MCP staleness even when git HEAD didn't move.
    let previousInstallPath = null;
    try {
      const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
      const key = `${name}@${marketplace}`;
      const entry = registry.plugins[key]?.[0];
      if (entry) {
        previousInstallPath = entry.installPath || null;
        if (!fs.existsSync(entry.installPath)) {
          cacheMissing = true;
        } else {
          // Verify cached content matches marketplace (catches stale-content-in-correct-dir)
          const cachedVersion = getVersion(entry.installPath);
          if (cachedVersion !== after) {
            cacheStale = true;
          } else {
            // SHA mismatch: same version string but different commit (files may have changed)
            const cachedSha = entry.gitCommitSha || '';
            if (cachedSha && cachedSha !== newHead && cachedSha !== newSha) {
              cacheStale = true;
            }
            // Completeness guard: version/sha can match while the MCP server
            // files were dropped by an incomplete sync (issue #190). Rebuild
            // from the marketplace clone to heal the cache in place.
            if (!cacheStale && missingMcpFiles(entry.installPath, dir).length) {
              cacheStale = true;
            }
          }
        }
      }
    } catch { /* registry unreadable — rebuild to be safe */ cacheMissing = true; }

    if (versionChanged || cacheMissing || cacheStale) {
      const rebuildOpts = {
        marketplace,
        pluginName: name,
        pluginDir: dir,
        version: after,
        sha: newSha,
        channel,
        cacheDir,
        registryFile,
      };

      // #324: never bulk-write into a version dir a live session is standing
      // on. `targetIsLive` is true exactly for the same-version cache REPAIR —
      // the dir this session's MCP servers use as their cwd and require() root,
      // while they are still inside their 30 s connect window. That case is
      // also the one whose success is deliberately silent (see `reportable`
      // below), so deferring it into a detached child that sleeps past the
      // window costs no reporting fidelity at all. A rebuild into a NEW version
      // dir is not deferred: no running server points at it, and the user is
      // waiting for the restart notice.
      if (!FORCE && targetIsLive(rebuildOpts)) {
        const handoff = deferRebuild(rebuildOpts);
        if (handoff.deferred) {
          process.stderr.write(
            `[ss.plugin.update] ${name}: cache repair deferred ${DEFER_DELAY_MS}ms ` +
            `(version dir in use by a live session)\n`,
          );
          continue;
        }
        // Spawning failed — fall through and repair inline rather than leaving
        // a known-stale cache in place.
      }

      const result = rebuildCache(rebuildOpts);
      updated.push({
        name,
        from: beforeVersions[name] || '?',
        to: after,
        verified: result.ok,
        cacheRepair: (cacheMissing || cacheStale) && !versionChanged,
        error: result.ok ? null : (result.missing || result.mismatch),
      });

      // MCP-bearing plugins: the running MCP processes were spawned from
      // previousInstallPath. Flag them stale whenever the rebuild MOVED the
      // install to a different version dir — NOT only on a git-HEAD version bump.
      // A cacheStale rebuild can repoint the installPath with headChanged=false
      // (e.g. the marketplace was pulled to the new version in an earlier session
      // but the cache still pointed at the old version dir); rebuildCache then
      // deletes the old dir and registers the new one, leaving the running MCP
      // servers pointing at deleted files with no sentinel to block them. A
      // same-version in-place repair keeps installPath === previousInstallPath
      // (files overwritten; the RAM-resident Node process keeps working) → no
      // sentinel, preserving #219 behavior.
      const installMoved =
        result.ok &&
        previousInstallPath != null &&
        result.installPath != null &&
        path.resolve(previousInstallPath) !== path.resolve(result.installPath);
      if (installMoved && fs.existsSync(path.join(dir, '.mcp.json'))) {
        mcpAffected.push({
          name,
          marketplace,
          from: beforeVersions[name] || '?',
          to: after,
        });
      }
    }
  }
}

// Manage the MCP-stale sentinel. Writing it here is safe even if Claude Code
// spawns MCP servers AFTER this hook runs — pre.mcp.health compares the PID
// file's mtime against the sentinel's mtime, so a fresh spawn clears it on
// the first tool call. Stale sentinels from a previous session are cleaned
// up when this hook runs without MCP-affecting changes.
if (mcpAffected.length > 0) {
  try {
    fs.writeFileSync(
      sentinelFile,
      JSON.stringify({ stampedAt: new Date().toISOString(), plugins: mcpAffected }, null, 2),
    );
  } catch {
    // Sentinel write failed — MCP tools will still work, just without the guard
  }
} else {
  // Nothing moved this run — any lingering sentinel is from a prior session
  clearSentinel();
}

// Hand the cooldown token back when anything failed: a broken cache must retry
// at the NEXT session start, not in six hours. runOnce() takes the token before
// the work, so this is the "written only on success" half of the contract.
if (updated.some(u => !u.verified)) {
  releaseOnce('ss-plugin-update', null);
}

// Report only what the user can act on. A SUCCESSFUL same-version cache repair
// is pure housekeeping — the plugin was already at the right version, nothing
// changed for the user, and no restart is needed — yet it used to print a
// three-line block at the top of every session ("1.0.0 → 1.0.0 [cache repair]").
// Version changes and failures still surface: those are real.
const reportable = updated.filter(u => !u.verified || u.from !== u.to);
if (reportable.length === 0) process.exit(0);

const lines = [t('header', lang, DICT)];
lines.push('');
for (const u of reportable) {
  const status = u.verified ? '✓ cache rebuilt' : `⚠ ${u.error}`;
  const repair = u.cacheRepair ? ' [cache repair]' : '';
  lines.push(`- **${u.name}**: ${u.from} → ${u.to} (${status}${repair})`);
}
lines.push('');

// Detect real version upgrades (not just cache repairs)
const upgrades = updated.filter(u => !u.cacheRepair && u.verified);
if (upgrades.length > 0) {
  const names = upgrades.map(u => `${u.name} v${u.to}`).join(', ');
  lines.push(t('restart', lang, DICT).replace('{names}', names));
  lines.push(t('dk_reread', lang, DICT));
  lines.push(t('show_asis', lang, DICT));
  lines.push('');
  notifyDesktop('Claude Plugin Updated', `${names} — restart Claude to activate.`);
}

process.stdout.write(lines.join('\n'));
