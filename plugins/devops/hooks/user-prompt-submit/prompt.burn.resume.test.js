/**
 * prompt.burn.resume — after a usage limit stopped a burn:
 *   - a prompt the user typed → ask (Burn abschalten recommended), never burn on silently;
 *   - BURN_RESUME: / AUTONOMOUS_RESUME: → no question, apply the policy chosen up front (F7);
 *   - a week that reset since the start → off, whatever the policy;
 *   - silent everywhere else.
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import hook from "./prompt.burn.resume.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, "prompt.burn.resume.js");
const NOW = Date.parse("2026-09-25T10:00:00.000Z");

const state = (o = {}) => ({
  version: 2, status: "running", sessionId: "S1",
  queue: [{ id: "i1" }], inFlight: [{ id: "p0" }], done: [{ id: "x" }],
  resume: { auto: "continue", autoArmed: true },
  weekResetAt: "2026-09-27T10:00:00.000Z",
  heartbeatAt: new Date(NOW - 5 * 60000).toISOString(),
  ...o,
});
const limited = { limited: true, kind: "session", at: "2026-09-25T09:55:00.000Z" };
const decide = (o) => hook.decide({ prompt: "weiter", state: state(), evidence: { limited: false }, sessionId: "S1", root: "/repo", nowMs: NOW, askedThisSession: false, ...o });

describe("manual nudge after a limit stop", () => {
  test("asks one question — Burn abschalten first and recommended — before anything continues", () => {
    const out = decide({ evidence: limited });
    expect(out).toMatch(/\[burn-resume\]/);
    expect(out).toMatch(/NICHT einfach fort/);
    expect(out).toMatch(/AskUserQuestion/);
    const opts = [...out.matchAll(/^\s+\d\. "([^"]+)"/gm)].map((m) => m[1]);
    expect(opts).toEqual(["Burn abschalten (Recommended)", "Burn fortsetzen", "Run beenden"]);
    expect(out).toMatch(/resumed --trigger=manual --choice=<off\|continue\|end> --session=S1/);
    expect(out).toMatch(/5-Stunden-Limit gestoppt/);
    expect(out).toMatch(/1 gelandet · 1 offen · 1 unklar/);
  });

  test("a paused run counts as stopped too", () => {
    expect(decide({ state: state({ status: "paused", pause: { since: "2026-09-25T09:50:00.000Z" } }) })).toMatch(/pausiert/);
  });

  test("already resumed after that stop → silent", () => {
    expect(decide({ evidence: limited, state: state({ lastResume: { at: "2026-09-25T09:58:00.000Z" } }) })).toBeNull();
  });

  test("no stop, no question: a running burn is left alone", () => {
    expect(decide({})).toBeNull();
  });

  test("machine turns are never asked", () => {
    expect(decide({ evidence: limited, prompt: "<task-notification>\n<status>completed</status>" })).toBeNull();
    expect(decide({ evidence: limited, prompt: "AUTONOMOUS_AUTOSTART: 3-minute confirmation timeout" })).toBeNull();
    expect(decide({ evidence: limited, prompt: "RUN_BACKLOG_AUTOSTART: phase=gate" })).toBeNull();
  });

  test("finished or empty runs are silent", () => {
    expect(decide({ evidence: limited, state: state({ status: "finished" }) })).toBeNull();
    expect(decide({ evidence: limited, state: state({ queue: [], inFlight: [] }) })).toBeNull();
    expect(decide({ evidence: limited, state: null })).toBeNull();
  });
});

describe("automatic resume — the user is away", () => {
  test("BURN_RESUME with policy continue (F7 recommended): no question, continue", () => {
    const out = decide({ prompt: "BURN_RESUME: window reset", state: state({ status: "paused", pause: { since: "2026-09-25T09:50:00.000Z" } }) });
    expect(out).not.toMatch(/AskUserQuestion/);
    expect(out).toMatch(/keine Frage/);
    expect(out).toMatch(/--trigger=auto --choice=continue/);
  });

  test("policy off (F7 'Burn abschalten') is applied as off", () => {
    const out = decide({ prompt: "BURN_RESUME: x", evidence: limited, state: state({ resume: { auto: "off", autoArmed: true } }) });
    expect(out).toMatch(/--choice=off/);
  });

  test("the week reset since the start: off, whatever the policy", () => {
    const out = decide({ prompt: "AUTONOMOUS_RESUME: token-window reset reached", evidence: limited, state: state({ weekResetAt: "2026-09-25T08:00:00.000Z" }) });
    expect(out).toMatch(/--choice=off/);
    expect(out).toMatch(/Woche wurde seit dem Burn-Start zurückgesetzt/);
    expect(out).toMatch(/Step 0\.2 für die ÜBRIGEN Worktrees/);
  });

  test("BURN_RESUME while nothing stopped: explicit no-op", () => {
    expect(decide({ prompt: "BURN_RESUME: x" })).toMatch(/nichts fortzusetzen/);
    expect(decide({ prompt: "AUTONOMOUS_RESUME: x" })).toBeNull();
  });
});

describe("another session opens the worktree of a quiet open run", () => {
  const stale = () => state({ heartbeatAt: new Date(NOW - 45 * 60000).toISOString() });

  test("asks once per session", () => {
    expect(decide({ state: stale(), sessionId: "S2" })).toMatch(/seit über 20 Minuten still/);
    expect(decide({ state: stale(), sessionId: "S2", askedThisSession: true })).toBeNull();
  });

  test("a fresh heartbeat or the owning session: silent", () => {
    expect(decide({ sessionId: "S2" })).toBeNull();
    expect(decide({ state: stale(), sessionId: "S1" })).toBeNull();
  });
});

describe("end to end — the hook process", () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "burn-hook-")); });
  afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

  const runHook = (payload) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: "utf8", cwd: tmp });

  test("reads BURN-STATE.json and the transcript's rate-limit line", () => {
    fs.writeFileSync(path.join(tmp, "BURN-STATE.json"), JSON.stringify(state()));
    const transcript = path.join(tmp, "t.jsonl");
    fs.writeFileSync(transcript, [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "working" }] } }),
      JSON.stringify({ type: "assistant", error: "rate_limit", isApiErrorMessage: true, timestamp: "2026-09-25T09:55:00.000Z", message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your session limit · resets 10:50pm" }] } }),
    ].join("\n"));
    const r = runHook({ prompt: "weiter", cwd: tmp, session_id: `S1-${Date.now()}`, transcript_path: transcript });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Burn abschalten \(Recommended\)/);
    expect(r.stdout).toContain(path.join(tmp, "BURN-STATE.json"));
  });

  test("no state, garbage stdin: exit 0, no output", () => {
    expect(runHook({ prompt: "weiter", cwd: tmp }).stdout).toBe("");
    const r = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8", cwd: tmp });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
