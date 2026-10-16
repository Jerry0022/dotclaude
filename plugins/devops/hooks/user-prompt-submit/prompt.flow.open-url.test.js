import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handle, renderAck } from "./prompt.flow.open-url.js";

const HOOK = fileURLToPath(new URL("./prompt.flow.open-url.js", import.meta.url));
const URL_ = "http://localhost:8776/docs/concepts/plan.html";
const alive = async () => true;
const dead = async () => false;

/** An opener stand-in that records the URLs it was asked to open. */
function opener(result) {
  const urls = [];
  const open = async (url) => {
    urls.push(url);
    if (result instanceof Error) throw result;
    return result;
  };
  return { open, urls };
}

describe("prompt.flow.open-url", () => {
  test("opens the page and blocks the prompt with an all-clear first line", async () => {
    const { open, urls } = opener(true);
    const res = await handle({ prompt: `Im Standardbrowser öffnen: ${URL_}` }, { open, probe: alive });
    expect(urls).toEqual([URL_]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr.split("\n")[0]).toBe(`[open-url] ✓ Seite im Standardbrowser geöffnet: ${URL_}`);
  });

  test("answers in the prompt's language", async () => {
    const { open } = opener(true);
    const res = await handle({ prompt: `Open in default browser: ${URL_}` }, { open, probe: alive });
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe(renderAck(URL_, "en"));
    expect(res.stderr).toContain("Opened in your default browser");
  });

  // #542: "kostet keinen Turn" was jargon — the owner had to guess that the
  // point is opening the page without spending tokens. The ack now says that
  // the red "blocked" headline is intended and the input never reached Claude.
  test("says in plain words that the block is intended and spends no tokens", () => {
    const de = renderAck(URL_, "de").split("\n")[1];
    expect(de).toContain("„blockiert“ ist gewollt");
    expect(de).toContain("ohne deine Eingabe an Claude zu schicken");
    expect(de).toContain("spart Tokens");
    const en = renderAck(URL_, "en").split("\n")[1];
    expect(en).toContain('"blocked" notice is intended');
    expect(en).toContain("without sending your input to Claude");
    expect(en).toContain("costs no tokens");
    for (const text of [renderAck(URL_, "de"), renderAck(URL_, "en")]) {
      expect(text).not.toMatch(/keinen Turn|no turn/);
    }
  });

  test("reads whichever prompt field the payload carries", async () => {
    for (const key of ["user_message", "message"]) {
      const { open, urls } = opener(true);
      const res = await handle({ [key]: `Im Standardbrowser öffnen: ${URL_}` }, { open, probe: alive });
      expect(res.exitCode, key).toBe(2);
      expect(urls).toEqual([URL_]);
    }
  });

  // A browser that cannot start must not eat the prompt: it passes through
  // and Claude opens the page itself.
  test("lets the prompt through when the browser cannot be started", async () => {
    for (const result of [false, new Error("spawn failed")]) {
      const { open } = opener(result);
      const res = await handle({ prompt: `Im Standardbrowser öffnen: ${URL_}` }, { open, probe: alive });
      expect(res).toEqual({ exitCode: 0, stderr: "" });
    }
  });

  test("ignores every other prompt without opening anything", async () => {
    const { open, urls } = opener(true);
    for (const prompt of [
      "ship",
      `Im Standardbrowser öffnen: ${URL_} bitte`,
      "Im Standardbrowser öffnen: https://example.com/",
      `Warum geht ${URL_} nicht?`,
      "",
    ]) {
      expect(await handle({ prompt }, { open, probe: alive }), prompt).toEqual({ exitCode: 0, stderr: "" });
    }
    expect(await handle({}, { open, probe: alive })).toEqual({ exitCode: 0, stderr: "" });
    expect(urls).toEqual([]);
  });

  // Run as the harness does — only inputs that must NOT open a browser.
  test("as a process: unusable stdin and foreign prompts exit 0 silently", () => {
    for (const input of ["", "{nope", "null", JSON.stringify({ prompt: "ship" })]) {
      const res = spawnSync(process.execPath, [HOOK], { input, encoding: "utf8" });
      expect(res.status, input).toBe(0);
      expect(res.stderr, input).toBe("");
    }
  });

  // #703: a dead page is never opened and the prompt is not swallowed —
  // Claude gets told to bring the server back.
  describe("unreachable page", () => {
    test("does not open, does not block, and tells Claude to start the server", async () => {
      const { open, urls } = opener(true);
      const res = await handle({ prompt: `Im Standardbrowser öffnen: ${URL_}` }, { open, probe: dead, cwd: tmpdir() });
      expect(urls).toEqual([]);
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe("");
      expect(res.context).toContain(URL_);
      expect(res.context).toContain("Start the server");
    });

    test("points a concept URL to the bridge relaunch mandate", async () => {
      const cwd = mkdtempSync(join(tmpdir(), "open-url-"));
      mkdirSync(join(cwd, ".claude"));
      writeFileSync(join(cwd, ".claude", "concept-active.json"),
        JSON.stringify({ port: 8776, html_path: "docs/concepts/plan.html" }));
      const { open } = opener(true);
      const res = await handle({ prompt: `Open in default browser: ${URL_}`, cwd }, { open, probe: dead });
      expect(res.exitCode).toBe(0);
      expect(res.context).toContain("ss.concept.resume");
      expect(res.context).toContain("SAME port");
      expect(res.context).toContain('--html "docs/concepts/plan.html"');
    });

    test("a concept state for another port or page is not a match", async () => {
      const cwd = mkdtempSync(join(tmpdir(), "open-url-"));
      mkdirSync(join(cwd, ".claude"));
      writeFileSync(join(cwd, ".claude", "concept-active.json"),
        JSON.stringify({ port: 9999, html_path: "docs/concepts/plan.html" }));
      const res = await handle({ prompt: `Open in default browser: ${URL_}` }, { open: opener(true).open, probe: dead, cwd });
      expect(res.context).not.toContain("ss.concept.resume");
    });

    // QA on the first cut: handle() returned the context but the process
    // never printed it, so Claude was told nothing.
    test("as a process: a dead loopback page prints the context as hook JSON", () => {
      const cwd = mkdtempSync(join(tmpdir(), "open-url-"));
      const dead = "http://127.0.0.1:1/x.html";
      const res = spawnSync(process.execPath, [HOOK], {
        input: JSON.stringify({ prompt: `Open in default browser: ${dead}`, cwd }),
        encoding: "utf8",
      });
      expect(res.status).toBe(0);
      const out = JSON.parse(res.stdout);
      expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
      expect(out.hookSpecificOutput.additionalContext).toContain(dead);
    });

    test("a probe that throws counts as dead", async () => {
      const { open, urls } = opener(true);
      const res = await handle({ prompt: `Open in default browser: ${URL_}` },
        { open, probe: async () => { throw new Error("x"); }, cwd: tmpdir() });
      expect(urls).toEqual([]);
      expect(res.exitCode).toBe(0);
    });
  });
});
