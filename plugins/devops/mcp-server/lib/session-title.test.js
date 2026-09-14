import { describe, test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SESSION_PREFIX,
  VARIANT_TITLE_PREFIX,
  stripTitlePrefix,
  titlePrefixFor,
  titleInstruction,
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
  test("every prefix is emoji-first and ends in ' – '", () => {
    for (const p of Object.values(SESSION_PREFIX)) expect(p).toMatch(/^\S+ [A-Z][a-z]+ – $/u);
  });

  test("blocked carries the ship-blocked card emoji, test the test-card emoji", () => {
    expect(SESSION_PREFIX.blocked.startsWith("⛔")).toBe(true);
    expect(SESSION_PREFIX.test.startsWith("🧪")).toBe(true);
  });
});

describe("stripTitlePrefix", () => {
  test("removes one prefix", () => {
    expect(stripTitlePrefix(SESSION_PREFIX.ready + "Foo")).toBe("Foo");
  });

  test("removes stacked prefixes of any kind", () => {
    expect(stripTitlePrefix(SESSION_PREFIX.shipping + SESSION_PREFIX.test + SESSION_PREFIX.concept + "Foo")).toBe("Foo");
  });

  test("leaves a plain title untouched", () => {
    expect(stripTitlePrefix("Foo – Bar")).toBe("Foo – Bar");
    expect(stripTitlePrefix(undefined)).toBe("");
  });
});

describe("titlePrefixFor", () => {
  test("maps the flagged variants and leaves the rest plain", () => {
    expect(titlePrefixFor({ variant: "test" }, deps)).toBe(SESSION_PREFIX.test);
    expect(titlePrefixFor({ variant: "ready" }, deps)).toBe(SESSION_PREFIX.ready);
    expect(titlePrefixFor({ variant: "ship-blocked" }, deps)).toBe(SESSION_PREFIX.blocked);
    expect(titlePrefixFor({ variant: "aborted" }, deps)).toBe(SESSION_PREFIX.aborted);
    for (const v of ["analysis", "test-minimal", "fallback", "released"]) {
      expect(titlePrefixFor({ variant: v }, deps), v).toBe("");
    }
    expect(Object.keys(VARIANT_TITLE_PREFIX).sort()).toEqual(["aborted", "ready", "ship-blocked", "ship-successful", "test"]);
  });

  test("a final ship lands as Test — the installed build is what gets verified next", () => {
    expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main" } }, deps)).toBe(SESSION_PREFIX.test);
    expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "main", kept: true } }, deps)).toBe(SESSION_PREFIX.test);
    expect(titlePrefixFor({ variant: "ship-successful" }, deps)).toBe(SESSION_PREFIX.test);
  });

  test("an intermediate ship (merged into a feature branch) leaves a plain title", () => {
    expect(titlePrefixFor({ variant: "ship-successful", state: { merged: "feat/video" } }, deps)).toBe("");
  });

  test("pending background work outranks the variant", () => {
    expect(titlePrefixFor({ variant: "ready", pending: [{ name: "qa", kind: "agent" }] }, deps)).toBe(SESSION_PREFIX.pending);
  });

  test("an open concept owns the title — no instruction", () => {
    expect(titlePrefixFor({ variant: "ready", concept: { phase: "waiting" } }, deps)).toBeNull();
  });

  test("a concept-active.json in cwd owns the title even without the concept field", () => {
    const cwd = mkdtempSync(join(tmpdir(), "devops-title-"));
    try {
      mkdirSync(join(cwd, ".claude"));
      writeFileSync(join(cwd, ".claude", "concept-active.json"), JSON.stringify({ port: 4321, html_path: "docs/concepts/x.html" }));
      expect(titlePrefixFor({ variant: "ready", cwd }, deps)).toBeNull();
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
    expect(text).toMatch(/skip silently/);
    expect(text).toMatch(/Desktop app only/);
  });

  test("an empty prefix asks for the stripped title only when something was stripped", () => {
    const text = titleInstruction("");
    expect(text).toMatch(/no prefix/);
    expect(text).toMatch(/only if a prefix was actually removed/);
  });
});
