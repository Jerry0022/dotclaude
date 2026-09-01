import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
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

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "index.js");

let workDir;

function renderCard(payload) {
  const file = join(workDir, `payload-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(payload));
  return execFileSync(process.execPath, [ENTRY, "--render-card", file], {
    encoding: "utf8",
    // Never spawn the headless usage scraper (Edge) from a unit test.
    env: { ...process.env, DEVOPS_COMPLETION_NO_USAGE: "1" },
    timeout: 30_000,
  });
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
  test("renders the same card markdown the MCP tool returns", () => {
    const out = renderCard({
      variant: "analysis",
      summary: "Karte ohne MCP-Server",
      lang: "de",
      session_id: "cli-test-basic",
      changes: [{ area: "Completion card", description: "Rendert auch ohne MCP" }],
    });

    expect(out).toMatch(/^### \*\*✨✨✨ Karte ohne MCP-Server ✨✨✨\*\*/m);
    expect(out).toContain("Completion card → Rendert auch ohne MCP");
  });

  test("stdout carries the card only — no relay-instruction preamble to strip", () => {
    const out = renderCard({ variant: "analysis", summary: "Nur die Karte", session_id: "cli-test-clean" });
    expect(out).not.toContain("DO NOT OUTPUT THIS BLOCK");
  });

  test("satisfies the Stop gate by writing the card-rendered flag", () => {
    const sessionId = "cli-test-flag";
    try { unlinkSync(flagFile(sessionId)); } catch { /* not there yet */ }

    renderCard({ variant: "analysis", summary: "Flag-Test", session_id: sessionId });

    expect(existsSync(flagFile(sessionId))).toBe(true);
    unlinkSync(flagFile(sessionId));
  });

  test("attests validation only when the field is populated", () => {
    const withItems = "cli-test-attested";
    const without = "cli-test-unattested";
    for (const s of [withItems, without]) {
      try { unlinkSync(attestedFile(s)); } catch { /* not there yet */ }
    }

    renderCard({
      variant: "ready",
      summary: "Mit Validierung",
      session_id: withItems,
      validation: [{ requirement: "Karte ohne MCP", status: "met", evidence: "CLI-Test" }],
    });
    renderCard({ variant: "ready", summary: "Ohne Validierung", session_id: without });

    expect(existsSync(attestedFile(withItems))).toBe(true);
    expect(existsSync(attestedFile(without))).toBe(false);

    unlinkSync(attestedFile(withItems));
    try { unlinkSync(flagFile(withItems)); } catch { /* best effort */ }
    try { unlinkSync(flagFile(without)); } catch { /* best effort */ }
  });

  test("applies the schema's coercions: JSON strings, lang default, soft clamps", () => {
    const out = renderCard({
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

  test("an unknown variant still yields a card instead of an error", () => {
    const out = renderCard({ variant: "not-a-variant", summary: "Unbekannte Variante", session_id: "cli-test-variant" });
    expect(out).toMatch(/✨✨✨ Unbekannte Variante ✨✨✨/);
  });

  test("exits 2 with a diagnostic when the payload is unreadable", () => {
    let err;
    try {
      execFileSync(process.execPath, [ENTRY, "--render-card", join(workDir, "does-not-exist.json")], {
        encoding: "utf8",
        env: { ...process.env, DEVOPS_COMPLETION_NO_USAGE: "1" },
        timeout: 30_000,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.status).toBe(2);
    expect(err.stderr).toMatch(/cannot read payload/);
  });
});
