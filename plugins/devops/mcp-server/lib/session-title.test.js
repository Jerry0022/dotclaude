import { describe, test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SESSION_PREFIX,
  LEGACY_PREFIXES,
  VARIANT_TITLE_PREFIX,
  stripTitlePrefix,
  releasedPrefix,
  pausedPrefix,
  titlePrefixFor,
  titleInstruction,
  conceptUrl,
  conceptCloseoutOnly,
  currentSessionTitle,
} from "./mode-state.js";

// The sidebar title names the state the last card left the session in. The
// card resolves the prefix from its own variant/pending/mode inputs and hands
// Claude an out-of-band instruction; these tests pin that resolution so the
// sidebar and the card CTA can never disagree.
const deps = {
  hasPending: (p) => Array.isArray(p) && p.length > 0,
  hasConcept: (c) => !!c,
};

describe("SESSION_PREFIX", () => {
  test("every worded prefix is emoji-first and ends in ' – '; work and pending are the bare hourglass", () => {
    for (const [k, p] of Object.entries(SESSION_PREFIX)) {
      if (k === "work" || k === "pending") expect(p, k).toBe("⏳ ");
      else expect(p, k).toMatch(/^\S+ [A-Z][a-z]+ – $/u);
    }
  });

  test("each prefix carries its card's CTA emoji", () => {
    expect(SESSION_PREFIX.shipped.startsWith("🚀")).toBe(true);
    expect(SESSION_PREFIX.shipping.startsWith("🚀")).toBe(true);
    expect(SESSION_PREFIX.released.startsWith("🎊")).toBe(true);
    expect(SESSION_PREFIX.blocked.startsWith("⛔")).toBe(true);
    expect(SESSION_PREFIX.test.startsWith("🧪")).toBe(true);
    expect(SESSION_PREFIX.started.startsWith("▶️")).toBe(true);
    expect(SESSION_PREFIX.analysis.startsWith("📋")).toBe(true);
    expect(SESSION_PREFIX.fallback.startsWith("🔧")).toBe(true);
    expect(SESSION_PREFIX.work.startsWith("⏳")).toBe(true);
  });

  // One hourglass, one meaning: "Claude works, not your move". The worded
  // "⏳ Working – " next to the bare "⏳ " read as two states for one.
  test("the hourglass is one state — pending work and a working turn share the bare icon", () => {
    expect(SESSION_PREFIX.pending).toBe(SESSION_PREFIX.work);
    for (const p of Object.values(SESSION_PREFIX)) expect(p).not.toMatch(/Working/);
  });

  test("shipped is the finished form of shipping — same rocket, no -ing", () => {
    expect(SESSION_PREFIX.shipped).toBe("🚀 Shipped – ");
    expect(SESSION_PREFIX.shipping).toBe("🚀 Shipping – ");
  });
});

describe("releasedPrefix", () => {
  test("names the channel reached, capitalised", () => {
    expect(releasedPrefix("stable")).toBe("🎊 Released Stable – ");
    expect(releasedPrefix("Beta")).toBe("🎊 Released Beta – ");
    expect(releasedPrefix("alpha")).toBe("🎊 Released Alpha – ");
  });

  test("falls back to the bare base for an unknown or missing channel", () => {
    expect(releasedPrefix(undefined)).toBe(SESSION_PREFIX.released);
    expect(releasedPrefix("prod")).toBe(SESSION_PREFIX.released);
  });
});

describe("stripTitlePrefix", () => {
  test("removes one prefix", () => {
    expect(stripTitlePrefix(SESSION_PREFIX.ready + "Foo")).toBe("Foo");
  });

  test("removes stacked prefixes of any kind", () => {
    expect(stripTitlePrefix(SESSION_PREFIX.shipping + SESSION_PREFIX.test + SESSION_PREFIX.concept + "Foo")).toBe("Foo");
  });

  test("removes a released prefix with channel and the bare wrench", () => {
    expect(stripTitlePrefix("🎊 Released Stable – Foo")).toBe("Foo");
    expect(stripTitlePrefix(SESSION_PREFIX.work + "Foo")).toBe("Foo");
    expect(stripTitlePrefix(SESSION_PREFIX.work + SESSION_PREFIX.ready + "Foo")).toBe("Foo");
  });

  test("removes the legacy worded hourglass, alone or stacked", () => {
    expect(LEGACY_PREFIXES).toContain("⏳ Working – ");
    expect(stripTitlePrefix("⏳ Working – Foo")).toBe("Foo");
    expect(stripTitlePrefix("⏳ Working – " + SESSION_PREFIX.concept + "Foo")).toBe("Foo");
    expect(stripTitlePrefix(SESSION_PREFIX.work + "⏳ Working – Foo")).toBe("Foo");
  });

  test("leaves a plain title untouched", () => {
    expect(stripTitlePrefix("Foo – Bar")).toBe("Foo – Bar");
    expect(stripTitlePrefix(undefined)).toBe("");
  });
});

