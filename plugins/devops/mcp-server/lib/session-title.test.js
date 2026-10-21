import { describe, test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SESSION_PREFIX,
  LEGACY_PREFIXES,
  VARIANT_TITLE_STATE,
  TITLE_SCHEME,
  stripTitlePrefix,
  releasedPrefix,
  pausedPrefix,
  titlePrefixFor,
  titleStateForKey,
  hasMandatoryStep,
  titleInstruction,
  conceptUrl,
  conceptCloseoutOnly,
  currentSessionTitle,
} from "./mode-state.js";
import TITLE_SCHEME_MOD from "../../hooks/lib/title-scheme.js";
const F = TITLE_SCHEME_MOD.withFill;

// The sidebar title names the state the last card left the session in. The
// card resolves the prefix from its own variant/pending/mode inputs and hands
// Claude an out-of-band instruction; these tests pin that resolution so the
// sidebar and the card CTA can never disagree.
const deps = {
  hasPending: (p) => Array.isArray(p) && p.length > 0,
  hasConcept: (c) => !!c,
};

const STATUS_ICONS = ["⏳", "👉", "🟩", "🟥", "🟦"];

describe("SESSION_PREFIX", () => {
  test("every named prefix is `<status> <activity> <Word…> – `; work is the bare hourglass", () => {
    for (const [k, p] of Object.entries(SESSION_PREFIX)) {
      if (k === "work") { expect(p, k).toBe(F("⏳ ┃ Solo 🤖 ")); continue; }
      const plain = p.split(TITLE_SCHEME.HAIR).join("");
      const m = /^(\S+) ┃ ([A-Z][a-z]+(?: [A-Za-z]+)?) (\p{Extended_Pictographic}️?) $/u.exec(plain);
      expect(m, k).not.toBeNull();
      expect(STATUS_ICONS, k).toContain(m[1]);
      expect(p, k).toBe(F(plain));
    }
  });

  test("done is a green box — never the old ✅", () => {
    for (const p of Object.values(SESSION_PREFIX)) expect(p.startsWith("✅")).toBe(false);
    expect(SESSION_PREFIX["released-alpha"]).toBe(F("🟩 ┃ Alpha 🚀 "));
    expect(SESSION_PREFIX.aborted).toBe(F("🟥 ┃ Aborted 📦 "));
  });

  test("the process and mode prefixes the skills spell out", () => {
    expect(SESSION_PREFIX.shipping).toBe(F("⏳ ┃ Shipping 🚀 "));
    expect(SESSION_PREFIX["concept-waiting"]).toBe(F("👉 ┃ Concept 🧭 "));
    expect(SESSION_PREFIX["concept-working"]).toBe(F("⏳ ┃ Concept 🧭 "));
    expect(SESSION_PREFIX.batch).toBe(F("👉 ┃ Batch 📚 "));
    expect(SESSION_PREFIX.blocked).toBe(F("👉 ┃ Blocked 🚧 "));
    expect(SESSION_PREFIX["paused-user"]).toBe(F("🟦 ┃ Paused ✋ "));
    expect(SESSION_PREFIX.interrupted).toBe(F("👉 ┃ Interrupted ⚡ "));
    expect(SESSION_PREFIX.system).toBe(F("🟩 ┃ System 🖥️ "));
  });

  test("no prefix is worded 'Working' or 'LIVE'", () => {
    for (const p of Object.values(SESSION_PREFIX)) expect(p).not.toMatch(/Working|LIVE/);
  });
});

describe("releasedPrefix", () => {
  test("names the channel reached: alpha on the rocket, beta/stable on the party popper", () => {
    expect(releasedPrefix("stable")).toBe(F("🟩 ┃ Stable 🚀 "));
    expect(releasedPrefix("Beta")).toBe(F("🟩 ┃ Beta 🚀 "));
    expect(releasedPrefix("alpha")).toBe(F("🟩 ┃ Alpha 🚀 "));
    expect(releasedPrefix("beta", { promoted: true })).toBe(F("🟩 ┃ Beta 🎊 "));
    expect(releasedPrefix("stable", { promoted: true })).toBe(F("🟩 ┃ Stable 🎊 "));
    expect(releasedPrefix("stable", { mandatory: true })).toBe(F("👉 ┃ Stable 🚀 "));
  });

  test("falls back to Released Alpha for an unknown or missing channel", () => {
    expect(releasedPrefix(undefined)).toBe(SESSION_PREFIX["released-alpha"]);
    expect(releasedPrefix("prod")).toBe(SESSION_PREFIX["released-alpha"]);
  });
});

