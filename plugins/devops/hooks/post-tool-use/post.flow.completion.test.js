import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "post.flow.completion.js");

// Build a temp project whose settings enable the plugin, so plugin-guard does
// not short-circuit the hook before it emits the card instruction.
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "completion-flow-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  // Private tmpdir: the hook keeps once-per-session state as a flag file in
  // `os.tmpdir()`, which honours TMPDIR/TEMP/TMP. Sharing the system tmpdir
  // with every other hook test lets a foreign flag suppress this hook's
  // output. Same isolation as pre.tokens.guard.bash.test.js.
  fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
  return dir;
}

/**
 * What the model reads from one hook run: the additionalContext of the JSON
 * envelope. Plain (non-JSON) stdout would never reach the model, so it comes
 * back as-is and fails the channel tests below.
 */
function runHook(dir, sid, toolName = "Read", extra = {}, envExtra) {
  const raw = runHookRaw(dir, sid, toolName, extra, envExtra);
  if (!raw) return "";
  try {
    const out = JSON.parse(raw);
    return (out && out.hookSpecificOutput && out.hookSpecificOutput.additionalContext) || raw;
  } catch {
    return raw;
  }
}

function runHookRaw(dir, sid, toolName = "Read", extra = {}, envExtra = { DOTCLAUDE_CARD_HARD_STOP: "0" }) {
  // The full suite runs 60+ files in parallel; on a loaded machine spawnSync
  // can fail to start the child at all (status null, res.error set), and the
  // hook's stdout then comes back empty — which reads as "the hook emitted no
  // instruction" and fails the assertion for a reason that has nothing to do
  // with the hook. Retry only that case; never retry a child that actually
  // ran, or a genuinely missing instruction would be masked.
  const tmp = path.join(dir, ".tmp");
  for (let attempt = 0; ; attempt++) {
    const res = spawnSync(process.execPath, [HOOK], {
      cwd: dir,
      input: JSON.stringify({
        tool_name: toolName,
        tool_input: { file_path: path.join(dir, "a.js") },
        session_id: sid,
        cwd: dir,
        ...extra,
      }),
      encoding: "utf8",
      // The card widget runs the real Stop hooks before it ends the turn
      // (lib/card-turn-end.js) — off by default here; the hard-stop tests
      // below turn it on against a fake plugin root.
      env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, ...envExtra },
    });
    if (res.status !== null || attempt >= 3) {
      if (res.status === null) {
        throw new Error(`hook never started after ${attempt + 1} attempts: ${res.error}`);
      }
      return res.stdout || "";
    }
  }
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// The delivery track (PR → Ship → Promote) and the released variant shipped in
// #266/#267, but renderDelivery only fires when the optional `delivery` input is
// passed. That input was instructed ONLY inside skills/ship and skills/promote,
// so every card outside those two pipelines silently dropped the track — the
// feature was built, merged, installed, and never seen. These tests pin the
// instruction that closes that gap.
describe("post.flow.completion — completion-card instruction completeness", () => {
  test("names the `delivery` field, so the pipeline track survives outside /do-ship", () => {
    const dir = project();
    // The session id must not itself contain "delivery" — it is echoed into the
    // instruction and would make this assertion pass for the wrong reason.
    const out = runHook(dir, "s-track");
    expect(out).toContain("COMPLETION CARD");
    expect(out).toContain("delivery");
    cleanup(dir);
  });

  // Same gap, same root cause: a card input the renderer honours but nothing
  // ever asks for. `cwd` decides whether PR/commit/branch are clickable links
  // or dead text; `userFinalTest` carries the manual last-mile steps.
  test("names `cwd` and `userFinalTest`, the other renderer inputs nothing asked for", () => {
    const dir = project();
    const out = runHook(dir, "s-inputs");
    expect(out).toContain("cwd:");
    expect(out).toContain("userFinalTest");
    cleanup(dir);
  });

  test("scopes `delivery` to turns that reached a pipeline stage, not every card", () => {
    const dir = project();
    const out = runHook(dir, "s-track-scope");
    // An unconditional instruction would render three empty ⚪ nodes on routine
    // cards. The instruction must key off an actual PR / ship / promote.
    const deliveryLine = out.split("\n").find(l => l.includes("delivery"));
    expect(deliveryLine).toBeTruthy();
    expect(deliveryLine.toLowerCase()).toMatch(/\bpr\b/);
    cleanup(dir);
  });

  // The private tmpdir above is the whole reason this suite is deterministic,
  // and nothing else would notice if it were removed — the tests would simply
  // go back to passing or failing depending on what else touched os.tmpdir().
  //
  // Reproduces the exact leak. The hook reads session state through
  // readSessionFile(), which falls back to ANY file with a matching prefix
  // younger than 2h when the exact session_id misses. So a marker belonging to
  // a different session — another test, an earlier run, or a real Claude
  // session on this machine — used to make the hook exit before printing
  // anything. Planting one in the real shared tmpdir must now change nothing.
  test("a foreign session's silent-turn marker cannot silence this hook", () => {
    const dir = project();
    const foreign = path.join(
      os.tmpdir(),
      "dotclaude-devops-silent-turn-foreign-session-fixture"
    );
    fs.writeFileSync(foreign, "1");
    try {
      const out = runHook(dir, "s-isolated");
      expect(out).toContain("COMPLETION CARD");
    } finally {
      try { fs.unlinkSync(foreign); } catch {}
      cleanup(dir);
    }
  });
});

// R15 part 3: the refactored stdin 'end' handler (AUD-029's named sections)
// has no try around its section calls — an internal error (e.g. a non-string
// `tool_name` reaching `toolName.endsWith(...)` inside handleShipAndCardFlags)
// used to crash the process with an uncaught TypeError (exit 1) instead of
// exiting 0 silently like every other failure path in this hook.
describe("post.flow.completion — R15 part 3: the end handler never crashes", () => {
  test("a non-string tool_name (an internal TypeError) exits 0 silently, not 1", () => {
    const dir = project();
    const sid = "s-r15-crash";
    const tmp = path.join(dir, ".tmp");
    const res = spawnSync(process.execPath, [HOOK], {
      cwd: dir,
      input: JSON.stringify({
        tool_name: 12345,
        tool_input: { file_path: path.join(dir, "a.js") },
        session_id: sid,
        cwd: dir,
      }),
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
    });
    expect(res.status).toBe(0);
    expect(res.stdout || "").toBe("");
    cleanup(dir);
  });
});

