import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Integration proof for the draft store: everything the user has typed and
// NOT yet submitted must survive the bridge dying, a client that posts a blank
// blob, a torn journal line, and a restart — because localStorage alone
// survives none of those, and the reported failure ("switching iterations, all
// my comments were gone") is exactly what that looks like from the user's
// side.
//
// Like bridge-durability.test.js, this kills the real process rather than
// mocking one: durability that is only asserted in a mock is not durability.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "..", "..", "scripts", "concept-server.py");

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

async function call(port, p, method = "GET", body, extraHeaders = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
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

const SLUG = "2026-09-05-draft-durability";
const results = {};
let root, store, port, proc;

// Two rounds of typing, namespaced the way § State Persistence namespaces
// them. The point of the namespace is that `d1-s1` in round 1 and `d1-s1` in
// round 2 are different notes; both must survive independently.
const ROUND1 = {
  "text:i1:general": "Die Nav ist zu voll",
  "text:i1:d1-s1": "Screen 1 braucht mehr Kontrast",
  "input:choice:yes": true,
};
const ROUND2 = {
  ...ROUND1,
  "text:i2:d1-s1": "zweite Runde, anderer Screen-Kommentar",
};

beforeAll(async () => {
  if (!PY) return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "concept-draft-"));
  fs.mkdirSync(path.join(root, "docs", "concepts"), { recursive: true });
  const htmlRel = `docs/concepts/${SLUG}.html`;
  fs.writeFileSync(path.join(root, htmlRel), "<html><body>c</body></html>");
  store = path.join(root, ".claude", "concepts", SLUG);
  port = await freePort();

  proc = await boot(port, root, htmlRel);

  // --- the user types (two autosaves) ---
  results.save1 = (await call(port, "/draft", "POST", {
    slug: SLUG, page_version: "v1", iteration: "1", state: ROUND1,
  })).json;
  results.save2 = (await call(port, "/draft", "POST", {
    slug: SLUG, page_version: "v1", iteration: "2", state: ROUND2,
  })).json;

  results.draftsDir = fs.existsSync(path.join(store, "drafts"));
  results.onDisk = fs.existsSync(path.join(store, "drafts", `${SLUG}.jsonl`))
    && fs.existsSync(path.join(store, "drafts", `${SLUG}.json`));

  results.readBack = (await call(port, `/draft?slug=${SLUG}`)).json;

  // --- a broken client posts a BLANK blob ---
  // This is the shape every past data-loss bug took: a rebuilt-but-not-yet-
  // restored dock serialised as empty strings over the stored notes. The
  // append-only log must make it survivable.
  results.blankAck = (await call(port, "/draft", "POST", {
    slug: SLUG, page_version: "v1", iteration: "2",
    state: { "text:i1:general": "", "text:i1:d1-s1": "", "text:i2:d1-s1": "" },
  })).json;
  results.afterBlank = (await call(port, `/draft?slug=${SLUG}`)).json;

  // --- a deliberate clear must NOT come back ---
  results.clearAck = (await call(port, "/draft", "POST", {
    slug: SLUG, page_version: "v1", iteration: "1",
    state: { ...ROUND2, "text:i1:general": "" },
    cleared: ["text:i1:general"],
  })).json;
  results.afterClear = (await call(port, `/draft?slug=${SLUG}`)).json;

  // --- retyped after a clear: the clear must not be sticky ---
  results.retypeAck = (await call(port, "/draft", "POST", {
    slug: SLUG, page_version: "v1", iteration: "1",
    state: { ...ROUND2, "text:i1:general": "doch wieder was" },
  })).json;
  results.afterRetype = (await call(port, `/draft?slug=${SLUG}`)).json;

  // --- guards ---
  results.badSlug = await call(port, "/draft", "POST", {
    slug: "../../../evil", state: { "text:i1:x": "nope" },
  });
  results.badSlugGet = await call(port, "/draft?slug=..%2F..%2Fevil");
  results.foreignOrigin = await call(port, "/draft", "POST",
    { slug: SLUG, state: {} }, { Origin: "http://evil.test" });
  results.foreignOriginGet = await call(port, `/draft?slug=${SLUG}`, "GET",
    undefined, { Origin: "http://evil.test" });
  results.notADict = await call(port, "/draft", "POST", { slug: SLUG, state: "nope" });
  results.unknownSlug = (await call(port, "/draft?slug=never-seen-this")).json;

  results.recovery = (await call(port, "/recovery")).json;

  // --- power loss: SIGKILL, no chance to flush anything ---
  proc.kill("SIGKILL");
  await sleep(400);
  results.deadProbe = await call(port, "/heartbeat").catch(() => ({ status: 0 }));

  // A torn final line is what a real power cut leaves behind mid-append.
  const logPath = path.join(store, "drafts", `${SLUG}.jsonl`);
  fs.appendFileSync(logPath, '{"rev": 99, "state": {"text:i1:torn": "hal');

  // --- the bridge comes back ---
  port = await freePort();
  proc = await boot(port, root, htmlRel);
  results.afterRestart = (await call(port, `/draft?slug=${SLUG}`)).json;
  results.saveAfterRestart = (await call(port, "/draft", "POST", {
    slug: SLUG, page_version: "v1", iteration: "2", state: ROUND2,
  })).json;
  results.finalRead = (await call(port, `/draft?slug=${SLUG}`)).json;
}, 90_000);

