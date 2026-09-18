import { describe, test, expect, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bridgeFile } from "./concept-port-registry.js";

// This file spawns real processes (hooks, scripts, or a server). The full suite
// runs 64 files in parallel, all starting `node` at once, so process-start tail
// latency reaches many times its isolated cost — enough for a spawn-heavy test
// to blow the 5s default on a load spike rather than on a defect. Measured
// 2026-08-16: the worst offender costs 832ms isolated and still timed out at 5s
// during a full run. 30s leaves that headroom and still catches a genuine hang.
vi.setConfig({ testTimeout: 30_000 });

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

// Every server spawned below inherits this env, so its registry entry lands in
// a throw-away directory — never in ~/.claude/concept-bridges. The SIGKILL
// teardowns in this file skip the server's own removal paths, and before this
// override each run left its entries behind in the user's real registry.
process.env.CONCEPT_BRIDGE_REGISTRY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "concept-bridges-test-"));

// Same pattern for the durable store (#342): a server started without --html
// anchors its store at .claude/concepts/port-<n>/ in its cwd — the worktree
// this suite runs from — and every spawn below left one behind. Point each
// spawn at a throw-away store instead, so .claude/concepts/ only ever holds
// real concept sessions and the UNPROCESSED guard + orphan sweep stay meaningful.
const STORE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "concept-store-test-"));
const storeFor = (port) => path.join(STORE_ROOT, String(port));

// Snapshot of the port-* stores that already exist in the cwd before the suite
// runs (debris from older plugin versions is not this suite's to judge) — the
// afterAll asserts that THIS run added none.
const CONCEPTS_DIR = path.join(process.cwd(), ".claude", "concepts");
const listPortStores = () => {
  try { return fs.readdirSync(CONCEPTS_DIR).filter(d => /^port-\d+$/.test(d)).sort(); }
  catch { return []; }
};
const portStoresBefore = listPortStores();

