import { describe, test, expect } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
// channels.js is CommonJS (hooks are standalone CJS scripts) — default interop.
import channels from "./channels.js";

const { CHANNELS, parseChannelTag, compareVersions, visibleChannels, latestVisible, readChannelPin } = channels;

describe("channels (CJS twin — keep in sync with mcp-server/ship/lib/channels.js)", () => {
  test("parseChannelTag", () => {
    expect(parseChannelTag("alpha/v0.113.0")).toEqual({ channel: "alpha", version: "0.113.0" });
    expect(parseChannelTag("v0.112.0")).toEqual({ channel: "bare", version: "0.112.0" });
    expect(parseChannelTag("refs/tags/beta/v1.2.3")).toEqual({ channel: "beta", version: "1.2.3" });
    expect(parseChannelTag("foo/v1.0.0")).toBeNull();
    expect(parseChannelTag("v1.2.3-beta.1")).toBeNull();
  });

  test("compareVersions is numeric", () => {
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareVersions("0.113.0", "0.113.0")).toBe(0);
  });

  test("visibleChannels union", () => {
    expect(visibleChannels("alpha")).toEqual(["alpha", "beta", "stable", "bare"]);
    expect(visibleChannels("stable")).toEqual(["stable", "bare"]);
    expect(visibleChannels("bogus")).toEqual(["stable", "bare"]);
    expect(CHANNELS).toEqual(["alpha", "beta", "stable"]);
  });

  test("latestVisible cross-prefix numeric resolution", () => {
    const tags = ["v0.112.0", "alpha/v0.113.0", "stable/v0.112.0"];
    expect(latestVisible(tags, "alpha")).toEqual({ tag: "alpha/v0.113.0", version: "0.113.0", channel: "alpha" });
    expect(latestVisible(tags, "stable")).toEqual({ tag: "stable/v0.112.0", version: "0.112.0", channel: "stable" });
    expect(latestVisible([], "stable")).toBeNull();
  });
});

describe("readChannelPin", () => {
  function tmpPluginsDir(contents) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "channels-test-"));
    if (contents !== undefined) {
      fs.writeFileSync(path.join(dir, ".channels.json"), contents);
    }
    return dir;
  }

  test("missing sidecar → stable", () => {
    expect(readChannelPin(tmpPluginsDir(), "dotclaude")).toBe("stable");
  });

  test("invalid JSON → stable", () => {
    expect(readChannelPin(tmpPluginsDir("{nope"), "dotclaude")).toBe("stable");
  });

  test("valid pin is returned", () => {
    expect(readChannelPin(tmpPluginsDir('{"dotclaude":"beta"}'), "dotclaude")).toBe("beta");
  });

  test("unknown channel value degrades to stable", () => {
    expect(readChannelPin(tmpPluginsDir('{"dotclaude":"nightly"}'), "dotclaude")).toBe("stable");
  });

  test("other marketplace unaffected", () => {
    expect(readChannelPin(tmpPluginsDir('{"other":"alpha"}'), "dotclaude")).toBe("stable");
  });
});
