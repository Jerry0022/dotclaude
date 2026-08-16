import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Integration proof for #284. The unit under test is the bridge's promise
// that a submission survives the process dying — so this test actually kills
// the process, which is the only way to test it honestly. A mocked server
// would re-assert the assumption that broke.
//
// The scenario is the reported one: Claude hits a usage limit, the
// session-scoped heartbeat pulser dies with the turn, and 30 min later the
// watchdog reaps a bridge still holding the user's unprocessed submission.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "..", "..", "scripts", "concept-server.py");
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pythonBin() {
  for (const bin of ["python", "python3", "py"]) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return bin;
  }
  return null;
}
const PY = pythonBin();

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(port, p, method = "GET", body) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* binary */ }
  return { status: res.status, json, buf };
}

async function boot(port, root, htmlRel) {
  const proc = spawn(PY, [SERVER, String(port), root, "--html", htmlRel], { stdio: "pipe" });
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    try {
      const r = await call(port, "/heartbeat");
      if (r.status === 200) return proc;
    } catch { /* not up yet */ }
  }
  proc.kill("SIGKILL");
  throw new Error("bridge never came up");
}

const SLUG = "2026-08-16-durability";
const results = {};
let root, store, port, proc;

beforeAll(async () => {
  if (!PY) return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "concept-dur-"));
  fs.mkdirSync(path.join(root, "docs", "concepts"), { recursive: true });
  const htmlRel = `docs/concepts/${SLUG}.html`;
  fs.writeFileSync(path.join(root, htmlRel), "<html><body>c</body></html>");
  store = path.join(root, ".claude", "concepts", SLUG);
  port = await freePort();

  // --- round 1: the user works ---
  proc = await boot(port, root, htmlRel);
  results.storeCreated = fs.existsSync(store);

  results.submit = (await call(port, "/decisions", "POST", {
    submitted: true, round: 1, action: "ship",
    comments: [{ id: "f1", text: "alles was ich erarbeiten musste", attachments: [] }],
  })).json;

  results.upload = (await call(port, "/attachments", "POST", {
    name: "shot.png", mime: "image/png", data: PNG_1PX,
  })).json;

  results.svgStatus = (await call(port, "/attachments", "POST", {
    name: "x.svg", mime: "image/svg+xml",
    data: Buffer.from("<svg onload=alert(1)/>").toString("base64"),
  })).status;

  await call(port, "/progress", "POST", {
    action: "ship", step: "pr-opened", status: "done",
    version: results.submit.version, artifacts: { branch: "feat/x", pr: 42 },
  });

  results.pendingBefore = (await call(port, "/pending")).json;

  // --- the kill: SIGKILL, no atexit, no graceful shutdown ---
  proc.kill("SIGKILL");
  await sleep(700);
  results.markerAfterKill = fs.existsSync(path.join(store, "UNPROCESSED"));

  // --- round 2: a new session finds it ---
  proc = await boot(port, root, htmlRel);
  results.pendingAfter = (await call(port, "/pending")).json;
  results.decisionsAfter = (await call(port, "/decisions")).json;
  results.recovery = (await call(port, "/recovery")).json;
  results.blob = await call(port, `/attachments/${results.upload.id}`);
  results.traversalStatus = (await call(port, "/attachments/../../../../state.json")).status;

  // --- processing completes ---
  results.resetStatus = (await call(port, "/reset", "POST", { version: results.submit.version })).status;
  results.markerAfterReset = fs.existsSync(path.join(store, "UNPROCESSED"));

  proc.kill("SIGKILL");
  await sleep(500);
  proc = await boot(port, root, htmlRel);
  results.pendingAfterReset = (await call(port, "/pending")).json;

  results.journal = fs
    .readFileSync(path.join(store, "journal.jsonl"), "utf8")
    .split("\n").filter(Boolean).map(JSON.parse);
}, 120_000);

afterAll(async () => {
  // Wait for the killed interpreter to actually go away before removing the
  // tree. On Windows its file handles outlive the SIGKILL by a moment, and
  // rmSync then fails EPERM — a teardown race that would fail the suite while
  // every assertion passed.
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    await new Promise(resolve => {
      proc.once("exit", resolve);
      try { proc.kill("SIGKILL"); } catch { resolve(); }
      setTimeout(resolve, 3000);
    });
  }
  await sleep(400);
  if (root) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  }
}, 30_000);

const it = PY ? test : test.skip;

describe("a submission survives the bridge being killed", () => {
  it("the bridge creates its durable store on startup", () => {
    expect(results.storeCreated).toBe(true);
  });

  it("POST /decisions only acks once the payload is on disk", () => {
    // `durable: true` is the contract the page relies on before it clears its
    // own copy. A bare 200 is not that promise.
    expect(results.submit.durable).toBe(true);
  });

  it("pending is true before the kill", () => {
    expect(results.pendingBefore.pending).toBe(true);
  });

  it("an UNPROCESSED marker outlives a SIGKILL", () => {
    expect(results.markerAfterKill).toBe(true);
  });

  it("pending is STILL true after the restart — this is the #284 regression", () => {
    // Before the fix this was {pending: false, version: 0}, which a resumed
    // session could not tell apart from "the user never submitted".
    expect(results.pendingAfter.pending).toBe(true);
    expect(results.pendingAfter.version).toBe(results.submit.version);
  });

  it("the payload itself is intact, not just the pending flag", () => {
    expect(results.decisionsAfter.comments[0].text).toBe("alles was ich erarbeiten musste");
  });
});

describe("/recovery tells a resumed session where it stood", () => {
  it("reports the submission as unprocessed", () => {
    expect(results.recovery.unprocessed).toBe(true);
  });

  it("surfaces the teardown marker as evidence of a hard exit", () => {
    expect(results.recovery.marker).toBeTruthy();
  });

  it("replays the progress checkpoint with its real-world artifacts", () => {
    expect(results.recovery.last_checkpoint.step).toBe("pr-opened");
    expect(results.recovery.last_checkpoint.artifacts).toEqual({ branch: "feat/x", pr: 42 });
  });
});

describe("attachments are durable and safe to serve", () => {
  it("an image uploaded on attach is content-addressed by sha256", () => {
    expect(results.upload.ok).toBe(true);
    expect(results.upload.id).toMatch(/^[0-9a-f]{64}\.png$/);
  });

  it("it reads back byte-identical after the restart", () => {
    expect(results.blob.status).toBe(200);
    expect(results.blob.buf.equals(Buffer.from(PNG_1PX, "base64"))).toBe(true);
  });

  it("SVG is rejected — it would run script on the bridge origin", () => {
    expect(results.svgStatus).toBe(415);
  });

  it("a traversal attempt on the attachment route is refused", () => {
    expect(results.traversalStatus).toBe(404);
  });
});

describe("a processed submission stays processed", () => {
  it("reset clears the marker", () => {
    expect(results.resetStatus).toBe(200);
    expect(results.markerAfterReset).toBe(false);
  });

  it("it does not come back as pending after another restart", () => {
    // The mirror image of the bug: recovery must not resurrect work Claude
    // already acted on, or every restart would re-run the last submission.
    expect(results.pendingAfterReset.pending).toBe(false);
  });

  it("the journal keeps the whole history append-only across all three runs", () => {
    const types = results.journal.map(r => r.type);
    expect(types.filter(t => t === "submission")).toHaveLength(1);
    expect(types).toContain("processed");
    expect(types.filter(t => t === "restore").length).toBeGreaterThanOrEqual(2);
  });
});