afterAll(() => {
  expect(listPortStores()).toEqual(portStoresBefore);
  try { fs.rmSync(STORE_ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

function startServer() {
  const proc = spawn(PY, [SERVER, String(PORT), "--store", storeFor(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
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
    const proc1 = spawn(PY, [SERVER, String(BIND_PORT), "--store", storeFor(BIND_PORT)], { stdio: ["ignore", "pipe", "pipe"] });
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
      const proc2 = spawn(PY, [SERVER, String(BIND_PORT), "--store", storeFor(BIND_PORT)], { stdio: ["ignore", "pipe", "pipe"] });
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

describe.skipIf(!PY)("concept-server cross-session port registry (Defect B)", () => {
  // The bridge advertises {port, pid, worktree, ...} at
  // ~/.claude/concept-bridges/<port>.json so a concurrent session can see the
  // port is taken (and pick another) instead of blindly sweeping it. The entry
  // must appear on bind and be removed on graceful /shutdown.
  test("writes its registry entry on bind and removes it on /shutdown", async () => {
    const REG_PORT = PORT + 2;
    const regFile = bridgeFile(REG_PORT);
    try { fs.unlinkSync(regFile); } catch { /* not there */ }
    const proc = spawn(PY, [SERVER, String(REG_PORT), ".", "--store", storeFor(REG_PORT)], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      const deadline = Date.now() + 10000;
      let up = false;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(`http://127.0.0.1:${REG_PORT}/reload`);
          if (r.ok) { up = true; break; }
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 150));
      }
      expect(up).toBe(true);

      // Entry exists and identifies THIS server (pid + a worktree string).
      expect(fs.existsSync(regFile)).toBe(true);
      const entry = JSON.parse(fs.readFileSync(regFile, "utf8"));
      expect(entry.port).toBe(REG_PORT);
      expect(entry.pid).toBe(proc.pid);
      expect(typeof entry.worktree).toBe("string");

      // Graceful /shutdown drops the entry.
      await fetch(`http://127.0.0.1:${REG_PORT}/shutdown`, { method: "POST" });
      const goneBy = Date.now() + 5000;
      while (Date.now() < goneBy && fs.existsSync(regFile)) {
        await new Promise(r => setTimeout(r, 100));
      }
      expect(fs.existsSync(regFile)).toBe(false);
    } finally {
      try { proc.kill("SIGKILL"); } catch { /* gone */ }
      try { fs.unlinkSync(regFile); } catch { /* already cleaned */ }
    }
  }, 30000);
});

describe.skipIf(!PY)("concept-server browser_ts — the last browser poll (#363)", () => {
  test("GET /heartbeat and GET /reload stamp browser_ts; POST /heartbeat and GET /pending do not", async () => {
    const proc = startServer();
    try {
      await waitReady();                                                        // one GET /reload already happened here
      const t0 = (await (await fetch(`http://127.0.0.1:${PORT}/heartbeat`)).json());
      expect(t0.browser_ts).toBeGreaterThan(0);                                 // waitReady's GET /reload counted
      expect(t0.claude_ts).toBe(0);                                             // nobody POSTed yet

      await new Promise(r => setTimeout(r, 30));
      await fetch(`http://127.0.0.1:${PORT}/heartbeat`, { method: "POST" });    // Claude's pulser
      const p1 = await (await fetch(`http://127.0.0.1:${PORT}/pending`)).json(); // Claude's waker
      expect(p1).toMatchObject({ pending: false, version: 0 });
      expect(typeof p1.browser_ts).toBe("number");
      const seenAfterClaude = p1.browser_ts;
      const p2 = await (await fetch(`http://127.0.0.1:${PORT}/pending`)).json();
      expect(p2.browser_ts).toBe(seenAfterClaude);                              // neither Claude call moved it

      await new Promise(r => setTimeout(r, 30));
      await fetch(`http://127.0.0.1:${PORT}/reload`);                          // a browser tab polled
      const p3 = await (await fetch(`http://127.0.0.1:${PORT}/pending`)).json();
      expect(p3.browser_ts).toBeGreaterThan(seenAfterClaude);
      expect(p3.action).toBe("");                                               // nothing pending → no action

      // A submission names its action on /pending so the waker's exit line can carry it.
      const post = await fetch(`http://127.0.0.1:${PORT}/decisions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submitted: true, action: "implement", decisions: [], comments: [] }),
      });
      expect(post.ok).toBe(true);
      const p4 = await (await fetch(`http://127.0.0.1:${PORT}/pending`)).json();
      expect(p4).toMatchObject({ pending: true, version: 1, action: "implement" });
    } finally {
      await stopServer(proc);
    }
  });
});

describe.skipIf(!PY)("concept-server per-tab registry and /bye (#397)", () => {
  test("tabs register on ?tab= polls, leave on POST /bye; /pending reports browser_tabs + browser_bye_ts", async () => {
    const proc = startServer();
    try {
      await waitReady();                                                        // a bare GET /reload — no tab id → not registered
      const p0 = await (await fetch(`http://127.0.0.1:${PORT}/pending`)).json();
      expect(p0).toMatchObject({ browser_tabs: 0, browser_bye_ts: 0 });

      await fetch(`http://127.0.0.1:${PORT}/heartbeat?tab=tabA`);              // tab A polls the indicator
      await fetch(`http://127.0.0.1:${PORT}/reload?tab=tabB`);                 // tab B polls the reload watcher
      await fetch(`http://127.0.0.1:${PORT}/heartbeat?tab=<bad id>`);          // invalid id → counted as a poll, not as a tab
      const p1 = await (await fetch(`http://127.0.0.1:${PORT}/pending`)).json();
      expect(p1.browser_tabs).toBe(2);
      expect(p1.browser_ts).toBeGreaterThan(0);

      // Tab A unloads — the beacon carries its id; B is still known → the page is open.
      const bye = await fetch(`http://127.0.0.1:${PORT}/bye`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tab: "tabA" }),
      });
      expect(bye.ok).toBe(true);
      expect(await bye.json()).toEqual({ ok: true, tabs: 1 });
      const p2 = await (await fetch(`http://127.0.0.1:${PORT}/pending`)).json();
      expect(p2.browser_tabs).toBe(1);
      expect(p2.browser_bye_ts).toBeGreaterThan(0);

      // A bye for an unknown / missing id still stamps browser_bye_ts and never throws.
      await new Promise(r => setTimeout(r, 20));
      const bye2 = await fetch(`http://127.0.0.1:${PORT}/bye`, { method: "POST", body: "" });
      expect(bye2.ok).toBe(true);
      const p3 = await (await fetch(`http://127.0.0.1:${PORT}/pending`)).json();
      expect(p3.browser_bye_ts).toBeGreaterThan(p2.browser_bye_ts);
      expect(p3.browser_tabs).toBe(1);                                           // B untouched

      // Last tab says bye → nothing registered.
      await fetch(`http://127.0.0.1:${PORT}/bye`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tab: "tabB" }),
      });
      const p4 = await (await fetch(`http://127.0.0.1:${PORT}/pending`)).json();
      expect(p4.browser_tabs).toBe(0);

      // A foreign origin is refused like every other data-bearing POST.
      const evil = await fetch(`http://127.0.0.1:${PORT}/bye`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example" }, body: JSON.stringify({ tab: "tabB" }),
      });
      expect(evil.status).toBe(403);
    } finally {
      await stopServer(proc);
    }
  });
});
