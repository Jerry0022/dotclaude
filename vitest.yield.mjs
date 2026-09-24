/**
 * Give the worker's event loop one full turn after every test (setupFiles).
 *
 * Vitest reports each finished test to the main process over an RPC with a
 * 60 s timer. The reply only lands when the worker's loop reaches its poll
 * phase. A file whose tests are async on the outside but synchronous inside —
 * index.card.test.js renders 42 cards, each shelling out to git through
 * execFileSync — chains test after test through already-resolved promises,
 * i.e. microtasks only: 137 s without a single loop turn under load. The first
 * turn then runs the timers phase before the poll phase, the RPC timer fires
 * although its reply sat in the pipe, and the run exits 1 with
 * `Timeout calling "onTaskUpdate"` next to a fully green suite.
 *
 * setImmediate resolves in the check phase, after poll, so every test end
 * drains pending RPC replies. Cost: one loop turn per test.
 */

import { afterEach } from "vitest";

afterEach(() => new Promise((resolve) => setImmediate(resolve)));
