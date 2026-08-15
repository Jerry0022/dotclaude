import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Issue #276: the concept skill dropped a bridge submission whenever the user
// clicked "submit" and then typed nothing. The cause was documentation, not
// code — monitoring.md told Claude to "wait for their next message" while its
// own Polling Strategy claimed an indefinite autonomous poll, and SKILL.md
// never once mentioned the background task that actually does the polling.
//
// Nothing enforces prose, so these tests pin the load-bearing sentences the way
// templates-reference.test.js pins the template's script blocks: a future edit
// that reintroduces the drift fails the suite instead of shipping silently.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = f => fs.readFileSync(path.join(__dirname, f), "utf8");

const SKILL = read("SKILL.md");
const MONITORING = read("deep-knowledge/monitoring.md");
const BRIDGE = read("deep-knowledge/bridge-server.md");

describe("bridge-server.md stays the single source of truth", () => {
  test("it still defines both background tasks", () => {
    expect(BRIDGE).toContain("Keepalive pulser");
    expect(BRIDGE).toContain("Pickup waker");
    expect(BRIDGE).toContain("concept-watch.js");
  });

  test("the exit vocabulary lives in the script the doc points at", () => {
    // The reason strings used to be inline in the doc's shell loop. They are
    // emitted by concept-watch.js now — that is the source of truth for them,
    // and SKILL.md Step 5d's action table keys off the same words.
    const script = fs.readFileSync(
      path.join(__dirname, "..", "..", "scripts", "concept-watch.js"),
      "utf8"
    );
    expect(script).toContain("PULSER");
    expect(script).toContain("WAKER");
    for (const reason of ["PENDING_SUBMISSION", "SERVER_DEAD", "STATE_GONE", "PORT_CHANGED"]) {
      expect(script, reason).toContain(reason);
      expect(BRIDGE, reason).toContain(reason);
    }
  });

  test("monitoring.md points at it instead of redefining the cron", () => {
    expect(MONITORING).toContain("bridge-server.md");
    // The heartbeat-ONLY cron is what made the indicator green while nothing
    // watched for submissions. It must not come back.
    expect(MONITORING).not.toContain(
      'CronCreate(cron: "* * * * *", prompt: "Run silently: curl -s -X POST http://localhost:{port}/heartbeat'
    );
  });
});

describe("monitoring.md — the idle default is autonomous polling", () => {
  test("step 1 is not 'wait for their next message'", () => {
    expect(MONITORING).not.toMatch(/1\.\s*After opening the page, inform the user and \*\*wait for their next message\*\*/);
  });

  test("it states that the page IS the submission channel", () => {
    expect(MONITORING).toMatch(/bridge page IS the submission channel/i);
  });

  test("the waker is named as what keeps watching", () => {
    expect(MONITORING).toMatch(/pickup waker/i);
  });

  test("a user chat message is a shortcut, never the trigger", () => {
    expect(MONITORING).toMatch(/shortcut, never the trigger/i);
  });

  test("sleep loops are forbidden only in the FOREGROUND", () => {
    // The old blanket "Do NOT use sleep loops" contradicted bridge-server.md,
    // which mandates exactly that loop — detached.
    expect(MONITORING).not.toMatch(/\*\*Do NOT use sleep loops\.\*\*/);
    expect(MONITORING).toMatch(/Do not poll in the foreground/i);
  });
});

describe("one interval, stated once", () => {
  test("monitoring.md no longer advertises a 15s poll no code path implements", () => {
    expect(MONITORING).not.toMatch(/\*\*Poll interval\*\*:\s*15 seconds/);
  });

  test("it names 20s primary and 60s backup", () => {
    // Anchored deliberately: a `.*` across newlines would pass on almost any
    // text and pin nothing.
    expect(MONITORING).toMatch(/20 s, primary/);
    expect(MONITORING).toMatch(/60 s, backup only/);
  });

  test("the documented interval matches the loops in bridge-server.md", () => {
    expect(BRIDGE).toContain("sleep 20");
  });
});

