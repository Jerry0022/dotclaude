import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { main } = require("./post.concept.title.js");
const { CONCEPT_PREFIX, CONCEPT_WORKING_PREFIX } = require("../lib/session-title.js");

// #930: once the user submits on the concept page, the sidebar must stop
// saying it is their move — on Claude's next tool call, not only when the
// pickup waker's turn gets to Step 5.
let cwd;
const SLUG = "2026-10-28-1200-header";
const store = () => path.join(cwd, ".claude", "concepts", SLUG);

function activate() {
  fs.mkdirSync(store(), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".claude", "concept-active.json"),
    JSON.stringify({ port: 8742, html_path: `docs/concepts/${SLUG}.html`, owner: "abc" }),
  );
}
function writeState({ submitted = true, version = 3, picked_up_at = "", processed_at = "" } = {}) {
  fs.writeFileSync(
    path.join(store(), "state.json"),
    JSON.stringify({ decisions: JSON.stringify({ submitted, action: "iterate" }), version, picked_up_at, processed_at }),
  );
}
const run = (title, tool_name = "Bash") => main({ tool_name, cwd }, { cwd, readTitle: () => title });

beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), "concept-title-")); });
afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

describe("post.concept.title", () => {
  test("a fresh submission flips the waiting prefix to the working one, once", () => {
    activate();
    writeState();
    const out = run(`${CONCEPT_PREFIX}Header`);
    expect(out.context).toContain(JSON.stringify(`${CONCEPT_WORKING_PREFIX}Header`));
    expect(out.context).toContain("set_session_title");
    expect(run(`${CONCEPT_PREFIX}Header`)).toBeNull();
  });

  test("a newer submission is announced again", () => {
    activate();
    writeState({ version: 3 });
    expect(run(`${CONCEPT_PREFIX}Header`)).not.toBeNull();
    writeState({ version: 4 });
    expect(run(`${CONCEPT_PREFIX}Header`)).not.toBeNull();
  });

  test("silent without an active concept or a store", () => {
    expect(run(`${CONCEPT_PREFIX}Header`)).toBeNull();
    activate();
    expect(run(`${CONCEPT_PREFIX}Header`)).toBeNull();
  });

  test("silent when nothing is submitted or Claude already picked it up", () => {
    activate();
    writeState({ submitted: false });
    expect(run(`${CONCEPT_PREFIX}Header`)).toBeNull();
    writeState({ processed_at: "2026-10-28T12:00:00Z" });
    expect(run(`${CONCEPT_PREFIX}Header`)).toBeNull();
  });

  // #956: the waker's /pending=true poll stamps picked_up_at before the wake-up
  // notification turn (no user prompt) makes its first tool call.
  test("fires on the notification turn after a waker pickup (picked_up_at already set)", () => {
    activate();
    writeState({ picked_up_at: "2026-10-28T12:00:00Z" });
    const out = run(`${CONCEPT_PREFIX}Header`);
    expect(out.context).toContain(JSON.stringify(`${CONCEPT_WORKING_PREFIX}Header`));
    expect(run(`${CONCEPT_PREFIX}Header`)).toBeNull();
  });

  test("silent when the title is not on the waiting prefix or unknown, and the version stays unannounced", () => {
    activate();
    writeState();
    expect(run(`${CONCEPT_WORKING_PREFIX}Header`)).toBeNull();
    expect(run(null)).toBeNull();
    expect(run(`${CONCEPT_PREFIX}Header`)).not.toBeNull();
  });

  test("never fires on the session tools themselves", () => {
    activate();
    writeState();
    expect(run(`${CONCEPT_PREFIX}Header`, "mcp__ccd_session_mgmt__set_session_title")).toBeNull();
  });
});
