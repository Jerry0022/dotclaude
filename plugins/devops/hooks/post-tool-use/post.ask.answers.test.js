import { describe, test, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const { answerChecks } = require("./post.ask.answers.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "post.ask.answers.js");

describe("answerChecks", () => {
  const q = { question: "Welche Issues?", options: [{ label: "#1 a" }, { label: "#2 b" }] };

  test("H-C6: a header-only question is looked up by its header and labelled with it", () => {
    const notes = answerChecks([{ header: "Umfang?", options: [{ label: "Flexibel" }] }], { "Umfang?": "Other" });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('"Umfang?"');
    expect(answerChecks([{ header: "Umfang?", options: [{ label: "Flexibel" }] }], { "Umfang?": "Flexibel" })).toEqual([]);
  });

  test("Something else without text → the exact [answer-check] note", () => {
    const [note] = answerChecks([q], { "Welche Issues?": ["Something else", "#1 a"] });
    expect(note).toBe([
      '[answer-check] "Welche Issues?" was answered with "Something else" and no text.',
      "The user wants something the options did not offer. Ask what, in ONE",
      "AskUserQuestion, before acting on this question's answer.",
    ].join("\n"));
  });

  test.each([["Other"], ["etwas anderes"], ["Sonstiges"], ["SOMETHING ELSE"]])("placeholder %s", (a) => {
    expect(answerChecks([q], { "Welche Issues?": a })).toHaveLength(1);
  });

  test("comma-joined string (older runtimes)", () => {
    expect(answerChecks([q], { "Welche Issues?": "#1 a, Something else" })).toHaveLength(1);
  });

  test("typed Other text, real labels and a placeholder that IS an option pass", () => {
    expect(answerChecks([q], { "Welche Issues?": "bitte #9 auch" })).toEqual([]);
    expect(answerChecks([q], { "Welche Issues?": ["#1 a"] })).toEqual([]);
    const withOther = { question: "Farbe?", options: [{ label: "Rot" }, { label: "Other" }] };
    expect(answerChecks([withOther], { "Farbe?": "Other" })).toEqual([]);
  });

  test("no questions → synthesized from the answer keys", () => {
    expect(answerChecks([], { "X?": "Something else" })).toHaveLength(1);
  });
});

describe("hook", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-ask-"));
  const run = (payload) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: dir, ...payload }), cwd: dir, encoding: "utf8" });

  test("emits additionalContext for an empty Other", () => {
    const res = run({ tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Q?", options: [{ label: "A" }] }] }, tool_response: { answers: { "Q?": "Something else" } } });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(out.hookSpecificOutput.additionalContext).toContain('[answer-check] "Q?"');
  });

  test("silent otherwise, and for other tools / bad input", () => {
    expect(run({ tool_name: "AskUserQuestion", tool_input: {}, tool_response: { answers: { "Q?": "A" } } }).stdout).toBe("");
    expect(run({ tool_name: "Bash", tool_input: {} }).stdout).toBe("");
    const bad = spawnSync(process.execPath, [HOOK], { input: "{", cwd: dir, encoding: "utf8" });
    expect(bad.status).toBe(0);
  });

  test("RT2-R8: a broken run-contract lib never crashes the hook — exits 0 silently", () => {
    // Preload a stub that makes every require() of lib/run-contract throw,
    // simulating a load error. Before the fix this require sat at module top
    // level, OUTSIDE the stdin handler's try/catch, so the process crashed.
    const stub = path.join(dir, "stub-run-contract-throw.js");
    fs.writeFileSync(
      stub,
      [
        "const Module = require('module');",
        "const orig = Module.prototype.require;",
        "Module.prototype.require = function (id) {",
        "  if (typeof id === 'string' && id.replace(/\\\\/g, '/').includes('lib/run-contract')) {",
        "    throw new Error('RT2-R8 stub: run-contract failed to load');",
        "  }",
        "  return orig.apply(this, arguments);",
        "};",
      ].join("\n"),
    );
    const res = spawnSync(process.execPath, ["--require", stub, HOOK], {
      input: JSON.stringify({
        cwd: dir,
        tool_name: "AskUserQuestion",
        tool_input: { questions: [{ question: "Q?", options: [{ label: "A" }] }] },
        tool_response: { answers: { "Q?": "Something else" } },
      }),
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });
});