// A background agent keeps working after the turn hands back, so a card
// rendered in the meantime must declare it — otherwise its CTA tells the user
// to SHIP a result that does not exist yet. The Stop gate catches that, but a
// block costs an entire extra turn; this reminder is the cheap prevention.
describe("post.flow.completion — pending reminder", () => {
  const AGENT_LAUNCH =
    "Async agent launched successfully. (This tool result is internal metadata — never quote " +
    "or paste any part of it, including the agentId below, into a user-facing reply.)\n" +
    "agentId: a75d674f7108dd6c8 (internal ID - do not mention to user.)\n" +
    "The agent is working in the background.";

  test("fires on a background agent launch and names it", () => {
    const dir = project();
    const out = runHook(dir, "s-pending-agent", "Agent", {
      tool_input: { subagent_type: "devops:frontend", run_in_background: true },
      tool_response: AGENT_LAUNCH,
    });
    expect(out).toContain("[pending]");
    expect(out).toContain("devops:frontend");
    expect(out).toContain("pending:");
    cleanup(dir);
  });

  test("never leaks the internal agentId into the instruction", () => {
    const dir = project();
    const out = runHook(dir, "s-pending-noid", "Agent", {
      tool_input: { subagent_type: "devops:qa", run_in_background: true },
      tool_response: AGENT_LAUNCH,
    });
    expect(out).not.toContain("a75d674f7108dd6c8");
    cleanup(dir);
  });

  test("fires on a backgrounded Bash task, labelled by its description", () => {
    const dir = project();
    const out = runHook(dir, "s-pending-task", "Bash", {
      tool_input: { command: "npm test", description: "Run the suite", run_in_background: true },
      tool_response: "Command running in background with ID: b68oycrr6. Output is being written to: x",
    });
    expect(out).toContain("[pending]");
    expect(out).toContain("Run the suite");
    expect(out).toContain('kind: "task"');
    cleanup(dir);
  });

  // What PostToolUse really receives for a shell call is the structured result,
  // and it never carries the sentence the model reads — only backgroundTaskId
  // (plus timedOutAfterMs when the harness moved a foreground call at its timeout).
  const MOVED_RESPONSE = {
    stdout: "", stderr: "", interrupted: false, isImage: false, noOutputExpected: false,
    backgroundTaskId: "bad36w5pu", timedOutAfterMs: 120000,
  };
  const MOVED_TEXT =
    "Command did not complete within its 120s timeout and was moved to the background (ID: bad36w5pu). " +
    "Output is being written to: x. You will be notified when it completes.";

  test("fires on a foreground Bash call moved to the background at its timeout", () => {
    const dir = project();
    const out = runHook(dir, "s-pending-moved", "Bash", {
      tool_input: { command: "npm run build", description: "Build the bundle" },
      tool_response: MOVED_RESPONSE,
    });
    expect(out).toContain("[pending]");
    expect(out).toContain("Build the bundle");
    expect(out).toContain('kind: "task"');
    expect(out).not.toContain("bad36w5pu");
    cleanup(dir);
  });

  test("reads the structured result of a run_in_background launch too, and PowerShell's", () => {
    const dir = project();
    for (const [tool, response] of [
      ["Bash", { stdout: "", stderr: "", interrupted: false, isImage: false, backgroundTaskId: "b68oycrr6" }],
      ["PowerShell", MOVED_RESPONSE],
    ]) {
      const out = runHook(dir, `s-pending-structured-${tool}`, tool, {
        tool_input: { command: "npm test", description: "Run the suite" },
        tool_response: response,
      });
      expect(out).toContain("[pending]");
      expect(out).toContain("Run the suite");
    }
    cleanup(dir);
  });

  test("the timeout sentence as a plain-string response fires too", () => {
    const dir = project();
    const out = runHook(dir, "s-pending-moved-text", "Bash", {
      tool_input: { command: "npm run build", description: "Build the bundle" },
      tool_response: MOVED_TEXT,
    });
    expect(out).toContain("[pending]");
    cleanup(dir);
  });

  test("stays quiet when a command merely prints the sentence, or another tool returns it", () => {
    const dir = project();
    const printed = runHook(dir, "s-pending-printed", "Bash", {
      tool_input: { command: "grep -rh moved ~/.claude/projects", description: "Sample results" },
      tool_response: { stdout: "s.jsonl:143:" + MOVED_TEXT, stderr: "", interrupted: false, isImage: false },
    });
    expect(printed).not.toContain("[pending]");
    const read = runHook(dir, "s-pending-read", "Read", { tool_response: MOVED_TEXT });
    expect(read).not.toContain("[pending]");
    cleanup(dir);
  });

  test("stays quiet for an ordinary tool call", () => {
    const dir = project();
    const out = runHook(dir, "s-pending-none", "Read", { tool_response: "file contents" });
    expect(out).toContain("COMPLETION CARD");
    expect(out).not.toContain("[pending]");
    cleanup(dir);
  });

  test("stays quiet for a foreground agent — it has already returned", () => {
    const dir = project();
    const out = runHook(dir, "s-pending-fg", "Agent", {
      tool_input: { subagent_type: "devops:qa", run_in_background: false },
      tool_response: "Here is the review: everything looks fine.",
    });
    expect(out).not.toContain("[pending]");
    cleanup(dir);
  });
});

// PostToolUse receives each tool's STRUCTURED result, never the launch sentence
// the model reads (verified live 2026-09-25, shapes from every recorded result
// in the local transcripts). The old text match on JSON.stringify(tool_response)
// never fired for a real agent or workflow launch — and did fire once for a
// foreground agent whose prompt quoted the sentence.
describe("post.flow.completion — launches are read from the structured tool_response", () => {
  const ASYNC_AGENT = {
    isAsync: true, status: "async_launched", agentId: "a3a8dbef8ee890dbf",
    description: "Review the diff", resolvedModel: "claude-sonnet-5", prompt: "Review the diff.",
    outputFile: "C:\\Temp\\tasks\\a3a8dbef8ee890dbf.output", canReadOutputFile: true,
  };
  const FOREGROUND_AGENT = {
    status: "completed", agentId: "a3a8dbef8ee890dbf",
    content: [{ type: "text", text: "The diff is fine." }], totalDurationMs: 1200,
    prompt: "Quote this: Async agent launched successfully. Workflow launched in background.",
  };
  const WORKFLOW = {
    status: "async_launched", taskId: "wb74fu8mr", taskType: "local_workflow",
    workflowName: "verify-spec", runId: "wf_690f6b46-9b3", summary: "Verify every primitive the spec depends on",
    transcriptDir: "C:\\Users\\x\\.claude\\projects\\p\\s\\subagents\\workflows\\wf_690f6b46-9b3",
  };

  test("an async Agent launch fires [pending], named by its type, never by its id", () => {
    const dir = project();
    const out = runHook(dir, "s-struct-agent", "Agent", {
      tool_input: { subagent_type: "devops:qa", description: "Review the diff", run_in_background: true },
      tool_response: ASYNC_AGENT,
    });
    expect(out).toContain("[pending] Background agent started: devops:qa");
    expect(out).toContain('kind: "agent"');
    expect(out).not.toContain("a3a8dbef8ee890dbf");
    cleanup(dir);
  });

  test("a foreground agent stays quiet — even when its prompt quotes the launch sentences", () => {
    const dir = project();
    const out = runHook(dir, "s-struct-fg", "Agent", {
      tool_input: { subagent_type: "devops:qa", description: "Review the diff" },
      tool_response: FOREGROUND_AGENT,
    });
    expect(out).toContain("COMPLETION CARD");
    expect(out).not.toContain("[pending]");
    cleanup(dir);
  });

  test("a Workflow run fires [pending] under the name its result carries", () => {
    const dir = project();
    const out = runHook(dir, "s-struct-wf", "Workflow", {
      tool_input: { script: "export const meta = {\n  name: 'older-name',\n};" },
      tool_response: WORKFLOW,
    });
    expect(out).toContain("[pending] Background workflow started: verify-spec");
    expect(out).toContain('kind: "workflow"');
    cleanup(dir);
  });

  test("a launch shape reported by a tool that cannot launch that kind stays quiet", () => {
    const dir = project();
    for (const [tool, response] of [["Bash", ASYNC_AGENT], ["Agent", WORKFLOW], ["Read", { backgroundTaskId: "bb3oqentv" }]]) {
      const out = runHook(dir, `s-struct-bound-${tool}`, tool, { tool_response: response });
      expect(out).not.toContain("[pending]");
    }
    cleanup(dir);
  });
});

