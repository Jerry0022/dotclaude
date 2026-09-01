import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// The CLI fallback exists for the session where the MCP server never connected
// (CONNECT_TIMEOUT under load, mid-session cache rebuild, crashed spawn). It is
// therefore exercised the way it is actually used: as a real child process, on a
// bare node. That also pins the property that makes it a fallback at all — the
// repo checkout has no node_modules under mcp-server/, so if the entry file ever
// pulls the MCP SDK or zod in before the CLI branch, this test fails to spawn.
//
// Async execFile, never execFileSync: a sync spawn blocks the vitest worker's
// event loop for the child's whole lifetime, which starves the worker's RPC and
// fails the RUN with `[vitest-worker]: Timeout calling "onTaskUpdate"` even
// though every test passed.
const run = promisify(execFile);

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "index.js");

// Each case spawns node and shells out to git for the build-ID. Under full
// parallel suite load that comfortably exceeds the 5s default.
vi.setConfig({ testTimeout: 30_000 });

// Never spawn the headless usage scraper (Edge) from a unit test.
const CHILD_ENV = { ...process.env, DEVOPS_COMPLETION_NO_USAGE: "1" };

let workDir;

async function renderCard(payload) {
  const file = join(workDir, `payload-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(payload));
  const { stdout } = await run(process.execPath, [ENTRY, "--render-card", file], {
    encoding: "utf8",
    env: CHILD_ENV,
  });
  return stdout;
}

function flagFile(sessionId) {
  return join(tmpdir(), `dotclaude-devops-card-rendered-${sessionId}`);
}

function attestedFile(sessionId) {
  return join(tmpdir(), `dotclaude-devops-validation-attested-${sessionId}`);
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "devops-card-cli-"));
});

afterAll(() => {
  try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("--render-card CLI fallback", () => {
  test("renders the same card markdown the MCP tool returns", async () => {
    const out = await renderCard({
      variant: "analysis",
      summary: "Karte ohne MCP-Server",
      lang: "de",
      session_id: "cli-test-basic",
      changes: [{ area: "Completion card", description: "Rendert auch ohne MCP" }],
    });

    expect(out).toMatch(/^### \*\*✨✨✨ Karte ohne MCP-Server ✨✨✨\*\*/m);
    expect(out).toContain("Completion card → Rendert auch ohne MCP");
  });

  test("stdout carries the card only — no relay-instruction preamble to strip", async () => {
    const out = await renderCard({ variant: "analysis", summary: "Nur die Karte", session_id: "cli-test-clean" });
    expect(out).not.toContain("DO NOT OUTPUT THIS BLOCK");
  });

  test("satisfies the Stop gate by writing the card-rendered flag", async () => {
    const sessionId = "cli-test-flag";
    try { unlinkSync(flagFile(sessionId)); } catch { /* not there yet */ }

    await renderCard({ variant: "analysis", summary: "Flag-Test", session_id: sessionId });

    expect(existsSync(flagFile(sessionId))).toBe(true);
    unlinkSync(flagFile(sessionId));
  });

  test("attests validation only when the field is populated", async () => {
    const withItems = "cli-test-attested";
    const without = "cli-test-unattested";
    for (const s of [withItems, without]) {
      try { unlinkSync(attestedFile(s)); } catch { /* not there yet */ }
    }

    await renderCard({
      variant: "ready",
      summary: "Mit Validierung",
      session_id: withItems,
      validation: [{ requirement: "Karte ohne MCP", status: "met", evidence: "CLI-Test" }],
    });
    await renderCard({ variant: "ready", summary: "Ohne Validierung", session_id: without });

    expect(existsSync(attestedFile(withItems))).toBe(true);
    expect(existsSync(attestedFile(without))).toBe(false);

    unlinkSync(attestedFile(withItems));
    try { unlinkSync(flagFile(withItems)); } catch { /* best effort */ }
    try { unlinkSync(flagFile(without)); } catch { /* best effort */ }
  });

  test("applies the schema's coercions: JSON strings, lang default, soft clamps", async () => {
    const out = await renderCard({
      variant: "analysis",
      summary: "x".repeat(120),
      session_id: "cli-test-coercions",
      // The MCP schema accepts these as JSON strings; the CLI must too.
      changes: JSON.stringify([
        { area: "A", description: "first" },
        { area: "B", description: "second" },
        { area: "C", description: "third" },
        { area: "D", description: "dropped by the clamp" },
      ]),
    });

    expect(out).toContain("x".repeat(80));
    expect(out).not.toContain("x".repeat(81));
    expect(out).toContain("C → third");
    expect(out).not.toContain("dropped by the clamp");
  });

  test("an unknown variant still yields a card instead of an error", async () => {
    const out = await renderCard({ variant: "not-a-variant", summary: "Unbekannte Variante", session_id: "cli-test-variant" });
    expect(out).toMatch(/✨✨✨ Unbekannte Variante ✨✨✨/);
  });

  test("exits 2 with a diagnostic when the payload is unreadable", async () => {
    const missing = join(workDir, "does-not-exist.json");
    const err = await run(process.execPath, [ENTRY, "--render-card", missing], { encoding: "utf8", env: CHILD_ENV })
      .then(() => null, (e) => e);

    expect(err).not.toBeNull();
    expect(err.code).toBe(2);
    expect(err.stderr).toMatch(/cannot read payload/);
  });
});
