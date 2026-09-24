import { describe, test, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  isValidHtmlPath,
  isValidState,
  isStale,
  resolveScript,
  buildCronBody,
  buildBackgroundTasks,
  buildResumeInstructions,
} from "./ss.concept.resume.js";
import { isSilent as isSilentTurn } from "../user-prompt-submit/prompt.flow.silent-turn.js";

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

describe("readState — a corpse is pruned, a half-written file is not", () => {
  const HOOK = path.resolve(import.meta.dirname, "ss.concept.resume.js");
  const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..", "..");

  /** Run the hook as a process in a fresh project dir holding `body` as the state file. */
  function runWith(body) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "concept-resume-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "concept-home-"));
    fs.mkdirSync(path.join(home, ".claude"));
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
    fs.mkdirSync(path.join(cwd, ".claude"));
    const file = path.join(cwd, ".claude", "concept-active.json");
    fs.writeFileSync(file, body);
    const r = spawnSync(process.execPath, [HOOK], {
      cwd,
      input: JSON.stringify({ session_id: `vitest-resume-${process.pid}-${Date.now()}`, source: "startup" }),
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, HOME: home, USERPROFILE: home },
      encoding: "utf8",
      timeout: 20_000,
    });
    return { status: r.status, stdout: r.stdout, exists: fs.existsSync(file) };
  }

  test("isValidState mirrors the schema the hook acts on", () => {
    expect(isValidState(STATE)).toBe(true);
    expect(isValidState({ ...STATE, html_path: "C:/Users/x/.claude/devops-concepts/2026-08-16-repo-health.html" })).toBe(false);
    expect(isValidState({ ...STATE, port: "8883" })).toBe(false);
    expect(isValidState({ ...STATE, slug: "bad slug!" })).toBe(false);
    expect(isValidState(null)).toBe(false);
  });

  // The 2026-09-17 corpse: a month-old pre-#284 state file with an absolute
  // html_path. The hook refused it and therefore never pruned it, and the
  // completion card kept reading it as "a concept owns the session title".
  test("a state file that parses but fails the schema is deleted", () => {
    const r = runWith(JSON.stringify({
      port: 8774, html_path: "C:/Users/x/.claude/devops-concepts/2026-08-16-repo-health.html",
      slug: "repo-health", server_pid: null, started_at: "2026-08-16T18:03:20.000Z",
    }));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.exists).toBe(false);
  });

  test("a file that does not parse is left alone — it may be mid-write", () => {
    const r = runWith('{"port": 8774, "html_path": "docs/concepts/');
    expect(r.status).toBe(0);
    expect(r.exists).toBe(true);
  });
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

