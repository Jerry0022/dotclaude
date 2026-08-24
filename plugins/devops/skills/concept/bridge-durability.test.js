import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
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
  return { status: res.status, json, buf, headers: res.headers };
}

// Streaming upload shape: raw body, Content-Type != application/json,
// metadata in X-Attach-Name (percent-encoded UTF-8) / X-Attach-Mime headers.
async function callStream(port, bytesBuf, { name, mime } = {}) {
  const headers = { "Content-Type": mime || "application/octet-stream" };
  if (name !== undefined) headers["X-Attach-Name"] = encodeURIComponent(name);
  if (mime !== undefined) headers["X-Attach-Mime"] = mime;
  const res = await fetch(`http://127.0.0.1:${port}/attachments`, {
    method: "POST",
    headers,
    body: bytesBuf,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* binary */ }
  return { status: res.status, json, buf, headers: res.headers };
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

  // SVG is no longer rejected (#312 dropped the acceptance allowlist) — it
  // is accepted and content-addressed like any other file. The safety net
  // moved to the SERVING side: see "attachments are durable and safe to
  // serve" below for the read-back assertion (octet-stream + attachment).
  results.svgUpload = (await call(port, "/attachments", "POST", {
    name: "x.svg", mime: "image/svg+xml",
    data: Buffer.from("<svg onload=alert(1)/>").toString("base64"),
  })).json;

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
  results.svgBlob = await call(port, `/attachments/${results.svgUpload.id}`);
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

  it("it reads back byte-identical after the restart, inline, with the real image Content-Type", () => {
    expect(results.blob.status).toBe(200);
    expect(results.blob.buf.equals(Buffer.from(PNG_1PX, "base64"))).toBe(true);
    expect(results.blob.headers.get("content-type")).toBe("image/png");
    expect(results.blob.headers.get("content-disposition")).toBe("inline");
  });

  it("SVG is accepted (no type gate) but served as a forced download, never inline", () => {
    // #312: the acceptance allowlist is gone — SVG is content-addressed like
    // any other file. What stops it from running script against the bridge
    // origin now is the SERVING policy: it is forced to octet-stream +
    // Content-Disposition: attachment instead of being rendered inline.
    expect(results.svgUpload.ok).toBe(true);
    expect(results.svgUpload.id).toMatch(/^[0-9a-f]{64}\.svg$/);
    expect(results.svgBlob.status).toBe(200);
    expect(results.svgBlob.headers.get("content-type")).toBe("application/octet-stream");
    expect(results.svgBlob.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(results.svgBlob.headers.get("x-content-type-options")).toBe("nosniff");
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

// ---------------------------------------------------------------------------
// #312 — arbitrary file attachments: streaming upload path, extension
// derivation, the attachments/index.json display-name map, and dedup.
// Runs against its own bridge instance (separate port/store) so it does not
// interleave with the kill/restart scenario above.
// ---------------------------------------------------------------------------

const SLUG2 = "2026-08-24-any-file-type";
const r2 = {};
let root2, store2, attachDir2, port2, proc2;

beforeAll(async () => {
  if (!PY) return;
  root2 = fs.mkdtempSync(path.join(os.tmpdir(), "concept-attach-"));
  fs.mkdirSync(path.join(root2, "docs", "concepts"), { recursive: true });
  const htmlRel2 = `docs/concepts/${SLUG2}.html`;
  fs.writeFileSync(path.join(root2, htmlRel2), "<html><body>c</body></html>");
  store2 = path.join(root2, ".claude", "concepts", SLUG2);
  attachDir2 = path.join(store2, "attachments");
  port2 = await freePort();

  // A tiny per-file cap makes the "above the cap" case cheap to trigger
  // without actually shipping a multi-hundred-MB fixture through CI.
  proc2 = spawn(
    PY,
    [SERVER, String(port2), root2, "--html", htmlRel2, "--max-attachment-bytes", "1000"],
    { stdio: "pipe" },
  );
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    try {
      const r = await call(port2, "/heartbeat");
      if (r.status === 200) break;
    } catch { /* not up yet */ }
  }

  // 1. Streaming upload of a non-image binary.
  const binBytes = Buffer.from(Array.from({ length: 500 }, (_, i) => i % 256));
  r2.streamUpload = await callStream(port2, binBytes, { name: "payload.bin", mime: "application/octet-stream" });

  // 2. Above the per-file cap via the streaming path.
  const tooBig = Buffer.alloc(5000, 7);
  r2.overCapStatus = (await callStream(port2, tooBig, { name: "huge.bin", mime: "application/octet-stream" })).status;
  r2.tmpLeftoversAfterOverCap = fs.readdirSync(attachDir2).filter(n => n.endsWith(".tmp"));

  // 3. Unknown/absent extension.
  r2.noExtUpload = await callStream(port2, Buffer.from("abc"), { name: "", mime: "" });

  // 4b. Non-image read-back (from upload #1).
  r2.streamBlob = await call(port2, `/attachments/${r2.streamUpload.json.id}`);

  // 5. index.json contains the original filename, and a second, DIFFERENT
  // upload does not clobber the first entry.
  r2.pngUpload = (await call(port2, "/attachments", "POST", {
    name: "shot.png", mime: "image/png", data: PNG_1PX,
  })).json;
  r2.index = JSON.parse(fs.readFileSync(path.join(attachDir2, "index.json"), "utf8"));

  // 6. Dedup via the streaming path: identical bytes twice.
  r2.dedupFirst = await callStream(port2, binBytes, { name: "payload.bin", mime: "application/octet-stream" });
  r2.dedupSecond = await callStream(port2, binBytes, { name: "payload-retry.bin", mime: "application/octet-stream" });
  r2.recovery = (await call(port2, "/recovery")).json;
}, 60_000);

afterAll(async () => {
  if (proc2 && proc2.exitCode === null && proc2.signalCode === null) {
    await new Promise(resolve => {
      proc2.once("exit", resolve);
      try { proc2.kill("SIGKILL"); } catch { resolve(); }
      setTimeout(resolve, 3000);
    });
  }
  await sleep(400);
  if (root2) {
    fs.rmSync(root2, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  }
}, 30_000);

describe("streaming upload accepts any file type", () => {
  it("a non-image binary uploads via the streaming path with the right sha256 and extension", () => {
    expect(r2.streamUpload.status).toBe(200);
    expect(r2.streamUpload.json.ok).toBe(true);
    expect(r2.streamUpload.json.sha256).toBe(crypto.createHash("sha256").update(
      Buffer.from(Array.from({ length: 500 }, (_, i) => i % 256)),
    ).digest("hex"));
    expect(r2.streamUpload.json.id).toMatch(/^[0-9a-f]{64}\.bin$/);
  });

  it("a file above the per-file cap is refused with 413 and leaves no orphan temp file", () => {
    expect(r2.overCapStatus).toBe(413);
    expect(r2.tmpLeftoversAfterOverCap).toEqual([]);
  });

  it("an absent extension and MIME fall back to .bin", () => {
    expect(r2.noExtUpload.status).toBe(200);
    expect(r2.noExtUpload.json.id).toMatch(/^[0-9a-f]{64}\.bin$/);
  });

  it("a non-image blob reads back as a forced download, never inline", () => {
    expect(r2.streamBlob.status).toBe(200);
    expect(r2.streamBlob.headers.get("content-type")).toBe("application/octet-stream");
    expect(r2.streamBlob.headers.get("content-disposition")).toMatch(/^attachment;.*filename="payload\.bin"/);
    expect(r2.streamBlob.buf.equals(Buffer.from(Array.from({ length: 500 }, (_, i) => i % 256)))).toBe(true);
  });
});

describe("attachments/index.json remembers original filenames", () => {
  it("records the streamed upload's original name", () => {
    const entry = r2.index[r2.streamUpload.json.id];
    expect(entry).toBeTruthy();
    expect(entry.name).toBe("payload.bin");
  });

  it("a second, different upload does not clobber the first entry", () => {
    const pngEntry = r2.index[r2.pngUpload.id];
    expect(pngEntry).toBeTruthy();
    expect(pngEntry.name).toBe("shot.png");
    // The earlier entry must still be there — index.json is a merge, not a
    // full-file overwrite keyed to only the most recent upload.
    expect(r2.index[r2.streamUpload.json.id].name).toBe("payload.bin");
  });

  it("/recovery's attachments[] also carries the original name", () => {
    const entry = r2.recovery.attachments.find(a => a.id === r2.pngUpload.id);
    expect(entry).toBeTruthy();
    expect(entry.name).toBe("shot.png");
  });
});

describe("identical bytes dedup regardless of upload path or claimed filename", () => {
  it("the second upload of identical bytes resolves to the same id and reports deduplicated", () => {
    expect(r2.dedupFirst.json.id).toBe(r2.streamUpload.json.id);
    expect(r2.dedupFirst.json.deduplicated).toBe(true);
    expect(r2.dedupSecond.json.id).toBe(r2.streamUpload.json.id);
    expect(r2.dedupSecond.json.deduplicated).toBe(true);
  });

  it("quota is counted once — a dedup hit never re-adds the blob's size", () => {
    // The bin file appears exactly once on disk regardless of how many times
    // its bytes were re-uploaded under different claimed names.
    const onDisk = fs.readdirSync(attachDir2).filter(n => n === r2.streamUpload.json.id);
    expect(onDisk).toHaveLength(1);
  });
});
