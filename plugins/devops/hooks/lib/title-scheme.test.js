import { describe, test, expect } from "vitest";
import S from "./title-scheme.js";

const HAIR = String.fromCharCode(0x200A);
const FE0F = String.fromCharCode(0xFE0F);

describe("title-scheme — new grammar", () => {
  test("prefix shape: status, bar, word, activity, one space — no fill", () => {
    // The sidebar drops whitespace runs, so a hair-space fill never renders.
    expect(S.prefixOf("aborted-ship")).toBe("🟥 ┃ Ship 🚀 ");
    expect(S.prefixOf("interrupted")).toBe("👉 ┃ Interrupted ⚡ ");
    expect(S.prefixOf("ready")).not.toContain(HAIR);
  });

  test("head and heading carry the same parts", () => {
    expect(S.head("ready").text).toBe("👉 ┃ Ready 📦");
    expect(S.headingOf("ready", "Shippen?")).toBe("👉 Ready 📦 — Shippen?");
    expect(S.head("released-alpha").text).toBe("🟩 ┃ Alpha 🚀");
    expect(S.head("released-alpha", { mandatory: true }).text).toBe("👉 ┃ Alpha 🚀");
    expect(S.head("paused-restart").text).toBe("🟦 ┃ Restart 🔌");
    expect(S.head("agents").text).toBe("⏳ ┃ Team 🤖");
  });

  test("the generic work prefix is Solo and classifies as work", () => {
    expect(S.WORK_PREFIX).toBe("⏳ ┃ Solo 🤖 ");
    expect(S.classify(S.WORK_PREFIX + "Fix")).toBe("work");
    expect(S.stripPrefixes(S.WORK_PREFIX + "Fix")).toBe("Fix");
  });

  test("a 2.0.0 title with its hair-space fill is still recognised", () => {
    expect(S.classify("⏳ ┃ " + HAIR.repeat(24) + "Solo 🤖 Fix")).toBe("work");
    expect(S.stripPrefixes("🟩 ┃ " + HAIR.repeat(19) + "Alpha 🚀 Login")).toBe("Login");
  });

  test("the fill the Desktop app stored as plain spaces is recognised too", () => {
    // Observed 2026-10-21: the app keeps the hair-space fill as U+0020, the
    // heads were missed and stacked one per turn.
    const fill = " ".repeat(25);
    expect(S.classify("⏳ ┃" + fill + "Concept 🧭 Anno")).toBe("process");
    expect(S.stripPrefixes(
      "👉 🧪 Test – ┃ Solo 🤖 ┃" + fill + "Solo 🤖 ┃" + fill + "Solo 🤖 Dritte Ebene funktioniert nicht",
    )).toBe("Dritte Ebene funktioniert nicht");
    expect(S.stripPrefixes("🟩 📋 Analysis – ┃" + fill + "Solo 🤖 Fix")).toBe("Fix");
    expect(S.stripPrefixes("⏳ Fix  Login")).toBe("Fix  Login");
  });
});

describe("title-scheme — tolerant matching", () => {
  test("FE0F and any number of hair spaces still match a new prefix", () => {
    const plain = "👉 ┃ Red tests ⚠️ Fix";
    const variants = [
      plain,
      "👉 ┃ Red tests ⚠ Fix",
      "👉 ┃ " + HAIR.repeat(3) + "Red tests ⚠" + FE0F + " Fix",
      "👉 ┃ " + HAIR.repeat(40) + "Red tests ⚠ Fix",
    ];
    for (const v of variants) {
      expect(S.stripPrefixes(v), JSON.stringify(v)).toBe("Fix");
      expect(S.classify(v), JSON.stringify(v)).toBe("outcome");
    }
  });

  test("a title with a different fill count still classifies", () => {
    expect(S.classify("⏳ ┃ " + HAIR.repeat(2) + "Shipping 🚀 X")).toBe("shipping");
    expect(S.classify("👉 ┃ Concept 🧭 X")).toBe("concept-waiting");
    expect(S.classify("⏳ ┃ Concept 🧭 X")).toBe("process");
    expect(S.classify("🟦 ┃ Batch 📚 X")).toBe("batch");
  });
});

describe("title-scheme — legacy generation", () => {
  test("the previous two-slot prefix is still stripped and classified", () => {
    expect(S.stripPrefixes("👉 📦 Ready – Login")).toBe("Login");
    expect(S.stripPrefixes("🟩 🎊 Released Stable – Login")).toBe("Login");
    expect(S.stripPrefixes("⏸️ 🔄 Restart – Login")).toBe("Login");
    expect(S.stripPrefixes("⏸ 🔄 Restart – Login")).toBe("Login");
    expect(S.stripPrefixes("⏳ Login")).toBe("Login");
    expect(S.classify("⏳ 🚀 Shipping – X")).toBe("shipping");
    expect(S.classify("👉 📥 Batch – X")).toBe("batch");
    expect(S.classify("👉 🧭 Concept – X")).toBe("concept-waiting");
    expect(S.classify("⏳ 🤖 Agents – X")).toBe("process");
    expect(S.classify("🟩 📋 Analysis – X")).toBe("outcome");
    expect(S.classify("⏳ X")).toBe("work");
    expect(S.classify("⏳ Working – X")).toBe("work");
    expect(S.classify("📦 Ready – X")).toBe("outcome");
    expect(S.classify("Plain")).toBe("plain");
  });

  test("a status-less head left by an older plugin's stacking is stripped", () => {
    expect(S.stripPrefixes("⏳ 🧭 Concept – ┃ Shipping 🚀 DevOps backlog")).toBe("DevOps backlog");
    expect(S.stripPrefixes("⏳ 🤖 Agents – ┃ " + " ".repeat(9) + "Shipping 🚀 Dev start")).toBe("Dev start");
    expect(S.stripPrefixes("┃ Solo 🤖 Anno")).toBe("Anno");
    expect(S.classify("┃ Solo 🤖 Anno")).toBe("plain");
    expect(S.stripPrefixes("┃ not a head")).toBe("┃ not a head");
  });

  test("stacked old and new prefixes are stripped together", () => {
    expect(S.stripPrefixes(S.prefixOf("ready") + "👉 📦 Ready – ⏳ Working – Job")).toBe("Job");
    expect(S.stripPrefixes("⏳ 🚀 Shipping – " + S.prefixOf("released-alpha") + "Job")).toBe("Job");
  });

  test("free text after a known prefix stays", () => {
    expect(S.stripPrefixes("⏳ Fix Login – Bug")).toBe("Fix Login – Bug");
    expect(S.stripPrefixes(S.prefixOf("ready") + "Fix Login – Bug")).toBe("Fix Login – Bug");
  });
});
