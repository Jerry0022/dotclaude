import { describe, test, expect } from "vitest";
import {
  CHANNELS,
  parseChannelTag,
  compareVersions,
  visibleChannels,
  latestVisible,
} from "./channels.js";

describe("parseChannelTag", () => {
  test("parses namespaced channel tags", () => {
    expect(parseChannelTag("alpha/v0.113.0")).toEqual({ channel: "alpha", version: "0.113.0" });
    expect(parseChannelTag("beta/v1.2.3")).toEqual({ channel: "beta", version: "1.2.3" });
    expect(parseChannelTag("stable/v10.20.30")).toEqual({ channel: "stable", version: "10.20.30" });
  });

  test("parses bare tags as channel 'bare'", () => {
    expect(parseChannelTag("v0.112.0")).toEqual({ channel: "bare", version: "0.112.0" });
  });

  test("accepts full ref paths", () => {
    expect(parseChannelTag("refs/tags/alpha/v0.113.0")).toEqual({ channel: "alpha", version: "0.113.0" });
    expect(parseChannelTag("refs/tags/v0.112.0")).toEqual({ channel: "bare", version: "0.112.0" });
  });

  test("rejects non-channel tags", () => {
    expect(parseChannelTag("foo/v1.0.0")).toBeNull();
    expect(parseChannelTag("v1.2")).toBeNull();
    expect(parseChannelTag("alpha/v1.2")).toBeNull();
    expect(parseChannelTag("v1.2.3-beta.1")).toBeNull();
    expect(parseChannelTag("release-1.0.0")).toBeNull();
    expect(parseChannelTag("alpha/v0.113.0^{}")).toEqual({ channel: "alpha", version: "0.113.0" });
  });
});

describe("compareVersions", () => {
  test("numeric comparison, not lexicographic", () => {
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.112.0", "0.113.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
  });
});

describe("visibleChannels", () => {
  test("union of own channel and all more-stable channels", () => {
    expect(visibleChannels("alpha")).toEqual(["alpha", "beta", "stable", "bare"]);
    expect(visibleChannels("beta")).toEqual(["beta", "stable", "bare"]);
    expect(visibleChannels("stable")).toEqual(["stable", "bare"]);
  });

  test("unknown pin falls back to stable", () => {
    expect(visibleChannels("nightly")).toEqual(["stable", "bare"]);
  });
});

describe("latestVisible", () => {
  const tags = [
    "v0.111.0",
    "v0.112.0",
    "alpha/v0.113.0",
    "alpha/v0.114.0",
    "beta/v0.113.0",
    "stable/v0.113.0",
    "some-random-tag",
  ];

  test("stable pin ignores alpha/beta tags", () => {
    expect(latestVisible(tags, "stable")).toEqual({ tag: "stable/v0.113.0", version: "0.113.0", channel: "stable" });
  });

  test("alpha pin sees everything — cross-prefix numeric winner", () => {
    expect(latestVisible(tags, "alpha")).toEqual({ tag: "alpha/v0.114.0", version: "0.114.0", channel: "alpha" });
  });

  test("beta pin sees beta+stable+bare but not alpha", () => {
    expect(latestVisible(tags, "beta")).toEqual({ tag: "beta/v0.113.0", version: "0.113.0", channel: "beta" });
  });

  test("cross-prefix: alpha/v0.113.0 > stable/v0.112.0 for alpha pin", () => {
    const t = ["stable/v0.112.0", "alpha/v0.113.0"];
    expect(latestVisible(t, "alpha")).toEqual({ tag: "alpha/v0.113.0", version: "0.113.0", channel: "alpha" });
  });

  test("bare tags count as stable for every pin", () => {
    const t = ["v0.112.0", "alpha/v0.110.0"];
    expect(latestVisible(t, "stable")).toEqual({ tag: "v0.112.0", version: "0.112.0", channel: "bare" });
    expect(latestVisible(t, "alpha")).toEqual({ tag: "v0.112.0", version: "0.112.0", channel: "bare" });
  });

  test("same version in multiple visible channels prefers the more specific (non-bare) tag deterministically", () => {
    const t = ["v0.113.0", "stable/v0.113.0"];
    const r = latestVisible(t, "stable");
    expect(r.version).toBe("0.113.0");
  });

  test("empty or channel-free list returns null", () => {
    expect(latestVisible([], "alpha")).toBeNull();
    expect(latestVisible(["some-random-tag"], "stable")).toBeNull();
  });

  test("CHANNELS constant order", () => {
    expect(CHANNELS).toEqual(["alpha", "beta", "stable"]);
  });
});
