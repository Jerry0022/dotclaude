import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCronBody, buildBackgroundTasks } from "./ss.concept.resume.js";
import { pendingInstruction, cleanupInstruction } from "../../scripts/concept-tick.js";

// `bridge-server.md` § step 3 is the single source of truth for the cron and
// the two watchers. This hook necessarily carries a second copy — it has to
// hand the text to a resumed session — and a second copy is exactly how the
// concept skill drifted into issue #276 in the first place.
//
// So the copy is pinned against the source. This already caught one real
// defect: the hook emitted `print(\'true\' ...)` where the doc has bare quotes,
// which is a Python SyntaxError, so every resumed session's backup pickup path
// was dead on arrival.
//
// The cron body is no longer a paraphrase of a procedure — the procedure moved
// into `scripts/concept-tick.js` so the cron's card stops filling the whole
// background tasks panel. That makes the pin STRICTER, not looser: the prompt
// is now short enough to compare byte-for-byte in full, and the procedure it
// used to inline is pinned against the script that inherited it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLDIR = path.join(__dirname, "..", "..", "skills", "concept");
const BRIDGE = fs.readFileSync(path.join(SKILLDIR, "deep-knowledge", "bridge-server.md"), "utf8");

const PORT = 8883;
const STATE_PATH = "C:/proj/.claude/concept-active.json";

/** The hook's prompt, normalised back to the doc's placeholder form. */
const emittedCron = () =>
  buildCronBody(PORT, STATE_PATH)
    .replace(/\\/g, "/")
    .replace(/"[^"]*\/scripts\/concept-tick\.js"/, '"{plugin-root}/scripts/concept-tick.js"')
    .replace(/"[^"]*\/\.claude\/concept-active\.json"/, '"{project-root}/.claude/concept-active.json"')
    .replace(new RegExp(String(PORT), "g"), "{port}");

const documentedCron = () =>
  BRIDGE.split("\n")
    .find(l => l.includes("concept-tick.js") && l.includes("Silently run via Bash"))
    .trim();

/** Source with comments removed — prose about a pattern is not a use of it. */
const codeOnly = file =>
  fs.readFileSync(path.join(__dirname, "..", "..", "scripts", file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the hook's cron copy matches bridge-server.md", () => {
  test("the whole prompt is byte-identical to the documented one", () => {
    // Not `toContain` on one line any more — the entire prompt fits in one
    // comparison now, so any drift at all fails here.
    expect(emittedCron()).toBe(documentedCron());
  });

  test("the script the doc names actually exists", () => {
    expect(fs.existsSync(path.join(__dirname, "..", "..", "scripts", "concept-tick.js"))).toBe(true);
  });

  test("the prompt stays small enough to be one card among many", () => {
    // The whole point: Claude Code renders a cron's full prompt as its card in
    // the background tasks panel. The old body was 1128 characters and filled
    // the panel on its own. A ceiling is the only thing that stops the
    // procedure from creeping back in one helpful sentence at a time.
    expect(buildCronBody(PORT, STATE_PATH).length).toBeLessThan(400);
  });

  test("the procedure is NOT inlined in the prompt any more", () => {
    const body = buildCronBody(PORT, STATE_PATH);
    for (const leak of ["python -c", "/decisions", "/heartbeat", "CronDelete", "Step 5"]) {
      expect(body, leak).not.toContain(leak);
    }
  });

  test("the literal `port {port}` the orphan sweep keys off survives", () => {
    // Step (0) sweeps orphaned crons via CronList "every cron whose prompt
    // mentions `port {port}`" when the state file — and with it cron_id — is
    // gone. `--port 8883` alone does not match that phrasing.
    expect(buildCronBody(PORT, STATE_PATH)).toContain(`port ${PORT}`);
    expect(BRIDGE).toContain("mentions `port {port}`");
    expect(cleanupInstruction(PORT, "state file is gone", null)).toContain(`mentions \`port ${PORT}\``);
  });

  test("the doc still warns that the prompt must OPEN with the silence marker", () => {
    expect(BRIDGE).toContain("MUST **start** with `Silently run`");
  });

  test("the state path is passed ABSOLUTE, as the doc mandates", () => {
    expect(buildCronBody(PORT, STATE_PATH)).toContain(`--state "${STATE_PATH}"`);
    expect(BRIDGE).toContain("**`--state` must be ABSOLUTE**");
  });
});

