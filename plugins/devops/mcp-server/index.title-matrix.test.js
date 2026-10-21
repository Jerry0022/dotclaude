import { describe, test, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { titlePrefixFor, TITLE_SCHEME } from "./lib/mode-state.js";
import { hasPending, hasConcept } from "./lib/pending.js";
import TITLE_SCHEME_MOD from "../hooks/lib/title-scheme.js";

// Title = CTA (concept 2026-10-19 "title-cta-emoji-scheme"): EVERY
// completion-card variant × every flag that changes the heading or the
// prefix. For each case the session title the card leaves must carry the
// exact STATUS icon, ACTIVITY icon and keyword, and the CTA heading must start
// with the same `<STATUS> <ACTIVITY> <Word>` followed by " — ". Status is
// chosen by card content: a mandatory user step (open point, userTest,
// userFinalTest, a requirement waiting on the user) raises 🟩 to 👉; an
// optional promote offer keeps 🟩.

process.env.DEVOPS_COMPLETION_NO_USAGE = "1";
process.env.DEVOPS_CARD_PREGATE = "0";
process.env.CLAUDE_CODE_ENTRYPOINT = "cli";

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool() {}
    async connect() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));
vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  const z = new Proxy({}, { get: () => () => node });
  return { z };
});

const require_ = createRequire(import.meta.url);
const B = require_("../hooks/lib/batch-state.js");
const { BATCH_PREFIX } = require_("../hooks/lib/session-title.js");

let mod;
let batchCwd;
let closeoutCwd;

beforeAll(async () => {
  mod = await import("./index.js");
  batchCwd = mkdtempSync(join(tmpdir(), "title-matrix-batch-"));
  B.activate(batchCwd, { marker: ">go", expiryHours: 8, maxNotes: 100 });
  // An open concept whose page only waits for its close-out (#693). The port
  // is one no real bridge registers, so the liveness check reads "unknown".
  closeoutCwd = mkdtempSync(join(tmpdir(), "title-matrix-closeout-"));
  mkdirSync(join(closeoutCwd, ".claude"), { recursive: true });
  mkdirSync(join(closeoutCwd, "docs", "concepts"), { recursive: true });
  writeFileSync(join(closeoutCwd, ".claude", "concept-active.json"),
    JSON.stringify({ port: 64999, html_path: "docs/concepts/x.html", started_at: new Date().toISOString() }));
  writeFileSync(join(closeoutCwd, "docs", "concepts", "x.html"),
    '<!doctype html><section data-iteration="2"></section><section data-iteration="3" data-final-report></section>');
}, 60_000);

afterAll(() => {
  for (const d of [batchCwd, closeoutCwd]) try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
});

const ring = (current = "alpha", extra = {}) => ({
  ship: { version: "0.1.0", base: "main" },
  promote: { channels: { alpha: "0.1.0", beta: current !== "alpha" ? "0.1.0" : null, stable: current === "stable" ? "0.1.0" : null }, current },
  ...extra,
});
const SHIPPED = { pushed: true, merged: "main", branch: "feat/x" };
const OPEN = ["Doku nachziehen"];
const FINAL = ["Login in Alpha prüfen"];
const WAITS = [{ requirement: "Welche Quest schlägt fehl", status: "unmet", waitsOn: "user", evidence: "Name fehlt noch" }];

