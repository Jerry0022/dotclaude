import { describe, test, expect } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  OPEN_URL_PREFIX, isLoopbackHttpUrl, parseOpenUrlPrompt, openCommand, openInDefaultBrowser,
} = require("./open-url.js");

describe("isLoopbackHttpUrl", () => {
  test.each([
    "http://localhost:8776/docs/concepts/plan.html",
    "https://localhost/",
    "http://LOCALHOST:3000",
    "http://app.localhost:5173/x",
    "http://127.0.0.1:8080/a?b=1&c=2",
    "http://127.1/",
    "http://127.5.6.7:9/",
    "http://[::1]:3000/",
  ])("loopback: %s", (url) => {
    expect(isLoopbackHttpUrl(url)).toBe(true);
  });

  test.each([
    "https://example.com/",
    "http://192.168.1.5:3000/",
    "http://localhost.evil.com/",
    "http://user:pw@localhost:8776/",
    "file:///C:/x.html",
    "ftp://localhost/",
    "javascript:alert(1)",
    "localhost:8776",
    "",
    "not a url",
  ])("not loopback: %s", (url) => {
    expect(isLoopbackHttpUrl(url)).toBe(false);
  });
});

describe("parseOpenUrlPrompt", () => {
  test("reads the German and the English prompt", () => {
    expect(parseOpenUrlPrompt(`${OPEN_URL_PREFIX.de} http://localhost:8776/docs/concepts/plan.html`))
      .toEqual({ url: "http://localhost:8776/docs/concepts/plan.html", lang: "de" });
    expect(parseOpenUrlPrompt(`${OPEN_URL_PREFIX.en} http://127.0.0.1:5173/`))
      .toEqual({ url: "http://127.0.0.1:5173/", lang: "en" });
  });

  test("tolerates surrounding whitespace and prefix case; normalizes the URL", () => {
    expect(parseOpenUrlPrompt("  im standardbrowser öffnen:   http://LOCALHOST:8776/a  \n"))
      .toEqual({ url: "http://localhost:8776/a", lang: "de" });
    expect(parseOpenUrlPrompt("Im Standardbrowser öffnen:http://localhost:8776/a"))
      .toEqual({ url: "http://localhost:8776/a", lang: "de" });
  });

  test("keeps the query string intact", () => {
    expect(parseOpenUrlPrompt(`${OPEN_URL_PREFIX.de} http://localhost:1/p?x=1&y=2#top`).url)
      .toBe("http://localhost:1/p?x=1&y=2#top");
  });

  // The whole prompt must be the prefix plus ONE loopback URL — a sentence
  // that merely mentions the phrase is the user's, never swallowed.
  test.each([
    "Im Standardbrowser öffnen: http://localhost:1/ geht nicht",
    "Im Standardbrowser öffnen: http://localhost:1/ http://localhost:2/",
    "Im Standardbrowser öffnen: https://example.com/",
    "Im Standardbrowser öffnen: file:///C:/x.html",
    "Im Standardbrowser öffnen:",
    "Im Standardbrowser öffnen: localhost:8776",
    "Bitte im Standardbrowser öffnen: http://localhost:1/",
    "Warum kann ich nicht im Standardbrowser öffnen: http://localhost:1/?",
    "ship",
    "",
  ])("not an open prompt: %j", (text) => {
    expect(parseOpenUrlPrompt(text)).toBeNull();
  });

  test("non-strings are not open prompts", () => {
    expect(parseOpenUrlPrompt(null)).toBeNull();
    expect(parseOpenUrlPrompt(undefined)).toBeNull();
    expect(parseOpenUrlPrompt(42)).toBeNull();
  });
});

describe("openCommand — never through a shell", () => {
  test("Windows hands the URL to the default handler via rundll32, not cmd /c start", () => {
    // `cmd /c start` would read `&` in a query string as a command separator.
    expect(openCommand("http://localhost:1/?a=1&b=2", "win32"))
      .toEqual({ cmd: "rundll32.exe", args: ["url.dll,FileProtocolHandler", "http://localhost:1/?a=1&b=2"] });
  });

  test("macOS uses open, everything else xdg-open", () => {
    expect(openCommand("http://localhost:1/", "darwin")).toEqual({ cmd: "open", args: ["http://localhost:1/"] });
    expect(openCommand("http://localhost:1/", "linux")).toEqual({ cmd: "xdg-open", args: ["http://localhost:1/"] });
  });
});

/** A spawn stand-in: records the call, then emits `event` on the child. */
function fakeSpawn(event) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.unrefCalled = false;
    child.unref = () => { child.unrefCalled = true; };
    calls.push({ cmd, args, opts, child });
    if (event) setImmediate(() => child.emit(event, event === "error" ? new Error("ENOENT") : undefined));
    return child;
  };
  return { spawn, calls };
}

describe("openInDefaultBrowser", () => {
  test("resolves true once the opener started — detached, no stdio, unref'd", async () => {
    const { spawn, calls } = fakeSpawn("spawn");
    await expect(openInDefaultBrowser("http://localhost:8776/a", { spawn, platform: "win32" })).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("rundll32.exe");
    expect(calls[0].args).toEqual(["url.dll,FileProtocolHandler", "http://localhost:8776/a"]);
    expect(calls[0].opts).toMatchObject({ detached: true, stdio: "ignore" });
    expect(calls[0].child.unrefCalled).toBe(true);
  });

  test("resolves false when the opener cannot start", async () => {
    const { spawn } = fakeSpawn("error");
    await expect(openInDefaultBrowser("http://localhost:8776/a", { spawn, platform: "linux" })).resolves.toBe(false);
  });

  test("resolves false when spawn throws", async () => {
    const spawn = () => { throw new Error("EINVAL"); };
    await expect(openInDefaultBrowser("http://localhost:8776/a", { spawn })).resolves.toBe(false);
  });

  test("resolves false when the opener neither starts nor fails in time", async () => {
    const { spawn } = fakeSpawn(null);
    await expect(openInDefaultBrowser("http://localhost:8776/a", { spawn, timeoutMs: 20 })).resolves.toBe(false);
  });

  test("never spawns for a URL that is not loopback", async () => {
    const { spawn, calls } = fakeSpawn("spawn");
    await expect(openInDefaultBrowser("https://example.com/", { spawn })).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });
});
