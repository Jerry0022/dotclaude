import { describe, test, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for #225: the reload counter must survive a bridge-server
// restart in the sense that an already-open tab (which compares
// `counter > lastSeen`) still detects the next iteration. The server
// guarantees this by initializing the counter from epoch seconds, so a
// restarted server always reports a HIGHER counter than any counter handed
// out by a previous run — old tabs force-reload once and are back in sync.

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "concept-server.py");

function pythonCmd() {
  for (const cmd of ["python", "python3"]) {
    try {
      const r = spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 5000 });
      if (r.status === 0) return cmd;
    } catch { /* try next */ }
  }
  return null;
}

const PY = pythonCmd();
const PORT = 18000 + (process.pid % 1000);

function startServer() {
  const proc = spawn(PY, [SERVER, String(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
  return proc;
}

async function waitReady(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/reload`);
      if (res.ok) return res.json();
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error("bridge server did not come up");
}

function stopServer(proc) {
  return new Promise(resolve => {
    proc.once("exit", resolve);
    proc.kill();
    // Windows python sometimes ignores the soft kill — escalate.
    setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* gone */ } }, 2000);
  });
}

describe.skipIf(!PY)("concept-server refuses to double-bind its port (A3)", () => {
  // Regression for the "connection flickers for no reason" bug: on Windows the
  // default SO_REUSEADDR let a SECOND process bind the SAME port and hijack a
  // share of the connections. The server now binds exclusively, so a duplicate
  // launch must FAIL loudly (non-zero exit) instead of silently double-binding.
  test("a second instance on the same port exits non-zero instead of sharing it", async () => {
    const BIND_PORT = PORT + 1;
    const proc1 = spawn(PY, [SERVER, String(BIND_PORT)], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      // Wait until instance 1 actually owns the port.
      const deadline = Date.now() + 10000;
      let up = false;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(`http://127.0.0.1:${BIND_PORT}/reload`);
          if (r.ok) { up = true; break; }
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 150));
      }
      expect(up).toBe(true);

      // Instance 2 must fail to bind rather than silently double-bind.
      const proc2 = spawn(PY, [SERVER, String(BIND_PORT)], { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc2.stderr.on("data", d => { stderr += d.toString(); });
      const exitCode = await new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          try { proc2.kill("SIGKILL"); } catch { /* gone */ }
          reject(new Error("second instance did not exit — it may have silently double-bound"));
        }, 8000);
        proc2.once("exit", code => { clearTimeout(t); resolve(code); });
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/cannot bind port/i);
    } finally {
      await stopServer(proc1);
    }
  }, 30000);
});

describe.skipIf(!PY)("concept-server reload counter across restarts (#225)", () => {
  test("counter after restart is higher than any counter from the previous run", async () => {
    // Run 1: boot, bump the counter once (Claude wrote an iteration).
    const proc1 = startServer();
    let c1;
    try {
      await waitReady();
      const bump = await fetch(`http://127.0.0.1:${PORT}/reload`, { method: "POST" });
      expect(bump.ok).toBe(true);
      c1 = (await bump.json()).counter;
      expect(c1).toBeGreaterThan(0);
    } finally {
      await stopServer(proc1);
    }

    // Run 2: restart — an open tab still holds `lastSeen = c1`. The fresh
    // server must NOT hand out counters <= c1, otherwise the tab never
    // reloads again (the exact #225 incident).
    const proc2 = startServer();
    try {
      const { counter: c2 } = await waitReady();
      expect(c2).toBeGreaterThan(c1);
    } finally {
      await stopServer(proc2);
    }
  }, 30000);
});