// [name, params, [status, activity, word]]
const CASES = [
  // ready family
  ["ready", { variant: "ready" }, ["👉", "Ready", "📦"]],
  ["ready + open point → question", { variant: "ready", open: OPEN }, ["👉", "Question", "❓"]],
  ["ready + requirement waiting on the user → question", { variant: "ready", validation: WAITS }, ["👉", "Question", "❓"]],
  ["ready + red tests", { variant: "ready", tests: [{ method: "npm test", result: "10 grün · 2 rot" }] }, ["👉", "Red tests", "⚠️"]],
  ["ready + unmet requirement → ready-red", { variant: "ready", validation: [{ requirement: "Export", status: "unmet", evidence: "fehlt" }] }, ["👉", "Red tests", "⚠️"]],
  ["ready + vv-unverified", { variant: "ready", vv: { unverified: true } }, ["👉", "Unverified", "⚠️"]],
  ["ready + vv-running", { variant: "ready", vv: { unverified: true, running: true } }, ["⏳", "Testing", "🧪"]],
  ["ready + no remote (ready-local)", { variant: "ready", state: { mode: "git-no-remote" } }, ["🟩", "Committed", "📦"]],
  ["ready + no remote + open → question", { variant: "ready", state: { mode: "git-no-remote" }, open: OPEN }, ["👉", "Question", "❓"]],
  ["ready + file-only → files", { variant: "ready", state: { mode: "file-only" } }, ["👉", "Files", "📦"]],
  ["ready-files", { variant: "ready-files", state: { mode: "file-only" } }, ["👉", "Files", "📦"]],
  ["ready-files + open", { variant: "ready-files", state: { mode: "file-only" }, open: OPEN }, ["👉", "Files", "📦"]],
  // ship
  ["ship-blocked", { variant: "ship-blocked", cta: { reason: "Preflight" } }, ["👉", "Blocked", "🚧"]],
  ["ship-successful plain merge (no ring)", { variant: "ship-successful", state: SHIPPED, delivery: { ship: { version: "0.1.0" } } }, ["🟩", "Alpha", "🚀"]],
  ["ship-successful ring alpha (optional promote)", { variant: "ship-successful", state: SHIPPED, delivery: ring("alpha") }, ["🟩", "Alpha", "🚀"]],
  ["ship-successful ring + open point (mandatory)", { variant: "ship-successful", state: SHIPPED, delivery: ring("alpha"), open: OPEN }, ["👉", "Alpha", "🚀"]],
  ["ship-successful ring + userFinalTest (mandatory)", { variant: "ship-successful", state: SHIPPED, delivery: ring("alpha"), userFinalTest: FINAL }, ["👉", "Alpha", "🚀"]],
  ["ship-successful ring + requirement waiting on the user", { variant: "ship-successful", state: SHIPPED, delivery: ring("alpha"), validation: WAITS }, ["👉", "Alpha", "🚀"]],
  ["ship-successful + promote beta in one run", { variant: "ship-successful", state: SHIPPED, delivery: ring("beta") }, ["🟩", "Beta", "🚀"]],
  ["ship-successful + promote stable in one run", { variant: "ship-successful", state: SHIPPED, delivery: ring("stable") }, ["🟩", "Stable", "🚀"]],
  ["ship-successful kept", { variant: "ship-successful", state: { ...SHIPPED, kept: true }, delivery: ring("alpha") }, ["🟩", "Alpha", "🚀"]],
  ["ship-successful kept + open", { variant: "ship-successful", state: { ...SHIPPED, kept: true }, delivery: ring("alpha"), open: OPEN }, ["👉", "Alpha", "🚀"]],
  ["ship-successful merged-not-deployed", { variant: "ship-successful", state: { ...SHIPPED, deployPending: true }, deployGate: [{ kind: "migration", artifact: "001.sql" }] }, ["👉", "Not deployed", "⚠️"]],
  ["ship-successful closeout (concept waits for its final report)", { variant: "ship-successful", state: { ...SHIPPED, kept: true }, delivery: ring("alpha"), cwd: "@closeout" }, ["👉", "Alpha", "🚀"]],
  // released: promote-only vs ship+promote, per channel
  ["released promote-only → beta", { variant: "released", delivery: { promote: { channels: { alpha: "0.1.0", beta: "0.1.0" }, current: "beta" }, ship: { version: "0.1.0" } } }, ["🟩", "Beta", "🎊"]],
  ["released promote-only → stable", { variant: "released", delivery: { promote: { channels: { stable: "0.1.0" }, current: "stable" } } }, ["🟩", "Stable", "🎊"]],
  ["released promote-only via promotion.to stable", { variant: "released", promotion: { from: "beta", to: "stable" }, delivery: { promote: { channels: { stable: "0.1.0" } } } }, ["🟩", "Stable", "🎊"]],
  ["released ship+promote → beta", { variant: "released", state: SHIPPED, delivery: ring("beta") }, ["🟩", "Beta", "🚀"]],
  ["released ship+promote → stable", { variant: "released", state: SHIPPED, delivery: ring("stable") }, ["🟩", "Stable", "🚀"]],
  ["released ship+promote → stable + userFinalTest", { variant: "released", state: SHIPPED, delivery: ring("stable"), userFinalTest: FINAL }, ["👉", "Stable", "🚀"]],
  ["released promote-only → beta + open", { variant: "released", delivery: { promote: { channels: { beta: "0.1.0" }, current: "beta" } }, open: OPEN }, ["👉", "Beta", "🎊"]],
  // test
  ["test", { variant: "test", userTest: ["Login prüfen"] }, ["👉", "Test", "🧪"]],
  ["test + open keeps Test (#750)", { variant: "test", userTest: ["Login prüfen"], open: OPEN }, ["👉", "Test", "🧪"]],
  ["test without steps + open → question", { variant: "test", open: OPEN }, ["👉", "Question", "❓"]],
  ["test + no remote (test-local)", { variant: "test", userTest: ["Login prüfen"], state: { mode: "git-no-remote" } }, ["👉", "Test", "🧪"]],
  ["test-minimal", { variant: "test-minimal" }, ["🟩", "Started", "💡"]],
  ["test-minimal + userTest (mandatory)", { variant: "test-minimal", userTest: ["Spiel starten"] }, ["👉", "Started", "💡"]],
  // analysis / fallback
  ["analysis", { variant: "analysis" }, ["🟩", "Analysis", "📊"]],
  ["analysis + open question (mandatory)", { variant: "analysis", open: ["Welche Variante?"] }, ["👉", "Analysis", "📊"]],
  ["fallback (system work, no repo diff)", { variant: "fallback" }, ["🟩", "System", "🖥️"]],
  ["fallback + open", { variant: "fallback", open: OPEN }, ["👉", "System", "🖥️"]],
  ["unknown variant → fallback", { variant: "no-such-variant" }, ["🟩", "System", "🖥️"]],
  // aborted: generic vs named
  ["aborted generic", { variant: "aborted", cta: { reason: "fehlender Zugriff" } }, ["🟥", "Aborted", "📦"]],
  ["aborted generic + open (stays 🟥)", { variant: "aborted", cta: { reason: "x" }, open: OPEN }, ["🟥", "Aborted", "📦"]],
  ["aborted named ship", { variant: "aborted", cta: { reason: "x", activity: "ship" } }, ["🟥", "Ship", "🚀"]],
  ["aborted named promote", { variant: "aborted", cta: { reason: "x", activity: "promote" } }, ["🟥", "Promote", "🎊"]],
  ["aborted named test", { variant: "aborted", cta: { reason: "x", activity: "test" } }, ["🟥", "Test", "🧪"]],
  ["aborted named concept", { variant: "aborted", cta: { reason: "x", activity: "concept" } }, ["🟥", "Concept", "🧭"]],
  ["aborted named batch", { variant: "aborted", cta: { reason: "x", activity: "batch" } }, ["🟥", "Batch", "📚"]],
  ["aborted named analysis", { variant: "aborted", cta: { reason: "x", activity: "analysis" } }, ["🟥", "Analysis", "📊"]],
  ["aborted named agents", { variant: "aborted", cta: { reason: "x", activity: "agents" } }, ["🟥", "Team", "🤖"]],
  ["aborted unknown activity → generic", { variant: "aborted", cta: { reason: "x", activity: "bogus" } }, ["🟥", "Aborted", "📦"]],
  // paused per reason
  ["paused (no reason)", { variant: "paused" }, ["🟦", "Paused", "✋"]],
  ["paused user", { variant: "paused", pause: { reason: "user" } }, ["🟦", "Paused", "✋"]],
  ["paused restart", { variant: "paused", pause: { reason: "restart" } }, ["🟦", "Restart", "🔌"]],
  ["paused reboot", { variant: "paused", pause: { reason: "reboot" } }, ["🟦", "Reboot", "💻"]],
  ["paused usage-reset", { variant: "paused", pause: { reason: "usage-reset", resetAt: "14:00" } }, ["🟦", "Limit reset", "🔋"]],
  ["paused + open (stays ⏸️)", { variant: "paused", pause: { reason: "restart" }, open: OPEN }, ["🟦", "Restart", "🔌"]],
  // pending override
  ["pending on ready", { variant: "ready", pending: [{ name: "qa", kind: "agent", doing: "prüft" }] }, ["⏳", "Team", "🤖"]],
  ["pending on ship-successful", { variant: "ship-successful", state: SHIPPED, delivery: ring("alpha"), pending: [{ name: "qa", kind: "agent" }] }, ["⏳", "Team", "🤖"]],
  ["pending on analysis + open", { variant: "analysis", open: OPEN, pending: [{ name: "qa", kind: "agent" }] }, ["⏳", "Team", "🤖"]],
  // concept phases
  ["concept waiting", { variant: "ready", concept: { phase: "waiting" } }, ["👉", "Concept", "🧭"]],
  ["concept iterating", { variant: "ready", concept: { phase: "iterating" } }, ["⏳", "Concept", "🧭"]],
  ["concept implementing", { variant: "ship-successful", state: SHIPPED, concept: { phase: "implementing" } }, ["⏳", "Concept", "🧭"]],
  ["concept implementing + pending", { variant: "ready", concept: "implementing", pending: [{ name: "feature", kind: "agent" }] }, ["⏳", "Concept", "🧭"]],
  ["concept waiting + pending", { variant: "ready", concept: "waiting", pending: [{ name: "research", kind: "agent" }] }, ["👉", "Concept", "🧭"]],
  // batch: the skill owns the title; the heading starts with the batch title prefix
  ["batch armed", { variant: "analysis", cwd: "@batch" }, ["👉", "Batch", "📚"], { titleOwnedBySkill: true }],
  ["batch armed on a ready card", { variant: "ready", cwd: "@batch" }, ["👉", "Batch", "📚"], { titleOwnedBySkill: true }],
];