// A PostToolUse hook reaches the model only through
// hookSpecificOutput.additionalContext — its plain stdout lands in the
// transcript as `hook_success` and nowhere else. Verified live 2026-09-25 in
// the Desktop app and the CLI: a JSON marker arrived, a plain one did not.
// Delivered, every word stays in the context, so the hook says only what
// changes something.
describe("post.flow.completion — reaches the model, and only when it changes something", () => {
  const flag = (dir, name, sid) => path.join(dir, ".tmp", `dotclaude-devops-${name}-${sid}`);
  const envelope = (raw) => {
    const out = JSON.parse(raw);
    expect(Object.keys(out)).toEqual(["hookSpecificOutput"]);
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    return out.hookSpecificOutput.additionalContext;
  };
  const RENDER = "mcp__plugin_devops_dotclaude-completion__render_completion_card";

  test("stdout is one additionalContext envelope, never plain text", () => {
    const dir = project();
    expect(envelope(runHookRaw(dir, "s-env"))).toContain("COMPLETION CARD");
    expect(envelope(runHookRaw(dir, "s-env-render", RENDER, { tool_input: { variant: "ready" } })))
      .toContain("Card rendered");
    expect(envelope(runHookRaw(dir, "s-env-widget", "mcp__visualize__show_widget", {
      tool_input: { title: "completion_card_body" },
    }))).toContain("Card shown");
    cleanup(dir);
  });

  test("the card contract rides on the turn's first call; later calls say nothing", () => {
    const dir = project();
    const sid = "s-gate-turn";
    expect(runHook(dir, sid, "Read")).toContain("COMPLETION CARD");
    expect(runHookRaw(dir, sid, "Grep")).toBe("");
    expect(runHookRaw(dir, sid, "Bash", { tool_input: { command: "ls" }, tool_response: { stdout: "a" } })).toBe("");
    cleanup(dir);
  });

  test("a new turn — stop.flow.guard cleared the per-turn flag — gets the contract again", () => {
    const dir = project();
    const sid = "s-gate-next";
    runHook(dir, sid, "Read");
    expect(runHookRaw(dir, sid, "Read")).toBe("");
    fs.rmSync(flag(dir, "work-happened", sid));
    expect(runHook(dir, sid, "Read")).toContain("COMPLETION CARD");
    cleanup(dir);
  });

  test("a background launch later in the turn sends [pending] without repeating the contract", () => {
    const dir = project();
    const sid = "s-gate-launch";
    runHook(dir, sid, "Read");
    const out = runHook(dir, sid, "Bash", {
      tool_input: { command: "npm test", description: "Run the suite", run_in_background: true },
      tool_response: { stdout: "", stderr: "", interrupted: false, isImage: false, backgroundTaskId: "b68oycrr6" },
    });
    expect(out).toContain("[pending] Background task started: Run the suite");
    expect(out).not.toContain("COMPLETION CARD");
    cleanup(dir);
  });

  test("the first code edit brings [test-autonomy] once", () => {
    const dir = project();
    const sid = "s-gate-edit1";
    fs.writeFileSync(flag(dir, "work-happened", sid), "Read");
    expect(runHook(dir, sid, "Edit")).toContain("[test-autonomy]");
    expect(runHookRaw(dir, sid, "Read")).toBe("");
    cleanup(dir);
  });

  test("the 5th code edit brings the ship nudge and [desktop-testing]; the 6th does not", () => {
    const dir = project();
    const sid = "s-gate-edit5";
    fs.writeFileSync(flag(dir, "work-happened", sid), "Read");
    fs.writeFileSync(flag(dir, "edits", sid), "4");
    const fifth = runHook(dir, sid, "Edit");
    expect(fifth).toContain("SHIP: 5 code edits");
    expect(fifth).toContain("[desktop-testing]");
    const sixth = runHook(dir, sid, "Edit");
    expect(sixth).not.toContain("[desktop-testing]");
    expect(sixth).not.toContain("SHIP:");
    cleanup(dir);
  });

  test("tracked issues come with the contract, not on every call", () => {
    const dir = project();
    const sid = "s-gate-issues";
    fs.writeFileSync(flag(dir, "tracked-issues", sid), "[42]");
    expect(runHook(dir, sid, "Read")).toContain("[issue-status] Tracked issues this session: #42");
    expect(runHookRaw(dir, sid, "Read")).toBe("");
    cleanup(dir);
  });

  // The list drives GitHub writes (board status, issue comments). The glob
  // fallback handed a fresh session the newest list of ANY session: on
  // 2026-09-26 a Q&A session with no issue work was told to move #530, #409,
  // #431 and #469 to Todo and comment on them.
  test("another session's tracked issues never reach this session's contract", () => {
    const dir = project();
    const sid = "s-issues-own";
    fs.writeFileSync(flag(dir, "tracked-issues", "s-issues-foreign"), "[530]");
    const fresh = runHook(dir, sid, "Read");
    expect(fresh).toContain("COMPLETION CARD");
    expect(fresh).not.toContain("[issue-status]");
    // Its own list still arrives, and only that one.
    fs.rmSync(flag(dir, "work-happened", sid));
    fs.writeFileSync(flag(dir, "tracked-issues", sid), "[42]");
    const own = runHook(dir, sid, "Read");
    expect(own).toContain("[issue-status] Tracked issues this session: #42");
    expect(own).not.toContain("#530");
    cleanup(dir);
  });

  // #540: without a session id the exact read would still hit the one
  // `…-unknown` file every id-less session shares.
  test("a session without an id never gets the shared list", () => {
    const dir = project();
    fs.writeFileSync(flag(dir, "tracked-issues", "unknown"), "[530]");
    const out = runHook(dir, undefined, "Read");
    expect(out).toContain("COMPLETION CARD");
    expect(out).not.toContain("[issue-status]");
    cleanup(dir);
  });

  // Its own list is no work order either: prompt.issue.detect tracks every #N
  // a prompt names, including one it only cites. Without a way out, each of
  // them was owed a board move and a comment — the same foreign-issue writes.
  test("an issue the session only cited is left untouched before any write", () => {
    const dir = project();
    const sid = "s-issues-cited";
    fs.writeFileSync(flag(dir, "tracked-issues", sid), '["290"]');
    const out = runHook(dir, sid, "Read");
    expect(out).toContain("[issue-status] Tracked issues this session: #290");
    expect(out).toContain("Did this session work on it?");
    const untouched = out.indexOf("leave it untouched — no status change, no comment");
    expect(untouched).toBeGreaterThan(-1);
    expect(untouched).toBeLessThan(out.indexOf("gh issue view"));
    expect(untouched).toBeLessThan(out.indexOf('"Done"'));
    cleanup(dir);
  });

  test("a running /auto-guide loop gets a waiver instead of the contract (#526)", () => {
    const dir = project();
    const marker = path.join(dir, ".claude", "auto-guide-active.json");
    fs.writeFileSync(marker, JSON.stringify({ ts: Date.now() }));
    fs.writeFileSync(flag(dir, "tracked-issues", "s-guide"), "[42]");
    const out = runHook(dir, "s-guide", "mcp__claude-in-chrome__javascript_tool");
    expect(out).toContain("[auto-guide] A guide run is active");
    expect(out).not.toContain("COMPLETION CARD");
    expect(out).not.toContain("[issue-status]");
    // A marker past its TTL (a guide that crashed mid-loop) waives nothing.
    fs.writeFileSync(marker, JSON.stringify({ ts: Date.now() - 31 * 60 * 1000 }));
    const stale = runHook(dir, "s-guide-stale", "Read");
    expect(stale).toContain("COMPLETION CARD");
    expect(stale).not.toContain("[auto-guide]");
    cleanup(dir);
  });

  test("a call after this turn's card still warns against a second card", () => {
    const dir = project();
    const sid = "s-gate-after";
    fs.writeFileSync(flag(dir, "work-happened", sid), "render");
    fs.writeFileSync(flag(dir, "card-rendered", sid), "t");
    const out = runHook(dir, sid, "mcp__ccd_session_mgmt__set_session_title");
    expect(out).toContain("already rendered this turn");
    expect(out).not.toContain("COMPLETION CARD");
    cleanup(dir);
  });
});