afterAll(async () => {
  if (proc) { try { proc.kill("SIGKILL"); } catch { /* already gone */ } }
  await sleep(200);
  if (root) { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

const it = PY ? test : test.skip;

describe("draft store — unsent comments survive", () => {
  it("creates the drafts directory as part of the store", () => {
    expect(results.draftsDir).toBe(true);
  });

  it("acks a draft only as durable, with a monotonic revision", () => {
    expect(results.save1).toMatchObject({ ok: true, durable: true, rev: 1 });
    expect(results.save2).toMatchObject({ ok: true, durable: true, rev: 2 });
  });

  it("writes both the append-only log and the latest snapshot", () => {
    expect(results.onDisk).toBe(true);
  });

  it("reads the latest state back verbatim", () => {
    expect(results.readBack.found).toBe(true);
    expect(results.readBack.state).toEqual(ROUND2);
    expect(results.readBack.iteration).toBe("2");
    expect(results.readBack.page_version).toBe("v1");
  });

  it("recovers only typed keys, keyed per iteration", () => {
    // input:/select:/range: are cheap to redo and deliberately not part of the
    // union; the two rounds' same-id notes must not collapse into one.
    expect(results.readBack.recovered).toEqual({
      "text:i1:general": ROUND1["text:i1:general"],
      "text:i1:d1-s1": ROUND1["text:i1:d1-s1"],
      "text:i2:d1-s1": ROUND2["text:i2:d1-s1"],
    });
    expect(results.readBack.recovered["input:choice:yes"]).toBeUndefined();
  });

  it("survives a client that blanks every field", () => {
    // The blank write is accepted (it may be a legitimate clear-all) but the
    // union still holds every note. THIS is the guarantee: a page bug can no
    // longer destroy anything.
    expect(results.blankAck.ok).toBe(true);
    expect(results.afterBlank.state).toEqual({
      "text:i1:general": "", "text:i1:d1-s1": "", "text:i2:d1-s1": "",
    });
    expect(results.afterBlank.recovered["text:i1:d1-s1"]).toBe(ROUND1["text:i1:d1-s1"]);
    expect(results.afterBlank.recovered["text:i2:d1-s1"]).toBe(ROUND2["text:i2:d1-s1"]);
  });

  it("honours a DELIBERATE clear — a deleted note stays deleted", () => {
    expect(results.clearAck.ok).toBe(true);
    expect(results.afterClear.recovered["text:i1:general"]).toBeUndefined();
    // …and only that one.
    expect(results.afterClear.recovered["text:i1:d1-s1"]).toBe(ROUND1["text:i1:d1-s1"]);
  });

  it("un-sticks a clear as soon as the user types there again", () => {
    expect(results.afterRetype.recovered["text:i1:general"]).toBe("doch wieder was");
  });

  it("refuses a slug that could escape the drafts directory", () => {
    expect(results.badSlug.status).toBe(400);
    expect(results.badSlug.json.reason).toBe("bad_slug");
    expect(results.badSlugGet.status).toBe(400);
    // Nothing was written anywhere near the store root.
    const strays = fs.readdirSync(path.dirname(store))
      .filter(n => n.toLowerCase().includes("evil"));
    expect(strays).toEqual([]);
  });

  it("refuses a foreign origin on both directions", () => {
    // The payload is everything the user typed — read and write are both
    // same-origin only, exactly like /recovery and /attachments.
    expect(results.foreignOrigin.status).toBe(403);
    expect(results.foreignOriginGet.status).toBe(403);
  });

  it("refuses a non-object state", () => {
    expect(results.notADict.status).toBe(400);
  });

  it("reports a page it has never seen as not found, not as an error", () => {
    expect(results.unknownSlug).toMatchObject({ ok: true, found: false });
    expect(results.unknownSlug.recovered).toEqual({});
  });

  it("lists drafts in /recovery so a resumed session knows they exist", () => {
    const mine = (results.recovery.drafts || []).find(d => d.slug === SLUG);
    expect(mine, "draft summary in /recovery").toBeTruthy();
    expect(mine.recoverable_keys).toBeGreaterThan(0);
    expect(mine.chars).toBeGreaterThan(0);
    expect(mine.iteration).toBe("1");
  });

  it("really was killed, not asked politely to stop", () => {
    expect(results.deadProbe.status).toBe(0);
  });

  it("still has every comment after SIGKILL + restart + a torn last line", () => {
    // The torn line is skipped; everything appended before it is intact. A
    // rewrite-in-place store would have had nothing to fall back to here.
    expect(results.afterRestart.found).toBe(true);
    expect(results.afterRestart.recovered["text:i1:d1-s1"]).toBe(ROUND1["text:i1:d1-s1"]);
    expect(results.afterRestart.recovered["text:i2:d1-s1"]).toBe(ROUND2["text:i2:d1-s1"]);
    expect(results.afterRestart.recovered["text:i1:general"]).toBe("doch wieder was");
    expect(results.afterRestart.recovered["text:i1:torn"]).toBeUndefined();
  });

  it("continues the revision count after a restart instead of restarting it", () => {
    // A reset-to-1 would make a resumed session's log ambiguous about which
    // snapshot is newer.
    expect(results.saveAfterRestart.rev).toBeGreaterThan(results.retypeAck.rev);
    expect(results.finalRead.rev).toBe(results.saveAfterRestart.rev);
  });
});