describe("titlePrefixFor", () => {
  test("every card variant maps to its own prefix", () => {
    expect(titlePrefixFor({ variant: "test" }, deps)).toBe(SESSION_PREFIX.test);
    expect(titlePrefixFor({ variant: "test-minimal" }, deps)).toBe(SESSION_PREFIX.started);
    expect(titlePrefixFor({ variant: "ready" }, deps)).toBe(SESSION_PREFIX.ready);
    expect(titlePrefixFor({ variant: "ready-files" }, deps)).toBe(SESSION_PREFIX.ready);
    expect(titlePrefixFor({ variant: "ship-blocked" }, deps)).toBe(SESSION_PREFIX.blocked);
    expect(titlePrefixFor({ variant: "aborted" }, deps)).toBe(SESSION_PREFIX.aborted);
    expect(titlePrefixFor({ variant: "analysis" }, deps)).toBe(SESSION_PREFIX.analysis);
    expect(titlePrefixFor({ variant: "fallback" }, deps)).toBe(SESSION_PREFIX.fallback);
    expect(titlePrefixFor({ variant: "paused" }, deps)).toBe(SESSION_PREFIX.paused);
    expect(titlePrefixFor({ variant: "no-such-variant" }, deps)).toBe("");
    expect(Object.keys(VARIANT_TITLE_PREFIX).sort()).toEqual([
      "aborted", "analysis", "fallback", "paused", "ready", "ready-files", "released",
      "ship-blocked", "ship-successful", "test", "test-minimal",
    ]);
  });

  // #548: paused work read "🔧 Done" in the sidebar. The pause prefix is its
  // own, and it is stripped like every other one — never stacked.
  test("a paused card titles the session ⏸️ Paused, and the prefix strips cleanly", () => {
    expect(SESSION_PREFIX.paused).toBe("⏸️ Paused – ");
    expect(stripTitlePrefix("⏸️ Paused – PC cleanup")).toBe("PC cleanup");
    expect(stripTitlePrefix("⏳ ⏸️ Paused – PC cleanup")).toBe("PC cleanup");
  });

  // #583: the paused title names what unblocks the work; every reason
  // variant still strips back to the bare title.
  test("a paused card with a reason names it in the title, and it strips cleanly", () => {
    expect(pausedPrefix("restart")).toBe("⏸️ Paused until restart – ");
    expect(pausedPrefix("reboot")).toBe("⏸️ Paused until reboot – ");
    expect(pausedPrefix("usage-reset")).toBe("⏸️ Paused until limit reset – ");
    expect(pausedPrefix("user")).toBe(SESSION_PREFIX.paused);
    expect(pausedPrefix(undefined)).toBe(SESSION_PREFIX.paused);
    expect(titlePrefixFor({ variant: "paused", pause: { reason: "restart" } }, deps)).toBe("⏸️ Paused until restart – ");
    expect(titlePrefixFor({ variant: "paused", pause: { reason: "user" } }, deps)).toBe(SESSION_PREFIX.paused);
    for (const r of ["restart", "reboot", "usage-reset"]) {
      expect(stripTitlePrefix(pausedPrefix(r) + "Plugin update"), r).toBe("Plugin update");
      expect(stripTitlePrefix("⏳ " + pausedPrefix(r) + "Plugin update"), r).toBe("Plugin update");
    }
  });

  test("a ship lands as Shipped — final and intermediate alike", () => {
    expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main" } }, deps)).toBe(SESSION_PREFIX.shipped);
    expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main", kept: true } }, deps)).toBe(SESSION_PREFIX.shipped);
    expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "feat/video" } }, deps)).toBe(SESSION_PREFIX.shipped);
    expect(titlePrefixFor({ variant: "ship-successful" }, deps)).toBe(SESSION_PREFIX.shipped);
  });

  test("a released card names the channel reached — delivery, then promotion, then cta", () => {
    expect(titlePrefixFor({ variant: "released", delivery: { promote: { current: "stable" } } }, deps)).toBe("🎊 Released Stable – ");
    expect(titlePrefixFor({ variant: "released", promotion: { to: "beta" } }, deps)).toBe("🎊 Released Beta – ");
    expect(titlePrefixFor({ variant: "released", cta: { to: "stable" } }, deps)).toBe("🎊 Released Stable – ");
    expect(titlePrefixFor({ variant: "released" }, deps)).toBe(SESSION_PREFIX.released);
  });

  test("pending background work outranks the variant", () => {
    expect(titlePrefixFor({ variant: "ready", pending: [{ name: "qa", kind: "agent" }] }, deps)).toBe(SESSION_PREFIX.pending);
  });

  // #416: the concept prefix follows the phase. The compass means "your
  // move — look at the page": only a waiting page carries it, stated every
  // time so a session coming back from a round of work returns to it.
  // Iterating and implementing are Claude's move: the hourglass, like any
  // pending card.
  test("a concept card states the prefix of its phase — compass only while waiting, hourglass while iterating/implementing", () => {
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "waiting" } }, deps)).toBe(SESSION_PREFIX.concept);
    expect(titlePrefixFor({ variant: "ready", concept: "waiting" }, deps)).toBe(SESSION_PREFIX.concept);
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "iterating" } }, deps)).toBe(SESSION_PREFIX.pending);
    expect(titlePrefixFor({ variant: "ready", concept: "iterating" }, deps)).toBe(SESSION_PREFIX.pending);
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "implementing" } }, deps)).toBe(SESSION_PREFIX.pending);
    expect(titlePrefixFor({ variant: "ready", concept: "implementing" }, deps)).toBe(SESSION_PREFIX.pending);
    expect(titlePrefixFor({ variant: "ready", concept: '{"phase":"implementing"}' }, deps)).toBe(SESSION_PREFIX.pending);
    // Unknown phase reads as waiting — the safe default, same as the CTA.
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "bogus" } }, deps)).toBe(SESSION_PREFIX.concept);
    expect(titlePrefixFor({ variant: "ready", concept: true }, deps)).toBe(SESSION_PREFIX.concept);
  });

  test("an implementing/iterating concept with pending work is still the hourglass, never the compass", () => {
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "implementing" }, pending: [{ name: "feature", kind: "agent" }] }, deps)).toBe(SESSION_PREFIX.pending);
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "iterating" }, pending: [{ name: "research", kind: "agent" }] }, deps)).toBe(SESSION_PREFIX.pending);
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "waiting" }, pending: [{ name: "feature", kind: "agent" }] }, deps)).toBe(SESSION_PREFIX.concept);
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
      expect(titlePrefixFor({ variant: "ready", cwd }, deps)).toEqual({ owned: SESSION_PREFIX.concept, other: SESSION_PREFIX.ready });
      expect(titlePrefixFor({ variant: "ship-successful", cwd }, deps)).toEqual({ owned: SESSION_PREFIX.concept, other: SESSION_PREFIX.shipped });
      // Background work outranks the compass for the owner, and the variant for anyone else.
      expect(titlePrefixFor({ variant: "ready", cwd, pending: [{ name: "qa", kind: "agent" }] }, deps))
        .toEqual({ owned: SESSION_PREFIX.pending, other: SESSION_PREFIX.pending });
      // The explicit concept field still wins over the state file.
      expect(titlePrefixFor({ variant: "ready", cwd, concept: { phase: "iterating" } }, deps)).toBe(SESSION_PREFIX.pending);
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
      expect(titlePrefixFor({ variant: "ship-successful", cwd }, deps)).toBe(SESSION_PREFIX.shipped);
      expect(titlePrefixFor({ variant: "released", cwd, delivery: { promote: { current: "beta" } } }, deps)).toBe(releasedPrefix("beta"));
      expect(titlePrefixFor({ variant: "ship-successful", cwd, pending: [{ name: "qa", kind: "agent" }] }, deps)).toBe(SESSION_PREFIX.pending);
      // Not a ship outcome: the conditional stays.
      expect(titlePrefixFor({ variant: "ready", cwd }, deps)).toEqual({ owned: SESSION_PREFIX.concept, other: SESSION_PREFIX.ready });
      // The marker only inside a script does not count.
      writeFileSync(join(cwd, "docs", "concepts", "x.html"), '<section data-iteration="1"></section><script>q("<section data-final-report>")</script>');
      expect(conceptCloseoutOnly(cwd)).toBe(false);
      expect(titlePrefixFor({ variant: "ship-successful", cwd }, deps)).toEqual({ owned: SESSION_PREFIX.concept, other: SESSION_PREFIX.shipped });
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
        expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main" }, cwd }, deps), JSON.stringify(state)).toBe(SESSION_PREFIX.shipped);
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
        for (const [rel, body] of Object.entries(files)) writeFileSync(join(cwd, ".claude", "concepts", "x", rel), JSON.stringify(body));
        expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main" }, cwd }, deps), JSON.stringify(files))
          .toEqual({ owned: SESSION_PREFIX.concept, other: SESSION_PREFIX.shipped });
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
      expect(titlePrefixFor({ variant: "paused", cwd }, deps)).toBe(SESSION_PREFIX.paused);
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
      expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main" }, cwd }, deps))
        .toEqual({ owned: SESSION_PREFIX.concept, other: SESSION_PREFIX.shipped });
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
    for (const p of Object.values(SESSION_PREFIX)) expect(text).toContain(`"${p}"`);
    for (const c of ["Alpha", "Beta", "Stable"]) expect(text).toContain(`"🎊 Released ${c} – "`);
    expect(text).toMatch(/skip silently/);
    expect(text).toMatch(/Desktop app only/);
    // #661: a deferred tool is not an unavailable one — load, then call.
    expect(text).toMatch(/Deferred is not unavailable/);
    expect(text).toContain("select:mcp__ccd_session_mgmt__get_session,mcp__ccd_session_mgmt__set_session_title");
  });

  // The concept finalize ship renders its ship card while the state file is
  // still there: the "closes the concept out" branch is what lets that card
  // end on 🚀 Shipped instead of the compass.
  test("a conditional names the concept, the owner's prefix, the close-out case and the other prefix", () => {
    const text = titleInstruction({ owned: SESSION_PREFIX.concept, other: SESSION_PREFIX.shipped });
    expect(text.startsWith("[SESSION TITLE — DO NOT OUTPUT THIS BLOCK]")).toBe(true);
    expect(text).toContain("concept-active.json");
    expect(text).toMatch(/If THIS session runs that concept/);
    expect(text).toContain(`"${SESSION_PREFIX.concept}" + <stripped title>`);
    expect(text).toMatch(/this turn closes the concept out/);
    expect(text).toContain(`"${SESSION_PREFIX.shipped}" + <stripped title>`);
    expect(text).toMatch(/skip silently/);
  });

  test("a conditional with no other prefix (armed batch) leaves a foreign title alone", () => {
    const text = titleInstruction({ owned: SESSION_PREFIX.concept, other: null });
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
    expect(text).toContain(`${SET} {session_id:"self", title:"📦 Ready – Login fix"}`);
    expect(text).toMatch(/SAME assistant message as the card's show_widget call/);
    expect(text).toMatch(/set_session_title first in the batch/);
    expect(text).not.toContain("mcp__ccd_session_mgmt__get_session");
    expect(text).toContain(`ToolSearch "select:${SET}"`);
    expect(text).toMatch(/skip silently/);
  });

  test("stacked and legacy prefixes go, the title is JSON-escaped", () => {
    const rest = 'Fix "quotes" ' + String.fromCharCode(92) + " path";
    const text = titleInstruction(releasedPrefix("stable"), "⏳ Working – 🚀 Shipping – " + rest);
    expect(text).toContain(`title:${JSON.stringify("🎊 Released Stable – " + rest)}}`);
  });

  test("a title that is already right needs no block at all", () => {
    expect(titleInstruction(SESSION_PREFIX.shipped, "🚀 Shipped – Login")).toBe("");
    expect(titleInstruction("", "Plain title")).toBe("");
    expect(titleInstruction(SESSION_PREFIX.ready, "📦 Ready – ")).toBe("");
  });

  test("an empty prefix strips only — the known stripped title", () => {
    expect(titleInstruction("", "🧪 Test – X")).toContain(`title:"X"}`);
  });

  test("a mode-owned title stays untouched whatever the current title", () => {
    expect(titleInstruction(null, "📥 Batch – X")).toBe("");
  });

  test("an unattributed concept keeps its conditional, with exact titles", () => {
    const text = titleInstruction({ owned: SESSION_PREFIX.concept, other: SESSION_PREFIX.shipped }, "⏳ Page");
    expect(text).toContain(`title:"🧭 Concept – Page"}`);
    expect(text).toContain(`title:"🚀 Shipped – Page"}`);
    expect(text).toMatch(/If THIS session runs that concept/);
    const leave = titleInstruction({ owned: SESSION_PREFIX.concept, other: null }, "🧭 Concept – Page");
    expect(leave).toBe("");
    const half = titleInstruction({ owned: SESSION_PREFIX.concept, other: null }, "⏳ Page");
    expect(half).toContain(`title:"🧭 Concept – Page"}`);
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