// The concept bridge's own background tasks (server, keepalive pulser, pickup
// waker) run for the whole concept and never yield a result. Flagging them as
// `pending` produced cards that said "3 Tasks laufen — ich MELDE mich" while the
// only true statement was "waiting for your decisions". The hook now routes
// them to the `concept` field instead.
describe("post.flow.completion — concept bridge infrastructure is not pending", () => {
  const BG = "Command running in background with ID: b68oycrr6. Output is being written to: x";

  test("the bridge server launch asks for `concept`, not `pending`", () => {
    const dir = project();
    const out = runHook(dir, "s-concept-server", "Bash", {
      tool_input: {
        command: 'python "$PLUGIN_ROOT" 8840 "C:/repo" --html "docs/concepts/x.html"',
        description: "Start the concept bridge server on port 8840",
        run_in_background: true,
      },
      tool_response: BG,
    });
    expect(out).toContain("[concept]");
    expect(out).toContain("concept: { phase:");
    expect(out).not.toContain("[pending]");
    cleanup(dir);
  });

  test("the keepalive pulser is recognized by its script even with a bland description", () => {
    const dir = project();
    const out = runHook(dir, "s-concept-pulser", "Bash", {
      tool_input: {
        command: 'node "$(ls -d ~/.claude/plugins/cache/dotclaude/devops/*/scripts/concept-watch.js | sort -V | tail -1)" --mode pulse --port 8840 --state "C:/repo/.claude/concept-active.json"',
        description: "Background poller",
        run_in_background: true,
      },
      tool_response: BG,
    });
    expect(out).toContain("[concept]");
    expect(out).not.toContain("[pending]");
    cleanup(dir);
  });

  test("an ordinary background task still gets the pending reminder", () => {
    const dir = project();
    const out = runHook(dir, "s-concept-other", "Bash", {
      tool_input: { command: "npm test", description: "Run the suite", run_in_background: true },
      tool_response: BG,
    });
    expect(out).toContain("[pending]");
    expect(out).not.toContain("[concept]");
    cleanup(dir);
  });
});

// #409 — `python patch.py && npm run test:gate && git commit …` that fails in
// patch.py exits 1 and never reaches the runner. The command string matches the
// runner pattern, so the hook read the non-zero exit as a red RUN and wrote
// `light-red`; the next card stamped ⚠️ TESTS ROT over a session whose every
// real run had passed. A non-zero exit without the runner's own summary in the
// output now leaves both flags untouched.
describe("post.flow.completion — a chained command that died before the runner is not a red run (#409)", () => {
  const flag = (dir, name, sid) => path.join(dir, ".tmp", `dotclaude-devops-${name}-${sid}`);
  const CHAIN = "python patch.py && npm run test:gate && git commit -m x";

  test("pre-runner failure: neither light-red nor light-verified is written", () => {
    const dir = project();
    const sid = "s-409-chain";
    runHook(dir, sid, "Bash", {
      tool_input: { command: CHAIN, description: "Patch, test, commit" },
      tool_response: { exit_code: 1, stdout: "", stderr: "Traceback (most recent call last):\n  File patch.py, line 3\nKeyError: x" },
    });
    expect(fs.existsSync(flag(dir, "light-red", sid))).toBe(false);
    expect(fs.existsSync(flag(dir, "light-verified", sid))).toBe(false);
    cleanup(dir);
  });

  test("pre-runner failure keeps an EARLIER red flag as it was (nothing is cleared either)", () => {
    const dir = project();
    const sid = "s-409-keep";
    fs.writeFileSync(flag(dir, "light-red", sid), "Bash");
    runHook(dir, sid, "Bash", {
      tool_input: { command: CHAIN, description: "Patch, test, commit" },
      tool_response: { exit_code: 1, stderr: "npm ERR! missing script: test:gate" },
    });
    expect(fs.existsSync(flag(dir, "light-red", sid))).toBe(true);
    expect(fs.existsSync(flag(dir, "light-verified", sid))).toBe(false);
    cleanup(dir);
  });

  test("a runner that ran and failed still writes light-red", () => {
    const dir = project();
    const sid = "s-409-red";
    runHook(dir, sid, "Bash", {
      tool_input: { command: "npm run test:gate", description: "Run the gate" },
      tool_response: { exit_code: 1, stdout: "ℹ tests 9\nℹ pass 8\nℹ fail 1" },
    });
    expect(fs.existsSync(flag(dir, "light-red", sid))).toBe(true);
    expect(fs.existsSync(flag(dir, "light-verified", sid))).toBe(false);
    cleanup(dir);
  });

  test("a green run verifies and clears an earlier red flag — unchanged", () => {
    const dir = project();
    const sid = "s-409-green";
    fs.writeFileSync(flag(dir, "light-red", sid), "Bash");
    runHook(dir, sid, "Bash", {
      tool_input: { command: "npm run test:gate", description: "Run the gate" },
      tool_response: { exit_code: 0, stdout: "ℹ tests 9\nℹ pass 9\nℹ fail 0" },
    });
    expect(fs.existsSync(flag(dir, "light-verified", sid))).toBe(true);
    expect(fs.existsSync(flag(dir, "light-red", sid))).toBe(false);
    cleanup(dir);
  });
});