// The cron prompt IS its card in the background tasks panel, so the procedure
// it used to spell out inline (1128 characters of gate + heartbeat + probe +
// pending branch) now lives in scripts/concept-tick.js. What is left has to
// stay small — and has to keep two phrasings that are easy to "tidy up" into
// a regression.
describe("buildCronBody", () => {
  const STATE_PATH = "C:/proj/.claude/concept-active.json";

  test("delegates the whole tick to concept-tick.js", () => {
    const body = buildCronBody(8883, STATE_PATH);
    expect(body).toContain("concept-tick.js");
    expect(body).toContain("--port 8883");
    expect(body).toContain(`--state "${STATE_PATH}"`);
  });

  test("passes the state path ABSOLUTE", () => {
    // A relative `.claude/concept-active.json` resolves against the cron task's
    // cwd, which is not always the project root — the exact defect the watchers
    // already had to fix.
    expect(buildCronBody(8883)).toMatch(/--state "(?:[a-zA-Z]:[\\/]|\/)/);
  });

  test("carries no endpoint or procedure text any more", () => {
    const body = buildCronBody(8883, STATE_PATH);
    for (const leak of ["/heartbeat", "/pending", "/decisions", "/shutdown", "python -c", "CronDelete"]) {
      expect(body, leak).not.toContain(leak);
    }
  });

  test("stays short enough to be one card among many", () => {
    expect(buildCronBody(8883, STATE_PATH).length).toBeLessThan(400);
  });

  test("OPENS with the silence marker prompt.flow.silent-turn keys off", () => {
    // Not cosmetic. That hook flags a tick as silent only when the prompt
    // *opens* with the marker; a lead-in in front of it makes every tick look
    // like a real user turn, so the completion-card reminder and the stop-hook
    // enforcement fire once a minute for the whole session.
    expect(isSilentTurn(buildCronBody(8883, STATE_PATH))).toBe(true);
  });

  test("resolves the script at run time in the versioned cache layout", () => {
    // A cron outlives a plugin rebuild: an in-session /do-ship writes the new
    // version under a fresh .../devops/<version>/ and deletes the old one, so
    // a baked-in absolute path fails MODULE_NOT_FOUND once a minute after it.
    const cache = path.join("C:", "cache", "dotclaude", "devops", "0.128.0", "hooks", "session-start");
    const out = resolveScript("concept-tick.js", cache);
    expect(out).toContain("ls -d");
    expect(out).toContain("/*/scripts/concept-tick.js");
    // Highest version wins: several version dirs coexist in the cache, and a
    // `head -1` on the lexical listing used to pick the OLDEST one.
    expect(out).toContain("sort -V | tail -1");
    expect(out).not.toContain("head -1");
    // …and still runs SOMETHING if the glob comes up empty.
    expect(out).toMatch(/node "\$\{f:-[^}]*concept-tick\.js\}"/);
  });

  test("a dev checkout has no version dir, so it uses the literal path", () => {
    const dev = path.join("C:", "repo", "plugins", "devops", "hooks", "session-start");
    expect(resolveScript("concept-tick.js", dev)).not.toContain("ls -d");
    expect(resolveScript("concept-tick.js", dev)).toContain("concept-tick.js");
  });

  test("still mentions `port N` literally, for the orphan sweep", () => {
    // Cleanup lists crons and deletes "every cron whose prompt mentions
    // `port {port}`" when the state file, and with it cron_id, is gone.
    expect(buildCronBody(8883, STATE_PATH)).toContain("port 8883");
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

  test("names the waker primary and the cron a sparse backstop (#363)", () => {
    const out = buildResumeInstructions(STATE, "idle");
    expect(out).toMatch(/BACKSTOP cron[\s\S]*CronCreate with cron "\*\/15 \* \* \* \*"/);
    expect(out).not.toContain('cron "* * * * *"');                 // the per-minute cadence must not come back
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
    // The port has to reach all three re-armed watchers, slug or no slug.
    expect(out.match(/--port 9001/g)).toHaveLength(3);
  });
});


// #417 — the owner token in the state file rides on every re-armed watcher
// and the backstop cron, so a resumed session's tick can tell its own file
// from a sibling session's.
describe("owner token (#417)", () => {
  const STATE_PATH = "C:/proj/.claude/concept-active.json";

  test("buildCronBody / buildBackgroundTasks carry --owner when given, and not otherwise", () => {
    expect(buildCronBody(8883, STATE_PATH, "aaaa1111")).toContain('--owner "aaaa1111"');
    expect(buildCronBody(8883, STATE_PATH)).not.toContain("--owner");
    const bg = buildBackgroundTasks(8883, STATE_PATH, "aaaa1111");
    expect(bg.pulser).toContain('--owner "aaaa1111"');
    expect(bg.waker).toContain('--owner "aaaa1111"');
    expect(buildBackgroundTasks(8883, STATE_PATH).pulser).not.toContain("--owner");
  });

  test("isValidState accepts a plain owner token and rejects anything that could not be echoed into a command", () => {
    expect(isValidState({ ...STATE, owner: "aaaa1111" })).toBe(true);
    expect(isValidState({ ...STATE, owner: "sess.1-x_2" })).toBe(true);
    expect(isValidState({ ...STATE })).toBe(true);
    expect(isValidState({ ...STATE, owner: "" })).toBe(false);
    expect(isValidState({ ...STATE, owner: 'a"b' })).toBe(false);
    expect(isValidState({ ...STATE, owner: 42 })).toBe(false);
  });
});
