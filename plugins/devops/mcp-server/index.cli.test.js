import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
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

// Never spawn the headless usage scraper (Edge) from a unit test. Pin the
// terminal entrypoint: a run started from a Desktop session inherits
// `claude-desktop`, where stdout stays empty (the widget is the card, § 4) — the
// Desktop cases override it explicitly.
const CHILD_ENV = { ...process.env, DEVOPS_COMPLETION_NO_USAGE: "1", CLAUDE_CODE_ENTRYPOINT: "cli" };

let workDir;

async function renderCardFull(payload, envOverride = {}) {
  const file = join(workDir, `payload-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(payload));
  return run(process.execPath, [ENTRY, "--render-card", file], {
    encoding: "utf8",
    env: { ...CHILD_ENV, ...envOverride },
  });
}

async function renderCard(payload) {
  return (await renderCardFull(payload)).stdout;
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
  // Every Desktop render saves its widget HTML to the real tmpdir (#451).
  try {
    for (const f of readdirSync(tmpdir())) {
      if (f.startsWith("dotclaude-devops-card-widget-cli-test-")) rmSync(join(tmpdir(), f), { force: true });
    }
  } catch { /* best effort */ }
});

describe("--render-card CLI fallback", () => {
  test("renders the same card markdown the MCP tool returns — new anatomy (§ 2)", async () => {
    const out = await renderCard({
      variant: "analysis",
      summary: "Karte ohne MCP-Server",
      lang: "de",
      session_id: "cli-test-basic",
      changes: [{ area: "Completion card", description: "Rendert auch ohne MCP" }],
    });

    expect(out).toMatch(/^### \*\*✨✨✨ Karte ohne MCP-Server ✨✨✨\*\*/m);
    expect(out).toContain("› Rendert auch ohne MCP");
    expect(out).toMatch(/^## 📋 Analyse gelesen/m);
  });

  test("compact: the ship-compact stop as a card — size, saving, command text, one ship button (Desktop)", async () => {
    const payload = { variant: "ship-blocked", summary: "Ship angehalten", lang: "de", session_id: "cli-test-compact", compact: { tokens: 435000 } };
    const term = await renderCard(payload);
    expect(term).toMatch(/^## 🗜 Kontext 435 k Tokens — vor dem Ship kompaktieren\?/m);
    expect(term).toContain("Kompaktieren spart beim Ship ≈ 5.4 M Tokens");
    expect(term).toContain("`/compact Ship steht an. Behalte:");
    expect(term).not.toContain("ungeprüft");
    const { stderr } = await renderCardFull(payload, { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" });
    expect(stderr).toContain('data-prompt="ship --no-compact"');
    expect(stderr).toContain("Ohne Kompaktieren shippen");
    expect(stderr).not.toMatch(/data-prompt="\s*\/compact/);
    // the command stays visible in the widget, as plain text
    expect(stderr).toContain(">/compact Ship steht an. Behalte:");
  });

  test("compact outranks an open concept page — the ship stop stays the decision", async () => {
    const payload = {
      variant: "ship-blocked", summary: "Ship angehalten", lang: "de", session_id: "cli-test-compact-concept",
      compact: { tokens: 435000 }, concept: "waiting", pending: [{ name: "devops:qa", doing: "Suite" }],
    };
    const term = await renderCard(payload);
    expect(term).toMatch(/^## 🗜 Kontext 435 k Tokens — vor dem Ship kompaktieren\?/m);
    expect(term).not.toContain("🧭 Concept");
    const { stderr } = await renderCardFull(payload, { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" });
    expect(stderr).toContain('data-prompt="ship --no-compact"');
  });

  test("stdout carries the card only — no relay-instruction preamble to strip", async () => {
    const out = await renderCard({ variant: "analysis", summary: "Nur die Karte", session_id: "cli-test-clean" });
    expect(out).not.toContain("DO NOT OUTPUT THIS BLOCK");
  });

  test("the session-title instruction rides on stderr, never in the card", async () => {
    const { stdout, stderr } = await renderCardFull({ variant: "ready", summary: "Titel-Test", session_id: "cli-test-title", changes: [{ area: "x", description: "y" }] });
    expect(stdout).not.toContain("SESSION TITLE");
    expect(stderr).toContain("[SESSION TITLE — DO NOT OUTPUT THIS BLOCK]");
    expect(stderr).toContain('"📦 Ready – " + <stripped title>');
  });

  test("the card-widget instruction rides on stderr on the Desktop app only (§ 4)", async () => {
    const payload = { variant: "ready", summary: "CTA-Test", session_id: "cli-test-cta", changes: [{ area: "x", description: "y" }] };
    const desktop = await renderCardFull(payload, { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" });
    expect(desktop.stdout).not.toContain("CARD WIDGET");
    expect(desktop.stderr).toContain("[CARD WIDGET — DO NOT OUTPUT THIS BLOCK]");
    expect(desktop.stderr).toContain("mcp__visualize__show_widget");
    expect(desktop.stderr).toContain('data-prompt="ship"');
    const terminal = await renderCardFull(payload, { CLAUDE_CODE_ENTRYPOINT: "cli" });
    expect(terminal.stderr).not.toContain("CARD WIDGET");
    // The terminal gets the whole markdown body; on Desktop the widget draws
    // the whole card and nothing is relayed under it (§ 4). 2026-09-21: widget
    // + full markdown showed the card twice; widget + visible title line read
    // as a second, empty card header; every hidden marker (HTML comment #443,
    // `[//]: #` definition #470) showed as a literal stray line.
    expect(terminal.stdout).toMatch(/^› y$/m);
    expect(terminal.stdout).toMatch(/^## 📦 Shippen\?$/m);
    expect(terminal.stdout).toMatch(/^### \*\*✨✨✨ CTA-Test ✨✨✨\*\*/m);
    expect(desktop.stdout.trim()).toBe("");
    expect(desktop.stderr).toContain("this card has no markdown to relay");
    // 2026-09-24: "answer with ONE short line" put a stray line under the card
    // on every widget turn — the app's nudge now gets an empty reply.
    expect(desktop.stderr).toMatch(/reply to it with nothing — no text, no tool call/);
    expect(desktop.stderr).not.toMatch(/ONE short line/);
    // The failed-call fallback line names the title.
    expect(desktop.stderr).toContain("`### **✨✨✨ CTA-Test ✨✨✨**`");
    // The widget carries the title and the body instead.
    expect(desktop.stderr).toContain('<h3 class="card-title" style="margin:0 0 4px;font-size:16px;font-weight:500">CTA-Test</h3>');
    expect(desktop.stderr).toContain("Shippen?");
  });

  test("a Desktop render saves the widget HTML for the Stop gate and names the file (#451)", async () => {
    const session = "cli-test-widget-file";
    const file = join(tmpdir(), `dotclaude-devops-card-widget-${session}`);
    try { unlinkSync(file); } catch { /* best effort */ }
    const payload = { variant: "ready", summary: "Widget-Datei", session_id: session, changes: [{ area: "x", description: "y" }] };
    try {
      const terminal = await renderCardFull(payload, { CLAUDE_CODE_ENTRYPOINT: "cli" });
      expect(terminal.stderr).not.toContain("CARD WIDGET");
      expect(existsSync(file)).toBe(false);

      const desktop = await renderCardFull(payload, { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" });
      expect(existsSync(file)).toBe(true);
      const html = readFileSync(file, "utf8");
      // The file carries exactly the inline widget_code.
      expect(desktop.stderr).toContain("----- widget_code -----\n" + html + "\n----- end widget_code -----");
      expect(desktop.stderr).toContain(file.replace(/\\/g, "/"));
      expect(desktop.stderr).toMatch(/never a shortcut/);
    } finally {
      try { unlinkSync(file); } catch { /* best effort */ }
    }
  });

  // Red-team R2(b): the promote button names the card's version, so a stale
  // click on an old card is promotion-only and never ships later edits.
  test("the Desktop promote button carries the shipped / promoted version", async () => {
    const shipped = await renderCardFull({
      variant: "ship-successful", summary: "Ship", session_id: "cli-test-promote-version",
      state: { pushed: true, merged: "main" },
      delivery: { ship: { version: "0.193.0" }, promote: { channels: { alpha: "0.193.0" }, current: "alpha" } },
    }, { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" });
    expect(shipped.stderr).toContain('data-prompt="promote 0.193.0"');
    const released = await renderCardFull({
      variant: "released", summary: "Beta", session_id: "cli-test-promote-version-beta",
      delivery: { promote: { channels: { alpha: "0.193.0", beta: "0.193.0" }, current: "beta" } },
    }, { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" });
    expect(released.stderr).toContain('data-prompt="promote stable 0.193.0"');
  });

  // The ready card's second button answers the open points instead of asking
  // "what do you want to change?" — every point, in card order, also those
  // past the 3-point cap; the user's own final tests stay out.
  test("ready with open points: the conclude button carries the prepared answers (Desktop)", async () => {
    const payload = {
      variant: "ready", summary: "Vorbehalte", lang: "de", session_id: "cli-test-conclude",
      open: [
        { text: "Soll die Änderung auch im Terminal-Renderer rein?", reply: "Ja, die Änderung bitte auch im Terminal-Renderer machen." },
        "Doku zur Card nachziehen?",
        "Alten Branch feat/x aufräumen",
        { text: "Vierter Punkt", reply: "Vierten Punkt bitte auch erledigen." },
      ],
      userFinalTest: ["Im Desktop klicken"],
    };
    const { stderr } = await renderCardFull(payload, { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" });
    expect(stderr).toContain("Offenes abarbeiten ↗");
    expect(stderr).not.toContain("Ändern ↗");
    expect(stderr).toContain(
      'data-prompt="Bitte noch alle offenen Punkte angehen:&#10;&#10;' +
      "- Ja, die Änderung bitte auch im Terminal-Renderer machen.&#10;" +
      "- Doku zur Card nachziehen? Ja, bitte.&#10;" +
      "- Alten Branch feat/x aufräumen — bitte angehen.&#10;" +
      '- Vierten Punkt bitte auch erledigen."',
    );
    expect(stderr).not.toMatch(/data-prompt="[^"]*Im Desktop klicken/);
    // The terminal shows the object entries as plain points.
    const term = await renderCard(payload);
    expect(term).toMatch(/^1\. Soll die Änderung auch im Terminal-Renderer rein\?$/m);
    expect(term).toMatch(/^## 📦 Shippen trotz 4 Vorbehalten \+2 weitere\?$/m);
  });

  test("test and ship-successful cards answer their open points too (Desktop)", async () => {
    const desktop = { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" };
    const open = [{ text: "Auch im Terminal?", reply: "Ja, bitte auch im Terminal." }, "Doku nachziehen?"];
    const answer = 'data-prompt="Bitte noch alle offenen Punkte angehen:&#10;&#10;- Ja, bitte auch im Terminal.&#10;- Doku nachziehen? Ja, bitte."';

    const test = { variant: "test", summary: "Testen", lang: "de", session_id: "cli-test-conclude-test", open, userTest: ["Seite öffnen"] };
    const testWidget = (await renderCardFull(test, desktop)).stderr;
    expect(testWidget).toContain("Nachbessern ↗");
    expect(testWidget).toContain("Offenes abarbeiten ↗");
    expect(testWidget).toContain(answer);
    // the open points show on the test card, the steps tagged 🧪
    const testTerm = await renderCard(test);
    expect(testTerm).toMatch(/^1\. Auch im Terminal\?$/m);
    expect(testTerm).toMatch(/^3\. 🧪 Seite öffnen$/m);

    const ring = (await renderCardFull({
      variant: "ship-successful", summary: "Ship", lang: "de", session_id: "cli-test-conclude-ring", open,
      state: { pushed: true, merged: "main" },
      delivery: { ship: { version: "0.193.0" }, promote: { channels: { alpha: "0.193.0" }, current: "alpha" } },
    }, desktop)).stderr;
    expect(ring).toContain('data-prompt="promote 0.193.0"');
    expect(ring).toContain(answer);

    const plain = { variant: "ship-successful", summary: "Merge", lang: "de", session_id: "cli-test-conclude-plain", state: { pushed: true, merged: "main" }, delivery: { ship: { version: "0.193.0" } } };
    const plainOpen = (await renderCardFull({ ...plain, open }, desktop)).stderr;
    expect(plainOpen).toContain("Offenes abarbeiten ↗");
    expect(plainOpen).not.toContain("Promote ↗");
    const plainNone = (await renderCardFull({ ...plain, session_id: "cli-test-conclude-plain-none" }, desktop)).stderr;
    expect(plainNone).not.toContain('<span role="button"');
  });

  test("ready without open points keeps the plain Ändern button", async () => {
    const { stderr } = await renderCardFull(
      { variant: "ready", summary: "Ohne", lang: "de", session_id: "cli-test-conclude-none", userFinalTest: ["Im Desktop klicken"] },
      { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" },
    );
    expect(stderr).toContain("Ändern ↗");
    expect(stderr).not.toContain("Offenes abarbeiten");
  });

  test("test-minimal keeps its whole markdown on Desktop — no widget draws it", async () => {
    const desktop = await renderCardFull(
      { variant: "test-minimal", summary: "Dev-Server", session_id: "cli-test-minimal-md", cta: { description: "läuft auf Port 3000" } },
      { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" },
    );
    expect(desktop.stdout).toMatch(/^› läuft auf Port 3000$/m);
    expect(desktop.stdout).toMatch(/^## ▶️ Läuft — viel Spaß$/m);
  });

  test("test-minimal never rides the card-widget instruction, even on Desktop", async () => {
    const desktop = await renderCardFull(
      { variant: "test-minimal", summary: "Dev-Server", session_id: "cli-test-minimal-widget" },
      { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" },
    );
    expect(desktop.stderr).not.toContain("CARD WIDGET");
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
      variant: "ready",
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

    expect(out).toContain("x".repeat(60));
    expect(out).not.toContain("x".repeat(61));
    expect(out).toContain("third");
    expect(out).toContain("+1 weitere");
  });

  test("coerces a JSON-string `pending` and overrides the heading with it", async () => {
    const out = await renderCard({
      variant: "ready",
      summary: "Agent läuft noch",
      lang: "de",
      session_id: "cli-test-pending",
      pending: JSON.stringify([{ name: "devops:frontend", doing: "Farbstil" }]),
    });
    expect(out).toMatch(/^## ⏳ Noch nicht fertig/m);
    expect(out).toContain("devops:frontend");
    expect(out).not.toMatch(/^## 📦 Shippen/m);
  });

  test("writes the pending-attested flag so the Stop gate is satisfied", async () => {
    const session = "cli-test-pending-flag";
    const attested = join(tmpdir(), `dotclaude-devops-pending-attested-${session}`);
    try { unlinkSync(attested); } catch { /* best effort */ }

    await renderCard({
      variant: "ready", summary: "Agent läuft", session_id: session,
      pending: [{ name: "devops:qa" }],
    });
    expect(existsSync(attested)).toBe(true);
    try { unlinkSync(attested); } catch { /* best effort */ }

    // An empty array attests nothing — the flag must stay absent.
    await renderCard({ variant: "ready", summary: "Nichts offen", session_id: session, pending: [] });
    expect(existsSync(attested)).toBe(false);
  });

  // #406 — with the MCP server down, a ship card was rendered offline with
  // `variant: "ship"`; the CLI silently rendered a generic `DONE — Noch was
  // ANDERES?` card without Delivery, bump or SHIPPED CTA, and the user had to
  // ask where the ship card was. An unknown variant is now a hard error that
  // names the valid ones — the MCP path already rejects it via the zod enum.
  test("REGRESSION (#406): an unknown variant exits 2 with the valid variants on stderr and writes no flag", async () => {
    const err = await renderCardFull({ variant: "ship", summary: "Falsche Variante", session_id: "cli-test-406-variant" })
      .then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect(err.code).toBe(2);
    expect(err.stderr).toMatch(/variant: "ship" is not a card variant/);
    expect(err.stderr).toMatch(/ship-successful\|ready\|released\|ship-blocked\|test\|test-minimal\|analysis\|aborted\|fallback\|ready-files/);
    expect(err.stdout).toBe("");
    expect(existsSync(flagFile("cli-test-406-variant"))).toBe(false);
  });

  test("#406: ship-successful without the merge proof exits 2 naming state.pushed + state.merged", async () => {
    const err = await renderCardFull({
      variant: "ship-successful", summary: "Ohne Beweis", session_id: "cli-test-406-proof",
      state: { branch: "main", commit: "abc1234" },
    }).then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect(err.code).toBe(2);
    expect(err.stderr).toMatch(/state: ship-successful requires the merge proof state\.pushed: true and state\.merged/);
    expect(existsSync(flagFile("cli-test-406-proof"))).toBe(false);
  });

  test("#406: a real ship-successful payload still renders the SHIPPED card", async () => {
    const out = await renderCard({
      variant: "ship-successful", summary: "Echter Ship", session_id: "cli-test-406-real", lang: "de",
      state: { branch: "main", commit: "abc1234", pushed: true, merged: "main", pr: { number: 7, title: "fix: x" } },
      cta: { vOld: "1.0.0", vNew: "1.0.1", bump: "patch" },
      delivery: { pr: { number: 7, title: "fix: x" }, ship: { version: "1.0.1", base: "main" } },
    });
    expect(out).toMatch(/✨✨✨ Echter Ship ✨✨✨/);
    expect(out).not.toMatch(/^## 🔧 Erledigt/m);
  });

  test("#406: unknown top-level keys are reported on stderr (parity with the zod strip) but never reject", async () => {
    const res = await renderCardFull({
      variant: "ready", summary: "Fremde Keys", session_id: "cli-test-406-keys",
      links: "https://example.invalid/pr/1", validationNotes: "plain string",
    });
    expect(res.stderr).toMatch(/ignored unknown top-level key\(s\): links, validationNotes/);
    expect(res.stdout).toMatch(/✨✨✨ Fremde Keys ✨✨✨/);
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

// #396 — the CLI is reached when the tool schema is NOT in context; the payload
// is a guess. It must either read the text or refuse — never a broken result line.
describe("--render-card CLI — malformed payloads (#396)", () => {
  test("REGRESSION: a string-array `changes` renders as result lines — never a raw arrow bullet", async () => {
    const out = await renderCard({
      variant: "ready",
      summary: "Card aus dem Offline-Pfad",
      session_id: "cli-test-396-strings",
      changes: [
        "Completion card → Changes-Bullets werden gelesen",
        "Ship: merged ohne Tag",
        "eine Zeile ganz ohne Trenner",
      ],
      state: { branch: "feat/x", pushed: true },
    });
    // coerceChange splits "area → description" / "area: description" on the
    // first separator; the result line carries the DESCRIPTION half (§ 2.2 —
    // never "area → description" as one line; area is discarded, not lost as
    // an empty bullet).
    expect(out).toContain("› Changes-Bullets werden gelesen");
    expect(out).toContain("› merged ohne Tag");
    expect(out).toContain("› eine Zeile ganz ohne Trenner");
    expect(out).not.toMatch(/›\s*→/);
  });

  test("a payload off the schema exits 2 with the offending path on stderr", async () => {
    const err = await renderCardFull({
      variant: "ready",
      summary: "Kaputt",
      session_id: "cli-test-396-invalid",
      changes: [{ area: "A" }, 42],
      pending: [{ kind: "agent" }],
    }).then(() => null, (e) => e);

    expect(err).not.toBeNull();
    expect(err.code).toBe(2);
    expect(err.stderr).toMatch(/payload does not match the card schema/);
    expect(err.stderr).toMatch(/changes\[0\]: description must be a string/);
    expect(err.stderr).toMatch(/changes\[1\]: must be \{ area, description \}/);
    expect(err.stderr).toMatch(/pending\[0\]: name must be a string/);
    expect(err.stdout).toBe("");                       // nothing half-rendered on stdout
    expect(existsSync(flagFile("cli-test-396-invalid"))).toBe(false); // the Stop gate is NOT satisfied
  });

  test("string entries in `tests` and `validation` are coerced and folded into the evidence row", async () => {
    const out = await renderCard({
      variant: "ready",
      summary: "Coercion",
      session_id: "cli-test-396-tests",
      tests: ["npm test → 12 grün", "eslint"],
      validation: ["Anforderung erfüllt — Test grün"],
      state: { branch: "feat/x", pushed: true },
    });
    // "npm test → 12 grün" coerces to { method: "npm test", result: "12 grün" } —
    // the evidence post is number + noun + state, not the method name (§ 2.3).
    expect(out).toContain("✓ 12 Tests grün");
  });
});