describe("pickup acks via /pending, never /decisions", () => {
  test("monitoring.md polls /pending", () => {
    expect(MONITORING).toMatch(/curl -s http:\/\/localhost:\$PORT\/pending/);
  });

  test("monitoring.md explains that /decisions acks nothing", () => {
    expect(MONITORING).toMatch(/_picked_up_at/);
    expect(MONITORING).toMatch(/only.*endpoint that acks/i);
  });

  test("SKILL.md Step 4 polls /pending too", () => {
    expect(SKILL).toMatch(/curl -s http:\/\/localhost:\$PORT\/pending/);
  });
});

describe("SKILL.md wires the tasks into the step list", () => {
  test("Step 3 launches both background tasks", () => {
    expect(SKILL).toContain("Keepalive pulser");
    expect(SKILL).toContain("Pickup waker");
    expect(SKILL).toMatch(/run_in_background: true/);
  });

  test("Step 5d re-launches the waker — the gap that broke iteration 2", () => {
    expect(SKILL).toMatch(/Re-launch the pickup waker/);
  });

  test("the re-launch happens at 5c step 7, not after the whole round", () => {
    // The unwatched window spans the entire processing round, which for an
    // `implement` is minutes — and the cron cannot cover it, because it fires
    // only while the REPL is idle and the REPL is busy processing.
    expect(SKILL).toMatch(/\*\*Immediately re-launch the pickup waker\*\*/);
    expect(SKILL).toMatch(/5c step 7/);
  });

  test("the pulser is only re-launched when it actually exited", () => {
    // It does exit — on SERVER_DEAD and PORT_CHANGED. Claiming otherwise
    // hard-codes a false invariant.
    expect(SKILL).not.toMatch(/it never exited/);
    expect(SKILL).toMatch(/Re-launch the pulser only when you actually saw a `PULSER_EXIT`/);
  });

  test("every background-task exit reason has a documented response", () => {
    for (const reason of ["PENDING_SUBMISSION", "SERVER_DEAD", "STATE_GONE", "PORT_CHANGED"]) {
      expect(SKILL, reason).toContain(reason);
    }
    expect(SKILL).toMatch(/re-launch \*\*both\*\* tasks/i);
  });

  test("Step 4 no longer calls the cron the primary mechanism", () => {
    expect(SKILL).not.toMatch(/\*\*Primary mechanism\*\*: the combined cron/);
    expect(SKILL).toMatch(/\*\*Primary mechanism\*\*: the \*\*pickup waker\*\*/);
  });

  test("allowed-tools grants the watchers honestly, with no fake-narrow prefix", () => {
    const frontmatter = SKILL.slice(0, SKILL.indexOf("\n---", 4));
    // The watchers are `node …` invocations, so the existing grant covers them.
    // `Bash(fails=0*)` would have granted ANY command starting with `fails=0`
    // — a blanket grant dressed up as a narrow one.
    expect(frontmatter).toContain("Bash(node *)");
    expect(frontmatter).not.toContain("fails=0");
  });

  test("the state path is passed absolute", () => {
    expect(SKILL).toMatch(/\*\*absolute\*\* path via `--state`/);
  });

  test("a wake is re-confirmed before it is acted on", () => {
    // Two wakers both exit PENDING_SUBMISSION; the second wake arrives after
    // /reset cleared the flag, and acting on it re-runs `implement`.
    expect(SKILL).toMatch(/Before processing a wake, re-confirm/);
    expect(SKILL).not.toMatch(/Re-launching twice is harmless/);
  });

  test("SERVER_DEAD recovery reuses the port instead of picking a new one", () => {
    expect(SKILL).toMatch(/Restart the bridge server \*\*on the same port\*\*/);
  });

  test("the final-report branch reaches the re-launch too", () => {
    // It is the longest round and the one most exposed by an unwatched window.
    expect(SKILL).toMatch(/as steps 5–7 above/);
  });
});

describe("monitoring.md's recovery matches the launch contract", () => {
  test("it no longer prescribes the forbidden `&` restart", () => {
    // bridge-server.md is explicit that a child backgrounded inside one Bash
    // call is reaped when that call ends.
    expect(MONITORING).not.toMatch(/python concept-server\.py \$PORT "\$DIR" &/);
    expect(MONITORING).toMatch(/Never the `&` form/);
  });

  test("recovery re-launches the watchers, not just the server", () => {
    expect(MONITORING).toMatch(/re-launch both watchers/i);
  });
});