function resolveCwd(params) {
  if (params.cwd === "@batch") return { ...params, cwd: batchCwd };
  if (params.cwd === "@closeout") return { ...params, cwd: closeoutCwd };
  return params;
}

function evaluate(params, lang) {
  const input = { summary: "x", session_id: "title-matrix", ...resolveCwd(params), lang };
  const key = mod.resolveCardKey(input);
  const decision = mod.buildDecisionBlock(input, lang, key, input.delivery || {}, input.state || {});
  const title = titlePrefixFor(input, { hasPending, hasConcept, outcome: mod.outcomeTitlePrefix });
  return { key, heading: decision.heading, title };
}

describe("title = CTA — every completion-card variant × every heading/prefix flag", () => {
  for (const [name, params, [status, word, activity], opts = {}] of CASES) {
    for (const lang of ["de", "en"]) {
      test(`${name} (${lang}) → ${status} ┃ ${word} ${activity}`, () => {
        const { heading, title } = evaluate(params, lang);
        const head = `${status} ┃ ${word} ${activity}`;
        const prefix = (head + " ");
        if (opts.titleOwnedBySkill) {
          // An armed batch owns the title (the card leaves it alone) — and the
          // skill's title carries exactly the heading's head.
          expect(title).toBeNull();
          expect(BATCH_PREFIX).toBe(prefix);
        } else {
          expect(typeof title, JSON.stringify(title)).toBe("string");
          const m = /^(\S+) ┃ (.+?) (\S+) $/u.exec(title.split(TITLE_SCHEME.HAIR).join(""));
          expect(m, JSON.stringify(title)).not.toBeNull();
          expect(m[1], "status icon").toBe(status);
          expect(m[2], "keyword").toBe(word);
          expect(m[3], "activity icon").toBe(activity);
          expect(title).toBe(prefix);
        }
        // Title = CTA: the heading starts with the same two icons and keyword,
        // without the title's ┃ bar (it read as a line starting with "|").
        expect(heading.startsWith(`${status} ${word} ${activity} — `), heading).toBe(true);
        expect(heading).not.toContain("┃");
        expect(heading).not.toMatch(/LIVE/);
        expect(heading.startsWith("✅")).toBe(false);
      });
    }
  }

  test("the matrix reaches every scheme state but the card-less F5 one", () => {
    const reached = new Set(CASES.map(([, , [s, w, a]]) => `${s} ┃ ${w} ${a}`));
    for (const [id, [statusKey, word, act]] of Object.entries(TITLE_SCHEME.STATES)) {
      if (id === "interrupted" || id === "shipping") continue; // F5 (stop hook) and /do-ship Pre-Step C set these
      const status = TITLE_SCHEME.STATUS[statusKey];
      expect(reached.has(`${status} ┃ ${word} ${act}`), id).toBe(true);
    }
    // Both statuses of a done state are exercised: 🟩 and the 👉 a mandatory step raises.
    expect(reached.has("🟩 ┃ Alpha 🚀")).toBe(true);
    expect(reached.has("👉 ┃ Alpha 🚀")).toBe(true);
  });

  test("an optional promote offer keeps 🟩, a mandatory step makes it 👉 — the heading follows", () => {
    const optional = evaluate({ variant: "ship-successful", state: SHIPPED, delivery: ring("alpha") }, "de");
    expect(optional.heading).toBe("🟩 Alpha 🚀 — v0.1.0 — nach Beta promoten?");
    const mandatory = evaluate({ variant: "ship-successful", state: SHIPPED, delivery: ring("alpha"), userFinalTest: FINAL }, "en");
    expect(mandatory.heading).toBe("👉 Alpha 🚀 — v0.1.0 — promote to beta?");
    expect(mandatory.title).toBe("👉 ┃ Alpha 🚀 ");
  });

  test("worked examples from the concept read exactly", () => {
    expect(evaluate({ variant: "ready" }, "de").heading).toBe("👉 Ready 📦 — Shippen?");
    expect(evaluate({ variant: "ready" }, "en").heading).toBe("👉 Ready 📦 — Ship?");
    expect(evaluate({ variant: "test-minimal" }, "de").heading).toBe("🟩 Started 💡 — viel Spaß");
    expect(evaluate({ variant: "paused", pause: { reason: "usage-reset", resetAt: "14:00" } }, "de").heading)
      .toBe("🟦 Limit reset 🔋 — weiter nach dem Limit-Reset (14:00)");
    expect(evaluate({ variant: "aborted", cta: { reason: "Konflikt", activity: "ship" } }, "en").heading)
      .toBe("🟥 Ship 🚀 — aborted because of Konflikt — try differently?");
  });
});