// A test run started with run_in_background returned the empty launch report
// { stdout: "", …, backgroundTaskId }. No failure signal in it, so it read as a
// PASS and verified a run that had not produced a single result yet. The launch
// now only records the run (light-bgrun); its task-notification settles it.
describe("post.flow.completion — a background test run verifies only by its result", () => {
  const flag = (dir, name, sid) => path.join(dir, ".tmp", `dotclaude-devops-${name}-${sid}`);
  const has = (dir, name, sid) => fs.existsSync(flag(dir, name, sid));
  const LAUNCH = { stdout: "", stderr: "", interrupted: false, isImage: false, backgroundTaskId: "b68oycrr6" };
  const GREEN = " Test Files  2 passed (2)\n      Tests  57 passed (57)";
  const launch = (dir, sid) => runHook(dir, sid, "Bash", {
    tool_input: { command: "npx vitest run", description: "Run the suite", run_in_background: true },
    tool_response: LAUNCH,
  });
  // The notification the harness enqueues when the task ends, and the output
  // file it names — written the way the transcript carries them.
  const finish = (dir, status, summary, output) => {
    const out = path.join(dir, "b68oycrr6.output");
    fs.writeFileSync(out, output);
    const transcript = path.join(dir, "transcript.jsonl");
    fs.writeFileSync(transcript, JSON.stringify({
      type: "queue-operation",
      operation: "enqueue",
      content: `<task-notification>\n<task-id>b68oycrr6</task-id>\n<output-file>${out}</output-file>\n` +
        `<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`,
    }) + "\n");
    return transcript;
  };

  test("the launch verifies nothing — the run is recorded instead", () => {
    const dir = project();
    const sid = "s-bg-launch";
    launch(dir, sid);
    expect(has(dir, "light-verified", sid)).toBe(false);
    expect(has(dir, "light-red", sid)).toBe(false);
    expect(fs.readFileSync(flag(dir, "light-bgrun", sid), "utf8")).toMatch(/^b68oycrr6 \d+$/);
    cleanup(dir);
  });

  test("a foreground green run verifies, as before", () => {
    const dir = project();
    const sid = "s-bg-foreground";
    runHook(dir, sid, "Bash", {
      tool_input: { command: "npx vitest run", description: "Run the suite" },
      tool_response: { stdout: GREEN, stderr: "", interrupted: false, isImage: false },
    });
    expect(has(dir, "light-verified", sid)).toBe(true);
    expect(has(dir, "light-bgrun", sid)).toBe(false);
    cleanup(dir);
  });

  test("the first call after its notification settles it — a green run verifies", () => {
    const dir = project();
    const sid = "s-bg-green";
    launch(dir, sid);
    const transcript = finish(dir, "completed", 'Background command "Run the suite" completed (exit code 0)', GREEN);
    runHook(dir, sid, "Read", { transcript_path: transcript });
    expect(has(dir, "light-verified", sid)).toBe(true);
    expect(has(dir, "light-bgrun", sid)).toBe(false);
    cleanup(dir);
  });

  test("a red background run writes light-red and verifies nothing", () => {
    const dir = project();
    const sid = "s-bg-red";
    launch(dir, sid);
    const transcript = finish(dir, "failed", 'Background command "Run the suite" failed with exit code 1',
      " Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 56 passed (57)");
    runHook(dir, sid, "Read", { transcript_path: transcript });
    expect(has(dir, "light-red", sid)).toBe(true);
    expect(has(dir, "light-verified", sid)).toBe(false);
    cleanup(dir);
  });

  test("a code edit after the launch drops the run — its result tested the old code", () => {
    const dir = project();
    const sid = "s-bg-edit";
    launch(dir, sid);
    runHook(dir, sid, "Edit");
    expect(has(dir, "light-bgrun", sid)).toBe(false);
    const transcript = finish(dir, "completed", 'Background command "Run the suite" completed (exit code 0)', GREEN);
    runHook(dir, sid, "Read", { transcript_path: transcript });
    expect(has(dir, "light-verified", sid)).toBe(false);
    expect(has(dir, "light-pending", sid)).toBe(true);
    cleanup(dir);
  });
});

// The completion MCP keys its per-turn flags by the `session_id` the MODEL
// passes — observed "self" (the ccd_session convention) and the Desktop
// `local_…` id — while stop.flow.guard reads the harness id, exact match only.
// Unmoved, the card counted as never rendered and the guard demanded a second
// one (do-batch activation, 2026-09-24: two identical cards in one turn).
describe("post.flow.completion — card flags follow the real session id", () => {
  const flag = (dir, name, sid) => path.join(dir, ".tmp", `dotclaude-devops-${name}-${sid}`);
  const RENDER = "mcp__plugin_devops_dotclaude-completion__render_completion_card";

  test('a card rendered with session_id "self" lands on the real id', () => {
    const dir = project();
    const sid = "real-uuid-1";
    fs.writeFileSync(flag(dir, "card-rendered", "self"), "t");
    fs.writeFileSync(flag(dir, "validation-attested", "self"), "t");
    fs.writeFileSync(flag(dir, "card-widget", "self"), "<h3>x</h3>");
    runHook(dir, sid, RENDER, { tool_input: { variant: "analysis", session_id: "self" } });
    expect(fs.existsSync(flag(dir, "card-rendered", sid))).toBe(true);
    expect(fs.existsSync(flag(dir, "validation-attested", sid))).toBe(true);
    expect(fs.readFileSync(flag(dir, "card-widget", sid), "utf8")).toBe("<h3>x</h3>");
    expect(fs.existsSync(flag(dir, "card-rendered", "self"))).toBe(false);
    // The widget path in the tool result stays readable.
    expect(fs.existsSync(flag(dir, "card-widget", "self"))).toBe(true);
    cleanup(dir);
  });

  test("a card rendered without session_id is picked up from the 'unknown' key", () => {
    const dir = project();
    const sid = "real-uuid-2";
    fs.writeFileSync(flag(dir, "card-rendered", "unknown"), "t");
    runHook(dir, sid, RENDER, { tool_input: { variant: "ready" } });
    expect(fs.existsSync(flag(dir, "card-rendered", sid))).toBe(true);
    cleanup(dir);
  });

  test("the right id leaves the flag where it is", () => {
    const dir = project();
    const sid = "real-uuid-3";
    fs.writeFileSync(flag(dir, "card-rendered", sid), "t");
    runHook(dir, sid, RENDER, { tool_input: { variant: "ready", session_id: sid } });
    expect(fs.existsSync(flag(dir, "card-rendered", sid))).toBe(true);
    cleanup(dir);
  });

  test("other tools never touch foreign card flags", () => {
    const dir = project();
    fs.writeFileSync(flag(dir, "card-rendered", "self"), "t");
    runHook(dir, "real-uuid-4", "Read", { tool_input: { file_path: "x", session_id: "self" } });
    expect(fs.existsSync(flag(dir, "card-rendered", "self"))).toBe(true);
    expect(fs.existsSync(flag(dir, "card-rendered", "real-uuid-4"))).toBe(false);
    cleanup(dir);
  });
});

