import { describe, test, expect } from "vitest";
import S from "./title-scheme.js";

const HAIR = String.fromCharCode(0x200A);
const FE0F = String.fromCharCode(0xFE0F);

describe("title-scheme — new grammar", () => {
  test("prefix shape: status, bar, fill before the word, activity, one space", () => {
    // Short word: Ship is 26.98px -> round((69.91 - 26.98) / 1.75) = 25 hair spaces.
    expect(S.prefixOf("aborted-ship")).toBe("🟥 ┃ " + HAIR.repeat(25) + "Ship 🚀 ");
    // Long word: Interrupted is the target width -> no fill.
    expect(S.prefixOf("interrupted")).toBe("👉 ┃ Interrupted ⚡ ");
    // Wider than the target never goes negative.
    expect(S.fillFor("Not deployed")).toBe("");
    expect(S.fillFor("Unknown word")).toBe("");
  });

  test("head and heading carry the same parts without fill", () => {
    expect(S.head("ready").text).toBe("👉 ┃ Ready 📦");
    expect(S.headingOf("ready", "Shippen?")).toBe("👉 ┃ Ready 📦 — Shippen?");
    expect(S.head("released-alpha").text).toBe("🟩 ┃ Alpha 🚀");
    expect(S.head("released-alpha", { mandatory: true }).text).toBe("👉 ┃ Alpha 🚀");
    expect(S.head("paused-restart").text).toBe("🟦 ┃ Restart 🔌");
    expect(S.head("agents").text).toBe("⏳ ┃ Team 🤖");
  });

  test("the generic work prefix is Solo and classifies as work", () => {
    expect(S.WORK_PREFIX).toBe("⏳ ┃ " + HAIR.repeat(24) + "Solo 🤖 ");
    expect(S.classify(S.WORK_PREFIX + "Fix")).toBe("work");
    expect(S.stripPrefixes(S.WORK_PREFIX + "Fix")).toBe("Fix");
  });

  test("withFill turns a fill-less text into the title shape", () => {
    expect(S.withFill("🟩 ┃ Alpha 🚀 Login")).toBe(S.prefixOf("released-alpha") + "Login");
    expect(S.withFill("plain")).toBe("plain");
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

  test("stacked old and new prefixes are stripped together", () => {
    expect(S.stripPrefixes(S.prefixOf("ready") + "👉 📦 Ready – ⏳ Working – Job")).toBe("Job");
    expect(S.stripPrefixes("⏳ 🚀 Shipping – " + S.prefixOf("released-alpha") + "Job")).toBe("Job");
  });

  test("free text after a known prefix stays", () => {
    expect(S.stripPrefixes("⏳ Fix Login – Bug")).toBe("Fix Login – Bug");
    expect(S.stripPrefixes(S.prefixOf("ready") + "Fix Login – Bug")).toBe("Fix Login – Bug");
  });
});
