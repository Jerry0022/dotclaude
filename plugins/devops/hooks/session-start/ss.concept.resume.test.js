import { describe, test, expect } from "vitest";
import {
  isValidHtmlPath,
  isStale,
  buildCronBody,
  buildBackgroundTasks,
  buildResumeInstructions,
} from "./ss.concept.resume.js";

const STATE = { port: 8883, html_path: "docs/concepts/2026-08-15-x.html", slug: "x" };

describe("isValidHtmlPath — forged state files cannot steer Claude", () => {
  test.each([
    "docs/concepts/a.html",
    "docs/concepts/nested/b.html",
  ])("accepts %s", p => expect(isValidHtmlPath(p)).toBe(true));

  test.each([
    ["absolute posix", "/etc/passwd"],
    ["windows drive", "C:\\Windows\\x.html"],
    ["traversal", "docs/concepts/../../secrets.html"],
    ["outside docs/concepts", "src/app.html"],
    ["not html", "docs/concepts/a.md"],
    ["empty", ""],
    ["not a string", 42],
  ])("rejects %s", (_label, p) => expect(isValidHtmlPath(p)).toBe(false));
});

describe("isStale", () => {
  test("no started_at → never stale", () => {
    expect(isStale({})).toBe(false);
  });
  test("fresh → not stale", () => {
    expect(isStale({ started_at: new Date().toISOString() })).toBe(false);
  });
  test("older than 24h → stale", () => {
    expect(isStale({ started_at: new Date(Date.now() - 25 * 3600_000).toISOString() })).toBe(true);
  });
});

describe("buildCronBody", () => {
  test("carries the port into every endpoint", () => {
    const body = buildCronBody(8883);
    expect(body).toContain("http://localhost:8883/heartbeat");
    expect(body).toContain("http://localhost:8883/pending");
    expect(body).toContain("http://localhost:8883/decisions");
    expect(body).toContain("http://localhost:8883/shutdown");
  });

  test("checks /pending, not a substring match on /decisions", () => {
    // A `contains "submitted":true` test silently misses every submission,
    // because json.dumps emits a space after the colon.
    expect(buildCronBody(8883)).not.toMatch(/"submitted":\s*true/);
  });
});

// Issue #276: background Bash tasks are session-scoped exactly like crons, so a
// restart kills them too. Re-arming only the cron left the resumed session on a
// pickup path that fires solely while the REPL is idle.
describe("buildBackgroundTasks — what a restart must bring back", () => {
  const STATE_PATH = "C:/proj/.claude/concept-active.json";
  const { pulser, waker } = buildBackgroundTasks(8883, STATE_PATH);

  test("both invoke concept-watch.js, one per mode", () => {
    expect(pulser).toContain("concept-watch.js");
    expect(waker).toContain("concept-watch.js");
    expect(pulser).toContain("--mode pulse");
    expect(waker).toContain("--mode watch");
  });

  test("the state path is passed ABSOLUTE", () => {
    // The shell version tested a relative path against the task cwd, which is
    // not always the project root the state file lives in — both watchers then
    // exited STATE_GONE on their first iteration.
    for (const task of [pulser, waker]) {
      expect(task).toContain(`--state "${STATE_PATH}"`);
    }
  });

  test("both carry the port through", () => {
    for (const task of [pulser, waker]) expect(task).toContain("--port 8883");
  });

  test("both start with `node ` — the prefix SKILL.md allowed-tools already grants", () => {
    // A multi-line shell loop has no usable prefix; the only grant that covered
    // it would have been a blanket one.
    expect(pulser.startsWith('node "')).toBe(true);
    expect(waker.startsWith('node "')).toBe(true);
  });

  test("no inline shell loop survives in the hook", () => {
    for (const task of [pulser, waker]) {
      expect(task).not.toContain("while true");
      expect(task).not.toContain("grep -q");
      expect(task).not.toContain("sleep 20");
    }
  });
});

describe("buildResumeInstructions", () => {
  test("re-arms all three watchers, not just the cron", () => {
    const out = buildResumeInstructions(STATE, "idle");
    expect(out).toContain("CronCreate");
    expect(out).toContain("Keepalive pulser");
    expect(out).toContain("pickup waker");
    expect(out).toMatch(/run_in_background: true/);
  });

  test("names the waker primary and the cron backup", () => {
    const out = buildResumeInstructions(STATE, "idle");
    expect(out).toMatch(/BACKUP pickup path[\s\S]*CronCreate/);
    expect(out).toContain("PRIMARY pickup path");
  });

  test("the idle branch no longer promises the cron will pick it up", () => {
    const out = buildResumeInstructions(STATE, "idle");
    expect(out).toContain("the waker picks up the next submission within ~20s");
    expect(out).not.toMatch(/next cron tick.*will pick it up/);
  });

  test("a pending submission is processed before anything is re-armed", () => {
    const out = buildResumeInstructions(STATE, "pending");
    expect(out).toContain("IMMEDIATELY ALSO process the pending submission");
    expect(out).toContain(STATE.html_path);
  });

  test("an inconclusive probe is never reported as idle", () => {
    const out = buildResumeInstructions(STATE, "unknown");
    expect(out).toContain("Do NOT assume idle");
    expect(out).toContain("/decisions");
  });

  test("a slug-less state file still produces usable instructions", () => {
    const out = buildResumeInstructions({ port: 9001, html_path: "docs/concepts/y.html" }, "idle");
    expect(out).toContain("slug ?");
    expect(out).toContain("http://localhost:9001/pending");
  });
});
