/**
 * Keep the worker's RPC with vitest's main process alive while tests block
 * synchronously (vitest setupFiles).
 *
 * Why: vitest reports results through an RPC (`onTaskUpdate`, throttled to
 * every 100 ms) whose reply the worker must read within birpc's fixed 60 s
 * timeout. Its runner goes from one test to the next through promise
 * continuations only — microtasks, never a macrotask — so a file whose tests
 * block synchronously (spawnSync/execFileSync of hooks, git and servers: most
 * of this suite) keeps the worker's event loop busy for the whole file. The
 * reply sits unread in the IPC queue; once the worker has blocked for 60 s,
 * the expired timer fires before the queued reply: "[vitest-worker]: Timeout
 * calling "onTaskUpdate"", an unhandled error, exit 1 — with every test green.
 * Load only stretches the blocking past 60 s: index.card.test.js took 76 s,
 * then 270 s on 2026-09-24. Reproduced with 70 tests of 1 s synchronous work:
 * the error without this file, exit 0 with it.
 *
 * Two holes, two hooks:
 * - Between tests: one `setImmediate` turn lets the loop pass its poll phase,
 *   read the reply and clear the timer (`afterEach`).
 * - Inside one long test: the runner sends "test-prepare" right before the
 *   test's hooks, so a single test blocking for 60 s would still trip that
 *   call. `beforeEach` (and `beforeAll`, for a long suite setup) therefore
 *   waits until every RPC in flight has settled — vitest's own `rpcDone()`,
 *   the drain it runs before a worker exits. It lives in an internal chunk,
 *   so it is looked up defensively; if a vitest upgrade moves it, the hooks
 *   fall back to the plain loop turn and nothing breaks.
 *
 * `node:timers/promises` is used on purpose: its setImmediate is not the
 * global one, so a test that leaves fake timers installed cannot hang a hook.
 */

import { afterEach, beforeAll, beforeEach } from "vitest";
import { setImmediate as nextLoopTurn } from "node:timers/promises";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** vitest's `rpcDone()` (awaits every RPC call in flight), or null. */
async function findRpcDone() {
  try {
    const require = createRequire(import.meta.url);
    const chunks = path.join(path.dirname(require.resolve("vitest/package.json")), "dist", "chunks");
    for (const name of fs.readdirSync(chunks)) {
      if (!/^rpc\..*\.js$/.test(name)) continue;
      const mod = await import(pathToFileURL(path.join(chunks, name)).href);
      const fn = Object.values(mod).find((v) => typeof v === "function" && v.name === "rpcDone");
      if (fn) return fn;
    }
  } catch { /* layout changed — the loop turn still covers the gaps between tests */ }
  return null;
}

const rpcDone = await findRpcDone();

async function settleRpc() {
  if (rpcDone) {
    try {
      await rpcDone();
      return;
    } catch { /* a failed call is vitest's to report — just move on */ }
  }
  await nextLoopTurn();
}

beforeAll(() => settleRpc());
beforeEach(() => settleRpc());
afterEach(() => nextLoopTurn());
