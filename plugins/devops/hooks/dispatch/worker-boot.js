'use strict';
/**
 * @module dispatch/worker-boot
 * @version 0.1.0
 * @plugin devops
 * @description Bootstrap of one dispatcher worker thread: makes a hook file
 *   run as if `node <file>` had started it, then runs it as the main module.
 *   A worker thread already gives each module what a fresh process gave it —
 *   its own module registry (module-level caches start empty), its own
 *   process.exit (ends only this thread), its own process.env copy and its
 *   own process.stdout / process.stderr (captured by the dispatcher).
 *   The shims below close the remaining gaps:
 *     - process.stdin is an in-thread stream that yields the payload, then
 *       ends (a worker's piped stdin kept the thread alive when the module
 *       never read it)
 *     - a module that ends by draining its event loop exits with its
 *       process.exitCode (a worker thread otherwise reports 0 — a gate that
 *       sets exitCode = 2 would silently stop blocking)
 *     - fs.readFileSync(0 | '/dev/stdin') returns the payload (fd 0 is the
 *       dispatcher's, already drained) — lib/hook-input.sessionCwd and
 *       prompt.batch.collect read stdin this way
 *     - fs.writeSync(1 | 2, …) goes through process.stdout / process.stderr
 *       (prompt.batch.collect writes its verdict with fs.writeSync(1))
 *     - process.argv = [execPath, file] (require.main === module, telemetry's
 *       hook name, mcp-reaper's own-script check)
 *   The worker waits for a `go` message so the dispatcher can create the next
 *   worker while the current module runs (thread start-up off the clock).
 */

const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');

const payload = String(workerData.payload || '');
const realRead = fs.readFileSync;
fs.readFileSync = function readFileSync(p, ...rest) {
  if (p === 0 || p === '/dev/stdin') {
    const opt = rest[0];
    const enc = typeof opt === 'string' ? opt : opt && opt.encoding;
    return enc ? payload : Buffer.from(payload, 'utf8');
  }
  return realRead.call(this, p, ...rest);
};
const realWriteSync = fs.writeSync;
fs.writeSync = function writeSync(fd, data, ...rest) {
  if (fd === 1 || fd === 2) {
    const stream = fd === 1 ? process.stdout : process.stderr;
    let chunk = data;
    if (typeof data !== 'string' && data && typeof data.length === 'number') {
      const offset = typeof rest[0] === 'number' ? rest[0] : 0;
      const length = typeof rest[1] === 'number' ? rest[1] : data.length - offset;
      chunk = Buffer.from(data.buffer, data.byteOffset + offset, length);
    }
    stream.write(chunk);
    return typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
  }
  return realWriteSync.call(this, fd, data, ...rest);
};

const { PassThrough } = require('stream');
const stdin = new PassThrough();
stdin.fd = 0;
stdin.end(payload);
Object.defineProperty(process, 'stdin', { configurable: true, enumerable: true, get: () => stdin });

process.argv = [process.execPath, workerData.file];
// workerData.telemetryId is read by lib/hook-telemetry (never via env: a
// child the hook spawns must not inherit it)

function run() {
  require('module').runMain(workerData.file);
  // after the module's own synchronous beforeExit listeners
  process.on('beforeExit', () => process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0));
}

if (workerData.wait && parentPort) {
  parentPort.once('message', () => {
    parentPort.unref();
    run();
  });
} else {
  run();
}