// Everything the prompt used to spell out is now emitted by the script — on the
// ticks that need it, and only then. The doc still documents all of it, so the
// same drift test applies, just against the new owner of the text.
describe("concept-tick.js carries the procedure the prompt gave up", () => {
  test("the pending branch still names every action the doc lists", () => {
    const out = pendingInstruction(PORT, 7);
    for (const action of ["iterate", "implement", "create-issues", "ship", "dispose-concept"]) {
      expect(out, action).toContain(`"${action}"`);
      expect(BRIDGE, action).toContain(`"${action}"`);
    }
  });

  test("the pending branch keeps the ordering and concurrency rules", () => {
    const out = pendingInstruction(PORT, 7);
    expect(out).toContain("/reload");
    expect(out).toContain("/reset");
    expect(out).toMatch(/\/reload[\s\S]*BEFORE the reset/);
    expect(out).toContain("409");
    expect(out).toContain("Zero-prompt invariant");
    expect(out).toContain("Step 5b");
    // Issue #276's actual lesson: the waker must come back before the report.
    expect(out).toMatch(/Re-launch the pickup waker[\s\S]*report the outcome/);
    expect(BRIDGE).toContain("Re-launch the pickup waker immediately after `/reset`");
  });

  test("pending is decided on /pending, never a substring match on /decisions", () => {
    // json.dumps emits `"submitted": true` WITH a space, so a substring test
    // silently misses every submission. Comments are stripped first — the file
    // explains that trap, and explaining it is not falling into it.
    const script = codeOnly("concept-tick.js");
    expect(script).toContain("'/pending'");
    // No quoted `"submitted"` JSON key anywhere — that is the substring test.
    // (The word itself is fine: the 409 branch tells Claude "the user submitted
    // again while you worked".)
    expect(script).not.toMatch(/["']"submitted"/);
    // The verdict comes from parsed JSON and is strict-equal to true, so a
    // stringly "true" or a truthy 1 cannot wake Claude for nothing.
    expect(script).toContain("body.pending !== true");
    expect(BRIDGE).toContain("never** a substring match on `/decisions`");
  });

  test("the cleanup gate offers both the cron_id and the by-port sweep", () => {
    expect(cleanupInstruction(PORT, "concept HTML is gone", "ab12cd34")).toContain("CronDelete the cron with id ab12cd34");
    expect(cleanupInstruction(PORT, "state file is gone", null)).toContain("CronList");
  });
});

// The watchers used to be a `while true; do … sleep 20; done` loop pasted into
// bridge-server.md AND re-emitted by this hook. Four independent defects lived
// in that shape — a relative state path, a launch ordered before the file it
// requires, a GNU-only `\b` in the port guard, and no honest allowed-tools
// grant. They are one script now, so there is nothing left to drift.
describe("the watchers are a script, not a duplicated shell loop", () => {
  const { pulser, waker } = buildBackgroundTasks(PORT, STATE_PATH);

  test("bridge-server.md documents concept-watch.js in both modes", () => {
    expect(BRIDGE).toContain("concept-watch.js");
    expect(BRIDGE).toContain("--mode pulse");
    expect(BRIDGE).toContain("--mode watch");
  });

  test("the script the doc names actually exists", () => {
    const script = path.join(__dirname, "..", "..", "scripts", "concept-watch.js");
    expect(fs.existsSync(script)).toBe(true);
  });

  test("the hook emits the same invocation shape the doc documents", () => {
    for (const [task, mode] of [[pulser, "pulse"], [waker, "watch"]]) {
      expect(task).toMatch(/^node "/);
      expect(task).toContain("concept-watch.js");
      expect(task).toContain(`--mode ${mode}`);
      expect(task).toContain(`--port ${PORT}`);
      expect(task).toContain(`--state "${STATE_PATH}"`);
    }
  });

  test("no inline loop survives in either place", () => {
    for (const task of [pulser, waker]) {
      expect(task).not.toContain("while true");
      expect(task).not.toContain("sleep 20");
    }
    // The doc may still *discuss* the old loop in its rationale, but must not
    // hand one back as an instruction.
    expect(BRIDGE).not.toMatch(/```bash\n\s*fails=0\n\s*while true/);
  });

  test("bridge-server.md still names every exit reason the action table covers", () => {
    for (const reason of ["PENDING_SUBMISSION", "SERVER_DEAD", "STATE_GONE", "PORT_CHANGED"]) {
      expect(BRIDGE, reason).toContain(reason);
    }
  });

  test("bridge-server.md no longer claims the cron covers the re-launch window", () => {
    // It fires only while the REPL is idle, and the window is open precisely
    // when the REPL is busy processing a round.
    expect(BRIDGE).not.toMatch(/backup pickup path during the brief window/);
  });
});
