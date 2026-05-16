import { describe, test, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_LOCALE,
  SUPPORTED,
  detectFromPrompt,
  getLocale,
  setLocale,
  ensureLocale,
  t,
} from "./locale.js";

const TEST_SESSION_BASE = "vitest-locale-" + process.pid + "-" + Date.now();
// SAFETY: purge MUST only touch files this test suite created. Production
// Claude sessions also write `dotclaude-locale-<uuid>` files; deleting them
// here would silently reset a live user's i18n cache.
const VITEST_PATTERN = "dotclaude-locale-vitest-locale-";

function purgeLocaleFiles() {
  const tmpdir = os.tmpdir();
  try {
    for (const f of fs.readdirSync(tmpdir)) {
      if (f.startsWith(VITEST_PATTERN)) {
        try { fs.unlinkSync(path.join(tmpdir, f)); } catch {}
      }
    }
  } catch {}
}

beforeEach(purgeLocaleFiles);
afterAll(purgeLocaleFiles);

describe("constants", () => {
  test("DEFAULT_LOCALE is 'en'", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  test("SUPPORTED contains en and de", () => {
    expect(SUPPORTED).toEqual(expect.arrayContaining(["en", "de"]));
  });
});

describe("detectFromPrompt", () => {
  test("returns default on empty/null/non-string input", () => {
    expect(detectFromPrompt("")).toBe("en");
    expect(detectFromPrompt(null)).toBe("en");
    expect(detectFromPrompt(undefined)).toBe("en");
    expect(detectFromPrompt(42)).toBe("en");
  });

  test("returns 'de' on umlaut presence", () => {
    expect(detectFromPrompt("Mach das schöner")).toBe("de");
    expect(detectFromPrompt("müssen wir das?")).toBe("de");
    expect(detectFromPrompt("straße")).toBe("de");
  });

  test("returns 'de' on two or more German markers", () => {
    expect(detectFromPrompt("ich kann das nicht")).toBe("de");
    expect(detectFromPrompt("wir haben das schon")).toBe("de");
  });

  test("returns 'en' on a single German marker (not enough signal)", () => {
    // 'ich' alone, no umlaut → 1 hit, below threshold
    expect(detectFromPrompt("ich")).toBe("en");
  });

  test("returns 'en' on pure English prompts", () => {
    expect(detectFromPrompt("please make it work")).toBe("en");
    expect(detectFromPrompt("the quick brown fox jumps over the lazy dog")).toBe("en");
  });

  test("is case-insensitive", () => {
    expect(detectFromPrompt("ICH KANN DAS NICHT")).toBe("de");
  });
});

describe("getLocale + setLocale (round-trip)", () => {
  test("setLocale + getLocale roundtrips", () => {
    const sid = TEST_SESSION_BASE + "-rt-1";
    setLocale(sid, "de");
    expect(getLocale(sid)).toBe("de");
  });

  test("getLocale returns DEFAULT for unknown session (no cache file exists)", () => {
    expect(getLocale(TEST_SESSION_BASE + "-never-set")).toBe("en");
  });

  test("setLocale rejects unsupported values", () => {
    const sid = TEST_SESSION_BASE + "-bad-lang";
    setLocale(sid, "fr"); // not in SUPPORTED
    expect(getLocale(sid)).toBe("en"); // remains default
  });
});

describe("ensureLocale", () => {
  test("first call: detects + caches, returns isFresh:true", () => {
    const sid = TEST_SESSION_BASE + "-fresh-1";
    const res = ensureLocale(sid, "ich kann das nicht");
    expect(res.lang).toBe("de");
    expect(res.isFresh).toBe(true);
  });

  test("subsequent call: returns cached, isFresh:false, ignores new prompt", () => {
    const sid = TEST_SESSION_BASE + "-fresh-2";
    ensureLocale(sid, "ich kann das nicht"); // sets de
    const res = ensureLocale(sid, "now totally English here"); // ignored
    expect(res.lang).toBe("de");
    expect(res.isFresh).toBe(false);
  });
});

describe("t (translation lookup)", () => {
  const DICT = {
    en: { greeting: "Hello", farewell: "Bye" },
    de: { greeting: "Hallo" },
  };

  test("returns translation when present in target lang", () => {
    expect(t("greeting", "de", DICT)).toBe("Hallo");
    expect(t("greeting", "en", DICT)).toBe("Hello");
  });

  test("falls back to en dict when lang bucket missing entirely", () => {
    expect(t("greeting", "fr", DICT)).toBe("Hello");
  });

  test("returns the key when found in neither lang nor en", () => {
    expect(t("totally_missing", "de", DICT)).toBe("totally_missing");
  });

  test("returns the key when key exists in en but not in target lang (no per-key en fallback)", () => {
    // The current implementation only falls back to en when the entire `lang`
    // bucket is missing — not per-key. Document that behavior.
    expect(t("farewell", "de", DICT)).toBe("farewell");
  });

  test("handles null/empty dict gracefully", () => {
    expect(t("key", "de", null)).toBe("key");
    expect(t("key", "de", {})).toBe("key");
  });
});
