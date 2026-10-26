import { describe, it, expect } from "vitest";
import { parseChannelState, channelLag, channelFields } from "./channel-state.js";

const OUT = [
  "a1\trefs/tags/alpha/v0.9.0", "a2\trefs/tags/alpha/v0.10.0", "a3\trefs/tags/alpha/v0.10.0^{}",
  "a4\trefs/tags/alpha/v0.11.0", "b1\trefs/tags/beta/v0.9.0", "s1\trefs/tags/stable/v0.8.0",
  "s2\trefs/tags/v0.7.0", "x\trefs/tags/random",
].join("\n");

describe("channel-state", () => {
  it("resolves the latest version per channel numerically", () => {
    const s = parseChannelState(OUT);
    expect(s).toMatchObject({ alpha: "0.11.0", beta: "0.9.0", stable: "0.8.0" });
  });

  it("counts lag in versions and (when known) days", () => {
    const f = channelFields(OUT, { now: 10 * 86_400_000, ageOf: (v) => (v === "0.10.0" ? 4 * 86_400_000 : null) });
    expect(f.channels).toEqual({ alpha: "0.11.0", beta: "0.9.0", stable: "0.8.0" });
    expect(f.betaLag).toEqual({ versions: 2, days: 6 });
    expect(f.stableLag.versions).toBe(3);
    expect(f.stableLag.days).toBeNull();
  });

  it("handles empty output and a caught-up channel", () => {
    expect(channelFields("", {}).betaLag).toEqual({ versions: 0, days: null });
    const s = parseChannelState("a\trefs/tags/alpha/v1.0.0\nb\trefs/tags/beta/v1.0.0");
    expect(channelLag(s, "beta")).toEqual({ versions: 0, days: 0 });
    expect(channelLag(s, "stable").versions).toBe(1);
  });
});
