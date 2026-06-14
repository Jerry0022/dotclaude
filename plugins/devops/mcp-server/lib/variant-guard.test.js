import { describe, it, expect } from "vitest";
import { correctShipVariant, renderDowngradeNote, DOWNGRADE_NOTE } from "./variant-guard.js";

describe("correctShipVariant", () => {
  it("keeps ship-successful when the merge is proven (pushed + merged)", () => {
    expect(correctShipVariant("ship-successful", { pushed: true, merged: "main" }))
      .toEqual({ variant: "ship-successful", downgraded: false, reason: null });
  });

  it("downgrades ship-successful → ready when state is missing entirely", () => {
    const r = correctShipVariant("ship-successful", undefined);
    expect(r.variant).toBe("ready");
    expect(r.downgraded).toBe(true);
  });

  it("downgrades when pushed but not merged", () => {
    expect(correctShipVariant("ship-successful", { pushed: true }).variant).toBe("ready");
  });

  it("downgrades when merged but not pushed", () => {
    expect(correctShipVariant("ship-successful", { merged: "main" }).variant).toBe("ready");
  });

  it("reports the missing-proof flags in reason", () => {
    expect(correctShipVariant("ship-successful", { pushed: false, merged: false }).reason)
      .toBe("pushed=false, merged=false");
  });

  it("leaves non-ship variants untouched (never downgrades)", () => {
    for (const v of ["ready", "analysis", "ship-blocked", "test", "test-minimal", "fallback"]) {
      expect(correctShipVariant(v, undefined)).toEqual({ variant: v, downgraded: false, reason: null });
    }
  });
});

describe("renderDowngradeNote", () => {
  it("returns the localized note for de and en", () => {
    expect(renderDowngradeNote("de")).toBe(DOWNGRADE_NOTE.de);
    expect(renderDowngradeNote("en")).toBe(DOWNGRADE_NOTE.en);
  });

  it("falls back to de for an unknown language", () => {
    expect(renderDowngradeNote("fr")).toBe(DOWNGRADE_NOTE.de);
  });
});
