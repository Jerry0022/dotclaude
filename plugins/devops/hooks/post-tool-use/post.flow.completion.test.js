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
function runHook(dir, sid, toolName = "Read", extra = {}) {
  const raw = runHookRaw(dir, sid, toolName, extra);
  if (!raw) return "";
  try {
    const out = JSON.parse(raw);
    return (out && out.hookSpecificOutput && out.hookSpecificOutput.additionalContext) || raw;
  } catch {
    return raw;
  }
}

function runHookRaw(dir, sid, toolName = "Read", extra = {}) {
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
      env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
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