describe("stripTitlePrefix", () => {
  test("removes one prefix", () => {
    expect(stripTitlePrefix(SESSION_PREFIX.ready + "Foo")).toBe("Foo");
  });

  test("removes stacked prefixes of any kind", () => {
    expect(stripTitlePrefix(SESSION_PREFIX.shipping + SESSION_PREFIX.test + SESSION_PREFIX["concept-waiting"] + "Foo")).toBe("Foo");
  });

  test("removes the released prefix per channel and the bare hourglass, alone or stacked", () => {
    expect(stripTitlePrefix(F("🟩 ┃ Stable 🎊 Foo"))).toBe("Foo");
    expect(stripTitlePrefix(SESSION_PREFIX.work + "Foo")).toBe("Foo");
    expect(stripTitlePrefix(SESSION_PREFIX.work + SESSION_PREFIX.ready + "Foo")).toBe("Foo");
  });

  test("removes the legacy worded hourglass, alone or stacked", () => {
    expect(LEGACY_PREFIXES).toContain("⏳ Working – ");
    expect(stripTitlePrefix("⏳ Working – Foo")).toBe("Foo");
    expect(stripTitlePrefix("⏳ Working – 🧭 Concept – Foo")).toBe("Foo");
    expect(stripTitlePrefix(SESSION_PREFIX.work + "⏳ Working – Foo")).toBe("Foo");
  });

  test("leaves a plain title untouched", () => {
    expect(stripTitlePrefix("Foo – Bar")).toBe("Foo – Bar");
    expect(stripTitlePrefix(undefined)).toBe("");
  });
});

describe("titleStateForKey / hasMandatoryStep", () => {
  test("every decision key maps to a scheme state", () => {
    const keys = ["ready", "ready-local", "question", "test", "test-local", "ready-red", "vv-unverified", "vv-running",
      "ship-blocked", "ship-successful", "ship-successful-kept", "ship-successful-closeout", "ship-successful-deploy",
      "released-beta", "released-stable", "ready-files", "test-minimal", "analysis", "aborted", "paused", "fallback",
      "pending", "concept-waiting", "concept-working", "batch"];
    for (const k of keys) expect(TITLE_SCHEME.STATES[titleStateForKey(k)], k).toBeDefined();
    expect(titleStateForKey("no-such-key")).toBe("system");
  });

  test("a mandatory step: open point, userTest, userFinalTest, requirement waiting on the user", () => {
    expect(hasMandatoryStep({})).toBe(false);
    expect(hasMandatoryStep({ open: [] })).toBe(false);
    expect(hasMandatoryStep({ open: ["x"] })).toBe(true);
    expect(hasMandatoryStep({ open: [{ text: "x" }] })).toBe(true);
    expect(hasMandatoryStep({ userTest: ["x"] })).toBe(true);
    expect(hasMandatoryStep({ userFinalTest: [{ action: "x" }] })).toBe(true);
    expect(hasMandatoryStep({ validation: [{ waitsOn: "user", status: "unmet" }] })).toBe(true);
    expect(hasMandatoryStep({ validation: [{ waitsOn: "user", status: "met" }] })).toBe(false);
  });
});