// Regression 2026-09-24: the generic reminder ("COMPLETION CARD — when ALL work
// is done … output the markdown VERBATIM") was injected right after the card
// widget. It read as "a card still follows": a line landed under the widget,
// the Stop gate re-demanded the card, and the same card was drawn twice.
describe("post.flow.completion — quiet after the card itself", () => {
  const flag = (dir, name, sid) => path.join(dir, ".tmp", `dotclaude-devops-${name}-${sid}`);
  const WIDGET = "mcp__visualize__show_widget";
  const RENDER = "mcp__plugin_devops_dotclaude-completion__render_completion_card";

  test("after the card widget: end of turn, empty reply to the nudge, no card reminder", () => {
    const dir = project();
    const out = runHook(dir, "s-widget", WIDGET, { tool_input: { title: "completion_card_body", widget_code: "<h3>x</h3>" } });
    expect(out).toContain("Card shown");
    expect(out).toMatch(/reply to it with nothing/);
    expect(out).not.toContain("COMPLETION CARD");
    expect(out).not.toMatch(/VERBATIM/);
    cleanup(dir);
  });

  test("a deferred-namespace widget tool is the card too", () => {
    const dir = project();
    const out = runHook(dir, "s-widget-ns", "mcp__6f616b42__show_widget", { tool_input: { title: "completion_card_body" } });
    expect(out).toContain("Card shown");
    cleanup(dir);
  });

  test("after the render: deliver it as its result says, no second render", () => {
    const dir = project();
    const out = runHook(dir, "s-render", RENDER, { tool_input: { variant: "ready", session_id: "s-render" } });
    expect(out).toContain("Card rendered");
    expect(out).not.toContain("COMPLETION CARD");
    cleanup(dir);
  });

  test("any other widget keeps the ordinary reminder", () => {
    const dir = project();
    const out = runHook(dir, "s-chart", WIDGET, { tool_input: { title: "q4_revenue_chart" } });
    expect(out).toContain("COMPLETION CARD");
    cleanup(dir);
  });

  test("a tool call after this turn's render warns against showing the same card twice", () => {
    const dir = project();
    fs.writeFileSync(flag(dir, "card-rendered", "s-after"), "t");
    const out = runHook(dir, "s-after", "mcp__ccd_session_mgmt__set_session_title");
    expect(out).toContain("already rendered this turn");
    expect(out).toMatch(/never show the same card twice/);
    cleanup(dir);
  });

  test("the reminder states the widget-only contract, not the old widget-before-markdown order", () => {
    const dir = project();
    const out = runHook(dir, "s-contract");
    expect(out).not.toMatch(/goes BEFORE the card/);
    expect(out).toMatch(/show_widget call IS the card/);
    expect(out).toMatch(/reply to it with nothing/);
    cleanup(dir);
  });
});

