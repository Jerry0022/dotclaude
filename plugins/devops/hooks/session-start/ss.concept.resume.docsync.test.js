import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCronBody, buildBackgroundTasks } from "./ss.concept.resume.js";

// `bridge-server.md` § step 3 is the single source of truth for the cron body
// and the two watchers. This hook necessarily carries a second copy — it has to
// hand the text to a resumed session — and a second copy is exactly how the
// concept skill drifted into issue #276 in the first place.
//
// So the copy is pinned against the source. This already caught one real
// defect: the hook emitted `print(\'true\' ...)` where the doc has bare quotes,
// which is a Python SyntaxError, so every resumed session's backup pickup path
// was dead on arrival.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLDIR = path.join(__dirname, "..", "..", "skills", "concept");
const BRIDGE = fs.readFileSync(path.join(SKILLDIR, "deep-knowledge", "bridge-server.md"), "utf8");

const PORT = 8883;
const STATE_PATH = "C:/proj/.claude/concept-active.json";

describe("the hook's cron copy matches bridge-server.md", () => {
  test("the /pending one-liner is byte-identical to the documented one", () => {
    const documented = BRIDGE
      .split("\n")
      .find(l => l.includes("python -c") && l.includes("/pending") && l.includes("d.get"))
      .replace(/\{port\}/g, String(PORT))
      .trim();
    expect(buildCronBody(PORT)).toContain(documented);
  });

  test("the emitted python snippet is valid python, not backslash-escaped", () => {
    const snippet = buildCronBody(PORT).match(/python -c "([^"]*)"/)[1];
    expect(snippet).not.toContain("\\'");
    expect(snippet).toContain("print('true' if d.get('pending') else 'false')");
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