describe("titlePrefixFor", () => {
  test("every card variant maps to its own prefix (fallback without the card's outcome)", () => {
    expect(titlePrefixFor({ variant: "test" }, deps)).toBe(SESSION_PREFIX.test);
    expect(titlePrefixFor({ variant: "test-minimal" }, deps)).toBe(SESSION_PREFIX.started);
    expect(titlePrefixFor({ variant: "ready" }, deps)).toBe(SESSION_PREFIX.ready);
    expect(titlePrefixFor({ variant: "ready-files" }, deps)).toBe(SESSION_PREFIX.files);
    expect(titlePrefixFor({ variant: "ship-blocked" }, deps)).toBe(SESSION_PREFIX.blocked);
    expect(titlePrefixFor({ variant: "aborted" }, deps)).toBe(SESSION_PREFIX.aborted);
    expect(titlePrefixFor({ variant: "aborted", cta: { activity: "ship" } }, deps)).toBe(F("🟥 ┃ Ship 🚀 "));
    expect(titlePrefixFor({ variant: "analysis" }, deps)).toBe(SESSION_PREFIX.analysis);
    expect(titlePrefixFor({ variant: "fallback" }, deps)).toBe(SESSION_PREFIX.system);
    expect(titlePrefixFor({ variant: "paused" }, deps)).toBe(SESSION_PREFIX["paused-user"]);
    expect(titlePrefixFor({ variant: "no-such-variant" }, deps)).toBe("");
    expect(Object.keys(VARIANT_TITLE_STATE).sort()).toEqual([
      "aborted", "analysis", "fallback", "paused", "ready", "ready-files", "released",
      "ship-blocked", "ship-successful", "test", "test-minimal",
    ]);
  });

  test("the card's own outcome wins over the variant fallback", () => {
    const outcome = () => SESSION_PREFIX["red-tests"];
    expect(titlePrefixFor({ variant: "ready" }, { ...deps, outcome })).toBe(SESSION_PREFIX["red-tests"]);
  });

  test("a mandatory step raises a done state to the user's move", () => {
    expect(titlePrefixFor({ variant: "analysis", open: ["Welche Variante?"] }, deps)).toBe(F("👉 ┃ Analysis 📊 "));
    expect(titlePrefixFor({ variant: "test-minimal", userTest: ["Spiel starten"] }, deps)).toBe(F("👉 ┃ Started 💡 "));
  });

  // #548 / #583: the paused title names what unblocks the work; every reason
  // variant still strips back to the bare title.
  test("a paused card names its reason, and the prefix strips cleanly", () => {
    expect(pausedPrefix("restart")).toBe(F("🟦 ┃ Restart 🔌 "));
    expect(pausedPrefix("reboot")).toBe(F("🟦 ┃ Reboot 💻 "));
    expect(pausedPrefix("usage-reset")).toBe(F("🟦 ┃ Limit reset 🔋 "));
    expect(pausedPrefix("user")).toBe(SESSION_PREFIX["paused-user"]);
    expect(pausedPrefix(undefined)).toBe(SESSION_PREFIX["paused-user"]);
    expect(titlePrefixFor({ variant: "paused", pause: { reason: "restart" } }, deps)).toBe(F("🟦 ┃ Restart 🔌 "));
    expect(titlePrefixFor({ variant: "paused", pause: { reason: "user" } }, deps)).toBe(SESSION_PREFIX["paused-user"]);
    for (const r of ["restart", "reboot", "usage-reset", "user"]) {
      expect(stripTitlePrefix(pausedPrefix(r) + "Plugin update"), r).toBe("Plugin update");
      expect(stripTitlePrefix("⏳ " + pausedPrefix(r) + "Plugin update"), r).toBe("Plugin update");
    }
  });

  test("a ship lands as Released Alpha — final and intermediate alike", () => {
    expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main" } }, deps)).toBe(SESSION_PREFIX["released-alpha"]);
    expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main", kept: true } }, deps)).toBe(SESSION_PREFIX["released-alpha"]);
    expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "feat/video" } }, deps)).toBe(SESSION_PREFIX["released-alpha"]);
    expect(titlePrefixFor({ variant: "ship-successful" }, deps)).toBe(SESSION_PREFIX["released-alpha"]);
  });

  test("a released card names the channel reached — Promoted without a merge, Released after one", () => {
    expect(titlePrefixFor({ variant: "released", delivery: { promote: { current: "stable" } } }, deps)).toBe(F("🟩 ┃ Stable 🎊 "));
    expect(titlePrefixFor({ variant: "released", promotion: { to: "beta" } }, deps)).toBe(F("🟩 ┃ Beta 🎊 "));
    expect(titlePrefixFor({ variant: "released", cta: { to: "stable" } }, deps)).toBe(F("🟩 ┃ Stable 🎊 "));
    expect(titlePrefixFor({ variant: "released", state: { merged: "main" }, delivery: { promote: { current: "stable" } } }, deps)).toBe(F("🟩 ┃ Stable 🚀 "));
    expect(titlePrefixFor({ variant: "released" }, deps)).toBe(F("🟩 ┃ Beta 🎊 "));
  });

  test("pending background work outranks the variant", () => {
    expect(titlePrefixFor({ variant: "ready", pending: [{ name: "qa", kind: "agent" }] }, deps)).toBe(SESSION_PREFIX.agents);
  });

  // #416: the concept prefix follows the phase. The compass means "your
  // move — look at the page": only a waiting page carries it, stated every
  // time so a session coming back from a round of work returns to it.
  // Iterating and implementing are Claude's move: the hourglass, like any
  // pending card.
  test("a concept card states the prefix of its phase — 👉 while waiting, ⏳ while iterating/implementing", () => {
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "waiting" } }, deps)).toBe(SESSION_PREFIX["concept-waiting"]);
    expect(titlePrefixFor({ variant: "ready", concept: "waiting" }, deps)).toBe(SESSION_PREFIX["concept-waiting"]);
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "iterating" } }, deps)).toBe(SESSION_PREFIX["concept-working"]);
    expect(titlePrefixFor({ variant: "ready", concept: "iterating" }, deps)).toBe(SESSION_PREFIX["concept-working"]);
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "implementing" } }, deps)).toBe(SESSION_PREFIX["concept-working"]);
    expect(titlePrefixFor({ variant: "ready", concept: "implementing" }, deps)).toBe(SESSION_PREFIX["concept-working"]);
    expect(titlePrefixFor({ variant: "ready", concept: '{"phase":"implementing"}' }, deps)).toBe(SESSION_PREFIX["concept-working"]);
    // Unknown phase reads as waiting — the safe default, same as the CTA.
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "bogus" } }, deps)).toBe(SESSION_PREFIX["concept-waiting"]);
    expect(titlePrefixFor({ variant: "ready", concept: true }, deps)).toBe(SESSION_PREFIX["concept-waiting"]);
  });

  test("an implementing/iterating concept with pending work stays ⏳ 🧭 Concept; a waiting one 👉 ┃ Concept 🧭", () => {
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "implementing" }, pending: [{ name: "feature", kind: "agent" }] }, deps)).toBe(SESSION_PREFIX["concept-working"]);
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "iterating" }, pending: [{ name: "research", kind: "agent" }] }, deps)).toBe(SESSION_PREFIX["concept-working"]);
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "waiting" }, pending: [{ name: "feature", kind: "agent" }] }, deps)).toBe(SESSION_PREFIX["concept-waiting"]);
  });

  // Without the field the card cannot tell whether the open page belongs to
  // THIS session. The title-work hook swaps the compass for the hourglass on
  // every user prompt, so "hands off" here would strand ⏳ on a waiting page:
  // the card hands Claude a conditional instead.
  test("a concept-active.json in cwd without a concept field yields a conditional: compass for the owner, the outcome for anyone else", () => {
    const cwd = mkdtempSync(join(tmpdir(), "devops-title-"));
    try {
      mkdirSync(join(cwd, ".claude"));
      writeFileSync(join(cwd, ".claude", "concept-active.json"), JSON.stringify({ port: 4321, html_path: "docs/concepts/x.html" }));
      mkdirSync(join(cwd, "docs", "concepts"), { recursive: true });
      writeFileSync(join(cwd, "docs", "concepts", "x.html"), "<!doctype html>");
      expect(titlePrefixFor({ variant: "ready", cwd }, deps)).toEqual({ owned: SESSION_PREFIX["concept-waiting"], other: SESSION_PREFIX.ready });
      expect(titlePrefixFor({ variant: "ship-successful", cwd }, deps)).toEqual({ owned: SESSION_PREFIX["concept-waiting"], other: SESSION_PREFIX["released-alpha"] });
      // Background work outranks the compass for the owner, and the variant for anyone else.
      expect(titlePrefixFor({ variant: "ready", cwd, pending: [{ name: "qa", kind: "agent" }] }, deps))
        .toEqual({ owned: SESSION_PREFIX["concept-working"], other: SESSION_PREFIX.agents });
      // The explicit concept field still wins over the state file.
      expect(titlePrefixFor({ variant: "ready", cwd, concept: { phase: "iterating" } }, deps)).toBe(SESSION_PREFIX["concept-working"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  // #693: after the implement ship the page only waits for its close-out —
  // a merged ship's title is the outcome, never the compass.
  test("a concept-active.json whose page carries the final report: ship outcomes get the plain shipped/released prefix", () => {
    const cwd = mkdtempSync(join(tmpdir(), "devops-title-"));
    try {
      mkdirSync(join(cwd, ".claude"));
      mkdirSync(join(cwd, "docs", "concepts"), { recursive: true });
      writeFileSync(join(cwd, ".claude", "concept-active.json"), JSON.stringify({ port: 4321, html_path: "docs/concepts/x.html" }));
      writeFileSync(join(cwd, "docs", "concepts", "x.html"), '<section data-iteration="2"></section><section data-iteration="3" data-final-report data-active></section>');
      expect(conceptCloseoutOnly(cwd)).toBe(true);
      expect(titlePrefixFor({ variant: "ship-successful", cwd }, deps)).toBe(SESSION_PREFIX["released-alpha"]);
      expect(titlePrefixFor({ variant: "released", cwd, delivery: { promote: { current: "beta" } } }, deps)).toBe(releasedPrefix("beta", { promoted: true }));
      expect(titlePrefixFor({ variant: "ship-successful", cwd, pending: [{ name: "qa", kind: "agent" }] }, deps)).toBe(SESSION_PREFIX.agents);
      // Not a ship outcome: the conditional stays.
      expect(titlePrefixFor({ variant: "ready", cwd }, deps)).toEqual({ owned: SESSION_PREFIX["concept-waiting"], other: SESSION_PREFIX.ready });
      // The marker only inside a script does not count.
      writeFileSync(join(cwd, "docs", "concepts", "x.html"), '<section data-iteration="1"></section><script>q("<section data-final-report>")</script>');
      expect(conceptCloseoutOnly(cwd)).toBe(false);
      expect(titlePrefixFor({ variant: "ship-successful", cwd }, deps)).toEqual({ owned: SESSION_PREFIX["concept-waiting"], other: SESSION_PREFIX["released-alpha"] });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
    expect(conceptCloseoutOnly(undefined)).toBe(false);
  });

  // A state file the resume hook would refuse (absolute html_path — a
  // pre-#284 concept) or prune (>24 h old) is a corpse: it must not keep the
  // sidebar on "🚀 Shipping –" after a ship. Observed 2026-09-17.
  test("a dead concept-active.json does NOT own the title: invalid html_path or older than 24 h", () => {
    const cases = [
      { port: 8774, html_path: "C:/Users/x/.claude/devops-concepts/2026-08-16-repo-health.html", started_at: "2026-08-16T18:03:20.000Z" },
      { port: 8774, html_path: "docs/concepts/x.html", started_at: new Date(Date.now() - 25 * 3600_000).toISOString() },
      { port: 0, html_path: "docs/concepts/x.html" },
    ];
    for (const state of cases) {
      const cwd = mkdtempSync(join(tmpdir(), "devops-title-dead-"));
      try {
        mkdirSync(join(cwd, ".claude"));
        writeFileSync(join(cwd, ".claude", "concept-active.json"), JSON.stringify(state));
        expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main" }, cwd }, deps), JSON.stringify(state)).toBe(SESSION_PREFIX["released-alpha"]);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  });

  // #563: the open was more than 24 h ago, but the durable store shows recent
  // activity (a save) or a typed draft — the same last-activity rule as the
  // resume hook (#426), so the card does not declare a live concept dead.
  test("an old concept-active.json with recent store activity or a draft still counts as an open concept", () => {
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    const stores = [
      { "state.json": { saved_at: new Date().toISOString(), decisions: "{}" } },
      { "state.json": { saved_at: old, decisions: "{}" }, "drafts/a.json": { ts: old, state: { "text:q1": "noch offen" } } },
    ];
    for (const files of stores) {
      const cwd = mkdtempSync(join(tmpdir(), "devops-title-store-"));
      try {
        mkdirSync(join(cwd, ".claude", "concepts", "x", "drafts"), { recursive: true });
        writeFileSync(join(cwd, ".claude", "concept-active.json"), JSON.stringify({ port: 4321, html_path: "docs/concepts/x.html", started_at: old }));
      mkdirSync(join(cwd, "docs", "concepts"), { recursive: true }); writeFileSync(join(cwd, "docs", "concepts", "x.html"), "<!doctype html>");
        for (const [rel, body] of Object.entries(files)) writeFileSync(join(cwd, ".claude", "concepts", "x", rel), JSON.stringify(body));
        expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main" }, cwd }, deps), JSON.stringify(files))
          .toEqual({ owned: SESSION_PREFIX["concept-waiting"], other: SESSION_PREFIX["released-alpha"] });
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  });

  // #563: a card that carries a `concept` field asserts the page is open, so
  // its link resolves whatever the age of the open.
  test("conceptUrl resolves the link for an old state when the card carries a concept field", () => {
    const cwd = mkdtempSync(join(tmpdir(), "devops-title-url-"));
    try {
      mkdirSync(join(cwd, ".claude"));
      writeFileSync(join(cwd, ".claude", "concept-active.json"), JSON.stringify({ port: 4321, html_path: "docs/concepts/x.html", started_at: new Date(Date.now() - 48 * 3600_000).toISOString() }));
      mkdirSync(join(cwd, "docs", "concepts"), { recursive: true }); writeFileSync(join(cwd, "docs", "concepts", "x.html"), "<!doctype html>");
      expect(conceptUrl(cwd, { phase: "waiting" })).toBe("http://localhost:4321/docs/concepts/x.html");
      expect(conceptUrl(cwd, undefined)).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  // #555: a paused concept has no bridge — no link, no compass; the card's own
  // outcome (the `paused` variant of the pausing turn) owns the title.
  test("a paused concept-active.json neither owns the title nor yields a link", () => {
    const cwd = mkdtempSync(join(tmpdir(), "devops-title-paused-"));
    try {
      mkdirSync(join(cwd, ".claude"));
      writeFileSync(join(cwd, ".claude", "concept-active.json"), JSON.stringify({ port: 4321, html_path: "docs/concepts/x.html", started_at: new Date().toISOString(), paused_at: new Date().toISOString() }));
      expect(titlePrefixFor({ variant: "paused", cwd }, deps)).toBe(SESSION_PREFIX["paused-user"]);
      expect(conceptUrl(cwd, undefined)).toBe("");
      expect(conceptUrl(cwd, { phase: "waiting" })).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("a fresh concept-active.json (started_at within 24 h) still counts as an open concept", () => {
    const cwd = mkdtempSync(join(tmpdir(), "devops-title-live-"));
    try {
      mkdirSync(join(cwd, ".claude"));
      writeFileSync(join(cwd, ".claude", "concept-active.json"), JSON.stringify({ port: 4321, html_path: "docs/concepts/x.html", started_at: new Date().toISOString() }));
      mkdirSync(join(cwd, "docs", "concepts"), { recursive: true }); writeFileSync(join(cwd, "docs", "concepts", "x.html"), "<!doctype html>");
      expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main" }, cwd }, deps))
        .toEqual({ owned: SESSION_PREFIX["concept-waiting"], other: SESSION_PREFIX["released-alpha"] });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("titleInstruction", () => {
  test("is empty when a mode owns the title", () => {
    expect(titleInstruction(null)).toBe("");
  });

  test("names the prefix, both session-mgmt tools, every strippable prefix, and the silent-skip rule", () => {
    const text = titleInstruction(SESSION_PREFIX.test);
    expect(text.startsWith("[SESSION TITLE — DO NOT OUTPUT THIS BLOCK]")).toBe(true);
    expect(text).toContain("mcp__ccd_session_mgmt__get_session");
    expect(text).toContain("mcp__ccd_session_mgmt__set_session_title");
    expect(text).toContain(`"${SESSION_PREFIX.test}" + <stripped title>`);
    // The strip rule names every status icon and every legacy prefix — never a free "Xxx – ".
    for (const s of ["⏳", "👉", "🟩", "🟥", "⏸️"]) expect(text).toContain(s);
    for (const p of LEGACY_PREFIXES) expect(text).toContain(`"${p}"`);
    expect(text).toMatch(/never free text that only looks like one/);
    expect(text).toMatch(/skip silently/);
    expect(text).toMatch(/Desktop app only/);
    // #661: a deferred tool is not an unavailable one — load, then call.
    expect(text).toMatch(/Deferred is not unavailable/);
    expect(text).toContain("select:mcp__ccd_session_mgmt__get_session,mcp__ccd_session_mgmt__set_session_title");
  });

  // The concept finalize ship renders its ship card while the state file is
  // still there: the "closes the concept out" branch is what lets that card
  // end on 🟩 ┃ Alpha 🚀 instead of the concept prefix.
  test("a conditional names the concept, the owner's prefix, the close-out case and the other prefix", () => {
    const text = titleInstruction({ owned: SESSION_PREFIX["concept-waiting"], other: SESSION_PREFIX["released-alpha"] });
    expect(text.startsWith("[SESSION TITLE — DO NOT OUTPUT THIS BLOCK]")).toBe(true);
    expect(text).toContain("concept-active.json");
    expect(text).toMatch(/If THIS session runs that concept/);
    expect(text).toContain(`"${SESSION_PREFIX["concept-waiting"]}" + <stripped title>`);
    expect(text).toMatch(/this turn closes the concept out/);
    expect(text).toContain(`"${SESSION_PREFIX["released-alpha"]}" + <stripped title>`);
    expect(text).toMatch(/skip silently/);
  });

  test("a conditional with no other prefix (armed batch) leaves a foreign title alone", () => {
    const text = titleInstruction({ owned: SESSION_PREFIX["concept-waiting"], other: null });
    expect(text).toMatch(/leave the title as it is/);
  });

  test("the legacy worded hourglass is in the strip list", () => {
    expect(titleInstruction(SESSION_PREFIX.ready)).toContain('"⏳ Working – "');
  });

  test("an empty prefix asks for the stripped title only when something was stripped", () => {
    const text = titleInstruction("");
    expect(text).toMatch(/no prefix/);
    expect(text).toMatch(/only if a prefix was actually removed/);
  });
});

// Token cost: get_session → strip → set was 2–3 extra API calls per card, each
// re-reading the whole context. With the title read off the transcript the
// block names the exact value and the set call rides in the widget's batch.
describe("titleInstruction — current title known", () => {
  const SET = "mcp__ccd_session_mgmt__set_session_title";

  test("the exact title, parallel to show_widget — no get_session", () => {
    const text = titleInstruction(SESSION_PREFIX.ready, "⏳ Login fix");
    expect(text.startsWith("[SESSION TITLE — DO NOT OUTPUT THIS BLOCK]")).toBe(true);
    expect(text).toContain(`${SET} {session_id:"self", title:${JSON.stringify(F("👉 ┃ Ready 📦 Login fix"))}}`);
    expect(text).toMatch(/SAME assistant message as the card's show_widget call/);
    expect(text).toMatch(/set_session_title first in the batch/);
    expect(text).not.toContain("mcp__ccd_session_mgmt__get_session");
    expect(text).toContain(`ToolSearch "select:${SET}"`);
    expect(text).toMatch(/skip silently/);
  });

  test("stacked and legacy prefixes go, the title is JSON-escaped", () => {
    const rest = 'Fix "quotes" ' + String.fromCharCode(92) + " path";
    const text = titleInstruction(releasedPrefix("stable"), "⏳ Working – 🚀 Shipping – " + rest);
    expect(text).toContain(`title:${JSON.stringify(F("🟩 ┃ Stable 🚀 ") + rest)}}`);
  });

  test("a title that is already right needs no block at all", () => {
    expect(titleInstruction(SESSION_PREFIX["released-alpha"], F("🟩 ┃ Alpha 🚀 Login"))).toBe("");
    expect(titleInstruction("", "Plain title")).toBe("");
    expect(titleInstruction(SESSION_PREFIX.ready, F("👉 ┃ Ready 📦 "))).toBe("");
    // FE0F-tolerant: the same prefix without the variation selector is "already right" after one rewrite.
    expect(titleInstruction(SESSION_PREFIX["paused-user"], "🟦 ┃ Paused ✋ Job")).toContain(`title:${JSON.stringify(F("🟦 ┃ Paused ✋ Job"))}}`);
  });

  test("an empty prefix strips only — the known stripped title", () => {
    expect(titleInstruction("", "🧪 Test – X")).toContain(`title:"X"}`);
  });

  test("a mode-owned title stays untouched whatever the current title", () => {
    expect(titleInstruction(null, "📥 Batch – X")).toBe("");
  });

  test("an unattributed concept keeps its conditional, with exact titles", () => {
    const text = titleInstruction({ owned: SESSION_PREFIX["concept-waiting"], other: SESSION_PREFIX["released-alpha"] }, "⏳ Page");
    expect(text).toContain(`title:${JSON.stringify(F("👉 ┃ Concept 🧭 Page"))}}`);
    expect(text).toContain(`title:${JSON.stringify(F("🟩 ┃ Alpha 🚀 Page"))}}`);
    expect(text).toMatch(/If THIS session runs that concept/);
    const leave = titleInstruction({ owned: SESSION_PREFIX["concept-waiting"], other: null }, F("👉 ┃ Concept 🧭 Page"));
    expect(leave).toBe("");
    const half = titleInstruction({ owned: SESSION_PREFIX["concept-waiting"], other: null }, "⏳ Page");
    expect(half).toContain(`title:${JSON.stringify(F("👉 ┃ Concept 🧭 Page"))}}`);
    expect(half).toMatch(/leave the title \(no call\)/);
  });

  test("unknown title (null, blank) → the get_session fallback, unchanged", () => {
    for (const cur of [null, undefined, "", "  "]) {
      const text = titleInstruction(SESSION_PREFIX.ready, cur);
      expect(text).toContain("mcp__ccd_session_mgmt__get_session");
      expect(text).toContain(`"${SESSION_PREFIX.ready}" + <stripped title>`);
    }
  });
});

describe("currentSessionTitle", () => {
  test("reads the last custom-title of the session's transcript; null when unknown", () => {
    const home = mkdtempSync(join(tmpdir(), "cst-home-"));
    try {
      const cwd = join(home, "my.repo");
      const dir = join(home, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "sid-1.jsonl"), [
        JSON.stringify({ type: "custom-title", customTitle: "⏳ Old" }),
        JSON.stringify({ type: "user", message: { content: "hi" } }),
        JSON.stringify({ type: "custom-title", customTitle: "⏳ New" }),
      ].join("\n") + "\n");
      expect(currentSessionTitle("sid-1", cwd, home)).toBe("⏳ New");
      expect(currentSessionTitle("sid-2", cwd, home)).toBeNull();
      expect(currentSessionTitle(undefined, cwd, home)).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// #785: a running ship — also a delegated one in a subagent — owns the title.
// A card that does not end the ship never puts the compass back over
// `⏳ 🚀 Shipping – `; ship-ending cards and an unknown title keep the old rules.
describe("titlePrefixFor — a running ship outranks a waiting concept", () => {
  const shipping = "⏳ 🚀 Shipping – v0.12 Stationen";

  test("a waiting concept card leaves the shipping title (no rename)", () => {
    const prefix = titlePrefixFor({ variant: "ready", concept: { phase: "waiting" } }, { ...deps, current: shipping });
    expect(prefix).toBeNull();
    expect(titleInstruction(prefix, shipping)).toBe("");
  });

  test("ship-ending cards still replace the shipping prefix", () => {
    expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main" } }, { ...deps, current: shipping }))
      .toBe(SESSION_PREFIX["released-alpha"]);
    expect(titlePrefixFor({ variant: "ship-blocked" }, { ...deps, current: shipping })).toBe(SESSION_PREFIX.blocked);
    expect(titlePrefixFor({ variant: "ship-successful", concept: { phase: "waiting" } }, { ...deps, current: shipping }))
      .toBe(SESSION_PREFIX["concept-waiting"]);
  });

  test("without a shipping title, or with an unknown one, a waiting concept still gets the compass", () => {
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "waiting" } }, { ...deps, current: "⏳ v0.12 Stationen" }))
      .toBe(SESSION_PREFIX["concept-waiting"]);
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "waiting" } }, { ...deps, current: null }))
      .toBe(SESSION_PREFIX["concept-waiting"]);
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "waiting" } }, deps)).toBe(SESSION_PREFIX["concept-waiting"]);
  });

  test("an iterating concept keeps its working prefix", () => {
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "iterating" } }, { ...deps, current: shipping }))
      .toBe(SESSION_PREFIX["concept-working"]);
  });

  test("the conditional concept path leaves the shipping title for the owner", () => {
    const cwd = mkdtempSync(join(tmpdir(), "devops-title-ship-"));
    try {
      mkdirSync(join(cwd, ".claude"));
      writeFileSync(join(cwd, ".claude", "concept-active.json"), JSON.stringify({ port: 4321, html_path: "docs/concepts/x.html" }));
      mkdirSync(join(cwd, "docs", "concepts"), { recursive: true });
      writeFileSync(join(cwd, "docs", "concepts", "x.html"), "<!doctype html>");
      expect(titlePrefixFor({ variant: "ready", cwd }, { ...deps, current: shipping }))
        .toEqual({ owned: null, other: SESSION_PREFIX.ready });
      expect(titlePrefixFor({ variant: "ready", cwd }, { ...deps, current: "⏳ v0.12 Stationen" }))
        .toEqual({ owned: SESSION_PREFIX["concept-waiting"], other: SESSION_PREFIX.ready });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
