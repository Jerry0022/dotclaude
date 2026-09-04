#!/usr/bin/env node
/**
 * @script cache-rebuild-runner
 * @version 0.1.0
 * @plugin devops
 * @description Detached executor for a deferred plugin-cache rebuild (#324).
 *
 *   Spawned by cache-rebuild.js's deferRebuild() with a single JSON argument.
 *   Sleeps `delayMs` — long enough for every MCP server to be past its 30 s
 *   connect window — and only then writes into the cache version dir those
 *   servers use as their `cwd`.
 *
 *   Runs orphaned by design (detached, stdio ignored, unref'd by the parent):
 *   it must not keep the SessionStart hook, and therefore the session, open.
 *   It is silent for the same reason — there is no one left to read stdout.
 *   Failures are non-fatal: the next SessionStart re-detects the stale cache
 *   and tries again, which is the same self-healing loop as before.
 *
 *   CLI (internal): node cache-rebuild-runner.js '<json>'
 */

'use strict';

const { rebuildCache } = require('./cache-rebuild');

async function main() {
  let opts;
  try {
    opts = JSON.parse(process.argv[2] || '');
  } catch {
    process.exit(2);
  }

  const delayMs = Number.isFinite(opts.delayMs) ? opts.delayMs : 0;
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  try {
    const result = rebuildCache(opts);
    // A marker file makes the deferred run observable — for tests and for
    // anyone debugging a cache that did not refresh. Best effort only.
    if (opts.doneMarker) {
      try {
        require('fs').writeFileSync(opts.doneMarker, JSON.stringify(result));
      } catch { /* observability is optional */ }
    }
    process.exit(result.ok ? 0 : 1);
  } catch {
    process.exit(1);
  }
}

main();