// Hooks fire for a subagent's tool calls with the PARENT's session_id. Observed
// 2026-09-25: an isolated background agent's Edit in its own worktree wrote the
// parent's validation-pending and deleted the validation-attested flag the
// parent's card had written — both Stop gates then blocked an unchanged
// checkout. Subagent calls now touch nothing of the parent; only the session's
// own work tree owes the gates; and merged work (where delegation lands) owes
// them like an edit.
describe("post.flow.completion — subagent and out-of-tree changes do not touch the parent's gates", () => {
  const flag = (dir, name, sid) => path.join(dir, ".tmp", `dotclaude-devops-${name}-${sid}`);
  const seed = (dir, sid) => {
    fs.writeFileSync(flag(dir, "validation-attested", sid), "seed");
    fs.writeFileSync(flag(dir, "light-verified", sid), "seed");
  };
  const has = (dir, name, sid) => fs.existsSync(flag(dir, name, sid));
  const read = (dir, name, sid) => fs.readFileSync(flag(dir, name, sid), "utf8");
  const expectUntouched = (dir, sid) => {
    expect(has(dir, "light-pending", sid)).toBe(false);
    expect(has(dir, "validation-pending", sid)).toBe(false);
    expect(read(dir, "validation-attested", sid)).toBe("seed");
    expect(read(dir, "light-verified", sid)).toBe("seed");
  };
  const expectOwed = (dir, sid) => {
    expect(has(dir, "light-pending", sid)).toBe(true);
    expect(has(dir, "validation-pending", sid)).toBe(true);
    expect(has(dir, "validation-attested", sid)).toBe(false);
    expect(has(dir, "light-verified", sid)).toBe(false);
  };
  const PASS = { exit_code: 0, stdout: "ℹ tests 9\nℹ pass 9\nℹ fail 0" };
  const FAIL = { exit_code: 1, stdout: "ℹ tests 9\nℹ pass 8\nℹ fail 1" };

  test("subagent-gates: a subagent Edit owes nothing and keeps both seeded flags", () => {
    const dir = project();
    const sid = "s-sub-edit";
    seed(dir, sid);
    runHook(dir, sid, "Edit", { agent_id: "agent-1" });
    expectUntouched(dir, sid);
    cleanup(dir);
  });

  test("subagent-gates: a subagent Write in its own sibling worktree owes nothing", () => {
    const dir = project();
    const sib = fs.mkdtempSync(path.join(os.tmpdir(), "completion-flow-sib-"));
    const sid = "s-sub-write";
    seed(dir, sid);
    runHook(dir, sid, "Write", { agent_id: "agent-2", tool_input: { file_path: path.join(sib, "x.js") } });
    expectUntouched(dir, sid);
    cleanup(dir); cleanup(sib);
  });

  test("subagent-gates: a subagent's passing test run writes no light-verified, a failing one no light-red", () => {
    const dir = project();
    const sid = "s-sub-run";
    fs.writeFileSync(flag(dir, "light-pending", sid), "a.js");
    runHook(dir, sid, "Bash", { agent_id: "agent-3", tool_input: { command: "npm run test:gate" }, tool_response: PASS });
    expect(has(dir, "light-verified", sid)).toBe(false);
    runHook(dir, sid, "Bash", { agent_id: "agent-3", tool_input: { command: "npm run test:gate" }, tool_response: FAIL });
    expect(has(dir, "light-red", sid)).toBe(false);
    expect(read(dir, "light-pending", sid)).toBe("a.js");
    cleanup(dir);
  });

  test("subagent-gates: a subagent call writes no work-happened and does not bump the edits counter", () => {
    const dir = project();
    const sid = "s-sub-work";
    seed(dir, sid);
    fs.writeFileSync(flag(dir, "edits", sid), "3");
    runHook(dir, sid, "Edit", { agent_id: "agent-4" });
    runHook(dir, sid, "Read", { agent_id: "agent-4" });
    expect(has(dir, "work-happened", sid)).toBe(false);
    expect(read(dir, "edits", sid)).toBe("3");
    expectUntouched(dir, sid);
    cleanup(dir);
  });

  test("subagent-gates: the parent's Edit outside its work tree owes nothing", () => {
    const dir = project();
    const sib = fs.mkdtempSync(path.join(os.tmpdir(), "completion-flow-sib-"));
    const sid = "s-out-tree";
    seed(dir, sid);
    runHook(dir, sid, "Edit", { tool_input: { file_path: path.join(sib, "x.js") } });
    expectUntouched(dir, sid);
    cleanup(dir); cleanup(sib);
  });

  test("subagent-gates: an Edit in a linked worktree nested in the project owes nothing", () => {
    const dir = project();
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    const wt = path.join(dir, ".claude", "worktrees", "agent-x");
    fs.mkdirSync(path.join(wt, "src"), { recursive: true });
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${path.join(dir, ".git", "worktrees", "agent-x")}\n`);
    const sid = "s-nested-wt";
    seed(dir, sid);
    runHook(dir, sid, "Edit", { tool_input: { file_path: path.join(wt, "src", "x.js") } });
    expectUntouched(dir, sid);
    cleanup(dir);
  });

  test("subagent-gates: the parent's own Edit still owes both and clears both seeded flags", () => {
    const dir = project();
    const sid = "s-own-edit";
    seed(dir, sid);
    runHook(dir, sid, "Edit");
    expectOwed(dir, sid);
    cleanup(dir);
  });

  // --- merged work, in a real temp git repo ---
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
  };
  const git = (dir, args, env = {}) => {
    const r = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
      cwd: dir, encoding: "utf8", env: { ...gitEnv, ...env },
    });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commitFile = (dir, name, msg) => {
    fs.writeFileSync(path.join(dir, name), `${msg}\n`);
    git(dir, ["add", name]);
    git(dir, ["commit", "-q", "-m", msg]);
    return git(dir, ["rev-parse", "HEAD"]);
  };
  // main with a README, branch `b` carrying `file`, back on main.
  const repo = (file = "lib.js") => {
    const dir = project();
    git(dir, ["init", "-q", "-b", "main"]);
    commitFile(dir, "README.md", "base");
    git(dir, ["checkout", "-q", "-b", "b"]);
    const sha = commitFile(dir, file, "on b");
    git(dir, ["checkout", "-q", "main"]);
    return { dir, sha };
  };
  const bash = (dir, sid, command, extra = {}) =>
    runHook(dir, sid, "Bash", { tool_input: { command }, tool_response: { exit_code: 0, stdout: "" }, ...extra });

  test("subagent-gates: `git merge b` bringing a .js file owes both", () => {
    const { dir } = repo();
    const sid = "s-merge";
    seed(dir, sid);
    git(dir, ["merge", "-q", "b"]);
    bash(dir, sid, "git merge b");
    expectOwed(dir, sid);
    expect(read(dir, "validation-pending", sid)).toContain("lib.js");
    cleanup(dir);
  });

  test("subagent-gates: `git cherry-pick <sha>` of a code commit owes both", () => {
    const { dir, sha } = repo("pick.js");
    const sid = "s-pick";
    seed(dir, sid);
    git(dir, ["cherry-pick", sha]);
    bash(dir, sid, `git cherry-pick ${sha}`);
    expectOwed(dir, sid);
    cleanup(dir);
  });

  test("subagent-gates: a docs-only merge owes nothing", () => {
    const { dir } = repo("GUIDE.md");
    const sid = "s-merge-docs";
    seed(dir, sid);
    git(dir, ["merge", "-q", "b"]);
    bash(dir, sid, "git merge b");
    expectUntouched(dir, sid);
    cleanup(dir);
  });

  test("subagent-gates: a merge dated 2 h ago owes nothing", () => {
    const { dir } = repo();
    const sid = "s-merge-old";
    seed(dir, sid);
    const old = Math.floor(Date.now() / 1000) - 2 * 3600;
    git(dir, ["merge", "-q", "b"], { GIT_COMMITTER_DATE: `@${old} +0000` });
    bash(dir, sid, "git merge b");
    expectUntouched(dir, sid);
    cleanup(dir);
  });

  test("subagent-gates: the same merge is owed once (watermark)", () => {
    const { dir } = repo();
    const sid = "s-merge-once";
    git(dir, ["merge", "-q", "b"]);
    bash(dir, sid, "git merge b");
    expect(has(dir, "validation-pending", sid)).toBe(true);
    for (const f of ["light-pending", "light-kind", "validation-pending"]) fs.rmSync(flag(dir, f, sid));
    seed(dir, sid);
    bash(dir, sid, "git merge b");
    expectUntouched(dir, sid);
    cleanup(dir);
  });

  test("subagent-gates: a plain `git commit` owes nothing via the merge path", () => {
    const { dir } = repo();
    const sid = "s-commit";
    seed(dir, sid);
    commitFile(dir, "c.js", "plain");
    bash(dir, sid, "git commit -m plain");
    expectUntouched(dir, sid);
    cleanup(dir);
  });

  test("subagent-gates: a subagent's merge owes nothing", () => {
    const { dir } = repo();
    const sid = "s-sub-merge";
    seed(dir, sid);
    git(dir, ["merge", "-q", "b"]);
    bash(dir, sid, "git merge b", { agent_id: "agent-5" });
    expectUntouched(dir, sid);
    cleanup(dir);
  });

  test("subagent-gates: `git merge b && npm run test:gate` passing ends verified", () => {
    const { dir } = repo();
    const sid = "s-merge-test";
    seed(dir, sid);
    git(dir, ["merge", "-q", "b"]);
    bash(dir, sid, "git merge b && npm run test:gate", { tool_response: PASS });
    expect(has(dir, "light-pending", sid)).toBe(true);
    expect(has(dir, "validation-pending", sid)).toBe(true);
    expect(has(dir, "validation-attested", sid)).toBe(false);
    expect(read(dir, "light-verified", sid)).toBe("Bash");
    cleanup(dir);
  });
});

// A task chip (Desktop spawn_task) is the offer for an out-of-scope topic. The
// same topic on the card went into "Nachbessern" too and was fixed twice.
describe("post.flow.completion — task chips", () => {
  const SPAWN = "mcp__ccd_session__spawn_task";
  const DISMISS = "mcp__ccd_session__dismiss_task";
  const stateFile = (dir, sid) => path.join(dir, ".tmp", `dotclaude-devops-task-chips-${sid}`);
  const spawnResult = (id, title) => [{
    type: "text",
    text: `Noted (position 1, task_id: ${id}). A chip is showing for the user. Currently pending: ${id} "${title}". Continue your current work.`,
  }];

  test("a spawned chip is recorded and Claude is told the chip is the offer", () => {
    const dir = project();
    const sid = "s-chip-1";
    const out = runHook(dir, sid, SPAWN, {
      tool_input: { title: "Fix flaky mtime test in graph-nudge", tldr: "Seen while shipping.", prompt: "…" },
      tool_response: spawnResult("task_ab12", "Fix flaky mtime test in graph-nudge"),
    });
    expect(out).toContain('Chip offered: "Fix flaky mtime test in graph-nudge"');
    expect(out).toMatch(/chip IS the offer/);
    const state = JSON.parse(fs.readFileSync(stateFile(dir, sid), "utf8"));
    expect(state.chips.map((c) => [c.id, c.title])).toEqual([["task_ab12", "Fix flaky mtime test in graph-nudge"]]);
    cleanup(dir);
  });

  test("a withdrawn chip is marked, so it no longer counts as an offer", () => {
    const dir = project();
    const sid = "s-chip-2";
    runHook(dir, sid, SPAWN, {
      tool_input: { title: "Route two PostToolUse hooks through additionalContext" },
      tool_response: spawnResult("task_cd34", "Route two PostToolUse hooks through additionalContext"),
    });
    runHook(dir, sid, DISMISS, {
      tool_input: { task_id: "task_cd34", reason: "fixed in this session" },
      tool_response: [{ type: "text", text: "Task task_cd34 withdrawn — the chip is no longer shown to the user." }],
    });
    const state = JSON.parse(fs.readFileSync(stateFile(dir, sid), "utf8"));
    expect(state.chips[0].dismissed).toBe(true);
    cleanup(dir);
  });
});

// The card widget ends the turn (lib/card-turn-end.js): the plugin's Stop hooks
// run inside this hook, and when none blocks the answer is `continue: false` —
// no model call after the card, so nothing can land under it. Driven against a
// fake plugin root whose Stop hooks only log, so no real Stop hook runs here.
describe("post.flow.completion — the card widget ends the turn", () => {
  const WIDGET = "mcp__visualize__show_widget";
  const CARD = { title: "completion_card_body", widget_code: "<h3 class=\"card-title\">T</h3>" };

  function fakeRoot({ blockFirst = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "card-stop-root-"));
    fs.mkdirSync(path.join(root, "hooks", "stop"), { recursive: true });
    const log = path.join(root, "stop.log");
    const script = (name, block) => [
      "let raw='';process.stdin.on('data',d=>raw+=d);process.stdin.on('end',()=>{",
      "  const h=JSON.parse(raw||'{}');",
      `  require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ name: ${JSON.stringify(name)}, ev: h.hook_event_name, active: h.stop_hook_active, sid: h.session_id }) + String.fromCharCode(10));`,
      block ? "  process.stdout.write(JSON.stringify({ decision: 'block', reason: 'Validation required — pass validation' }));" : "",
      "});",
    ].join("\n");
    fs.writeFileSync(path.join(root, "hooks", "stop", "stop.one.js"), script("one", blockFirst));
    fs.writeFileSync(path.join(root, "hooks", "stop", "stop.two.js"), script("two", false));
    fs.writeFileSync(path.join(root, "hooks", "hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [
      { type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/stop.one.js" },
      { type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/stop.two.js" },
    ] }] } }));
    const ran = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
    return { root, ran };
  }

  test("no Stop hook blocks → continue:false, every Stop hook ran once as a Stop event", () => {
    const dir = project();
    const { root, ran } = fakeRoot();
    const raw = runHookRaw(dir, "s-hard-1", WIDGET, { tool_input: CARD }, { CLAUDE_PLUGIN_ROOT: root });
    const out = JSON.parse(raw);
    expect(out.continue).toBe(false);
    expect(out.stopReason).toMatch(/devops/);
    expect(ran().map((r) => [r.name, r.ev, r.active, r.sid])).toEqual([
      ["one", "Stop", false, "s-hard-1"],
      ["two", "Stop", false, "s-hard-1"],
    ]);
    cleanup(dir); cleanup(root);
  });

  test("a blocking Stop hook keeps the turn going and hands Claude its reason", () => {
    const dir = project();
    const { root, ran } = fakeRoot({ blockFirst: true });
    const raw = runHookRaw(dir, "s-hard-2", WIDGET, { tool_input: CARD }, { CLAUDE_PLUGIN_ROOT: root });
    const out = JSON.parse(raw);
    expect(out.continue).toBeUndefined();
    const text = out.hookSpecificOutput.additionalContext;
    expect(text).toContain("[card-turn-end]");
    expect(text).toContain("Validation required");
    expect(ran().map((r) => r.name)).toEqual(["one"]);
    cleanup(dir); cleanup(root);
  });

  test("an active ship queue keeps the turn: the old reminder, no Stop hook run", () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, ".claude", ".ship-queue"), JSON.stringify({ owner: "auto-cleanup", since: new Date().toISOString() }));
    const { root, ran } = fakeRoot();
    const out = runHook(dir, "s-hard-3", WIDGET, { tool_input: CARD }, { CLAUDE_PLUGIN_ROOT: root });
    expect(out).toContain("Card shown");
    expect(out).toMatch(/reply to it with nothing/);
    expect(ran()).toEqual([]);
    cleanup(dir); cleanup(root);
  });

  test("any other widget never ends the turn", () => {
    const dir = project();
    const { root, ran } = fakeRoot();
    const raw = runHookRaw(dir, "s-hard-4", WIDGET, { tool_input: { title: "q4_revenue_chart" } }, { CLAUDE_PLUGIN_ROOT: root });
    expect(raw).not.toContain('"continue":false');
    expect(ran()).toEqual([]);
    cleanup(dir); cleanup(root);
  });
});
