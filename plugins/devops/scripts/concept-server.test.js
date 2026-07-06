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
