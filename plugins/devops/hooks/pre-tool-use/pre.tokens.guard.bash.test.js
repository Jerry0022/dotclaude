import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// This file spawns real processes (hooks, scripts, or a server). The full suite
// runs 64 files in parallel, all starting `node` at once, so process-start tail
// latency reaches many times its isolated cost — enough for a spawn-heavy test
// to blow the 5s default on a load spike rather than on a defect. Measured
// 2026-08-16: the worst offender costs 832ms isolated and still timed out at 5s
// during a full run. 30s leaves that headroom and still catches a genuine hang.
vi.setConfig({ testTimeout: 30_000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.tokens.guard.js");

const BIG = "docs/concepts/big.html";

// Isolate ~/.claude from the machine running the tests (same idiom as
// pre.tokens.guard.graphgate.test.js) so no global record can flip a verdict.
const HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tokguard-home-"));
fs.mkdirSync(path.join(HOME_DIR, ".claude"), { recursive: true });

/** Temp project with one known expensive file, well above the 20K threshold. */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokguard-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  // Private tmpdir for THIS project's confirmation flags. The hook writes them
  // to `os.tmpdir()`, which honours TMPDIR/TEMP/TMP, so pointing those at a
  // per-project directory keeps each test's flags to itself. Without it every
  // test in the suite drops `claude_confirm_*` into the one shared system
  // tmpdir, and the flag-lookup tests below — which pick the first file that
  // appeared since a `before` snapshot — could grab a PARALLEL test's flag,
  // expire that one, and then see their own confirmation still valid.
  fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  fs.writeFileSync(
    path.join(dir, ".claude", "token-config.json"),
    JSON.stringify({
      plan: "max_20",
      estimatedLimitTokens: 200000,
      confirmThresholdPct: 0.1,
      tokensPerByte: 0.25,
      expensiveFiles: [{ path: BIG, estimatedTokens: 49557 }],
    })
  );
  return dir;
}

// Requirement A1 caps every Bash cost estimate at
// `BASH_MAX_OUTPUT_LENGTH * tokensPerByte` — with the harness's real default
// (30000) that is 7500 tokens, BELOW this suite's 20000-token threshold, so a
// blocking test would silently stop blocking. These tests are about the
// large-file MATCHING logic (bash-context-cost) and the retry-to-proceed
// mechanics, not the cap itself (that has its own describe block below), so
// they raise the env var to a value that keeps the pre-cap behaviour intact.
const UNCAPPED_OUTPUT_LEN = "1000000";

// Requirement 8: every hook spawn points DOTCLAUDE_GRAPHIFY_METRICS at an
// isolated temp file — never the real `~/.claude/graphify-metrics.jsonl`.
const METRICS_FILE = path.join(HOME_DIR, "graphify-metrics-isolated.jsonl");

function runBash(dir, sid, toolInput, extraEnv = {}) {
  // The full suite runs 50+ files in parallel; on a loaded machine spawnSync
  // can fail to start the child at all (status null, res.error set). That is
  // harness pressure, not a hook verdict, so retry it — but never retry a
  // child that actually ran, or a real block would be masked.
  for (let attempt = 0; ; attempt++) {
    const tmp = path.join(dir, ".tmp");
    const env = {
      ...process.env,
      HOME: HOME_DIR, USERPROFILE: HOME_DIR,
      TMPDIR: tmp, TEMP: tmp, TMP: tmp,
      BASH_MAX_OUTPUT_LENGTH: UNCAPPED_OUTPUT_LEN,
      DOTCLAUDE_GRAPHIFY_METRICS: METRICS_FILE,
      ...extraEnv,
    };
    // Node's spawn env requires string values — `undefined` (a test's way of
    // asking "no override, use the hook's own real default") must be REMOVED,
    // not passed through.
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    const res = spawnSync(process.execPath, [HOOK], {
      cwd: dir,
      input: JSON.stringify({ tool_name: "Bash", tool_input: toolInput, session_id: sid }),
      encoding: "utf8",
      env,
    });
    if (res.status !== null || attempt >= 3) {
      if (res.status === null) {
        throw new Error(`hook never started after ${attempt + 1} attempts: ${res.error}`);
      }
      return { status: res.status, stderr: res.stderr || "" };
    }
  }
}

const blocked = r => r.status === 2 && /HIGH TOKEN COST/.test(r.stderr);

/**
 * Confirmation flags this project wrote. Reads the project's PRIVATE tmpdir,
 * so the result cannot contain another test's flag no matter how many run in
 * parallel — which a `before`/`after` diff of the shared system tmpdir could.
 */
const confirmFlags = dir => {
  const tmp = path.join(dir, ".tmp");
  return fs.readdirSync(tmp)
    .filter(f => f.startsWith("claude_confirm_"))
    .map(f => path.join(tmp, f));
};
const cleanup = dir => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

describe("pre.tokens.guard — Bash large-file matching (integration)", () => {
  test("a command that READS the large file is blocked", () => {
    const dir = project();
    const r = runBash(dir, "s-read", { command: `cat ${BIG}` });
    expect(blocked(r)).toBe(true);
    expect(r.stderr).toContain("Large files referenced");
    cleanup(dir);
  });

  test("merely passing the path as an argument is allowed", () => {
    const dir = project();
    expect(runBash(dir, "s-ls", { command: `ls -la ${BIG}` }).status).toBe(0);
    expect(runBash(dir, "s-echo", { command: `echo "wrote ${BIG}"` }).status).toBe(0);
    cleanup(dir);
  });

  test("a detached server start that only forwards the path is allowed (issue #277)", () => {
    const dir = project();
    const command = `python scripts/concept-server.py 8883 . --html ${BIG}`;
    expect(runBash(dir, "s-server", { command, run_in_background: true }).status).toBe(0);
    cleanup(dir);
  });

  test("backgrounding a reader does not buy an exemption", () => {
    const dir = project();
    const r = runBash(dir, "s-bgcat", { command: `cat ${BIG}`, run_in_background: true });
    expect(blocked(r)).toBe(true);
    cleanup(dir);
  });

  test("an unknown foreground command head still blocks (fail safe)", () => {
    const dir = project();
    expect(blocked(runBash(dir, "s-unknown", { command: `./weird-tool ${BIG}` }))).toBe(true);
    cleanup(dir);
  });

  test("a detached shell that reads the file is still blocked", () => {
    const dir = project();
    const r = runBash(dir, "s-bgsh", { command: `bash -c "cat ${BIG}"`, run_in_background: true });
    expect(blocked(r)).toBe(true);
    cleanup(dir);
  });

  test("a path parked in a variable is still blocked", () => {
    const dir = project();
    expect(blocked(runBash(dir, "s-var", { command: `FILE=${BIG} && cat $FILE` }))).toBe(true);
    cleanup(dir);
  });

  test("verbose-output detection still fires after the new early exit", () => {
    const dir = project();
    for (const command of ["git log", "npm ls", "find .", "docker logs web"]) {
      const r = runBash(dir, `s-verbose-${command.replace(/\W/g, "")}`, { command });
      expect(r.status, command).toBe(2);
      expect(r.stderr, command).toContain("Unbounded output");
    }
    cleanup(dir);
  }, 30_000);

  test("commands the old noTokenCostPattern exempted are still exempt", () => {
    const dir = project();
    for (const command of [
      `git add ${BIG}`, "git commit -m x", "git push origin main",
      `rm ${BIG}`, `cp ${BIG} docs/copy.html`, `mv ${BIG} docs/old.html`,
      "mkdir docs/new", "cd docs", "npm publish", "gh pr create --fill",
    ]) {
      expect(runBash(dir, "s-parity", { command }).status, command).toBe(0);
    }
    cleanup(dir);
    // Ten node spawns. Vitest's 5s default is not a budget this can meet while
    // 60+ other test files compete for the machine.
  }, 30_000);
});

describe("pre.tokens.guard — degraded inputs must not fail open", () => {
  test.each([
    ["expensiveFiles as an object", { expensiveFiles: { path: BIG } }],
    ["expensiveFiles as a string", { expensiveFiles: "nope" }],
    ["expensiveFiles missing", {}],
    ["config is not JSON", "@@@not-json@@@"],
  ])("%s → hook exits cleanly with no stack trace", (_label, cfg) => {
    const dir = project();
    fs.writeFileSync(
      path.join(dir, ".claude", "token-config.json"),
      typeof cfg === "string" ? cfg : JSON.stringify({ plan: "max_20", ...cfg })
    );
    const r = runBash(dir, "s-degraded", { command: `cat ${BIG}` });
    expect(r.status).not.toBe(1);
    expect(r.stderr).not.toContain("at Object.");   // no node stack trace
    cleanup(dir);
  });
});

describe("pre.tokens.guard — retry-to-proceed release (integration)", () => {
  test("an identical retry releases", () => {
    const dir = project();
    const input = { command: `cat ${BIG}` };
    expect(blocked(runBash(dir, "s-same", input))).toBe(true);
    expect(runBash(dir, "s-same", input).status).toBe(0);
    cleanup(dir);
  });

  test("a retry that adds run_in_background releases (issue #277)", () => {
    const dir = project();
    expect(blocked(runBash(dir, "s-bg", { command: `cat ${BIG}` }))).toBe(true);
    expect(runBash(dir, "s-bg", { command: `cat ${BIG}`, run_in_background: true }).status).toBe(0);
    cleanup(dir);
  });

  test("a retry with a reworded description releases (issue #277)", () => {
    const dir = project();
    expect(blocked(runBash(dir, "s-desc", { command: `cat ${BIG}`, description: "Read the concept page" }))).toBe(true);
    expect(runBash(dir, "s-desc", { command: `cat ${BIG}`, description: "Show the concept page" }).status).toBe(0);
    cleanup(dir);
  });

  test("a retry with reordered input keys releases", () => {
    const dir = project();
    expect(blocked(runBash(dir, "s-order", { description: "a", command: `cat ${BIG}` }))).toBe(true);
    expect(runBash(dir, "s-order", { command: `cat ${BIG}`, timeout: 5000 }).status).toBe(0);
    cleanup(dir);
  });

  test("a block in one project does not pre-authorise another", () => {
    const a = project();
    const b = project();
    const input = { command: `cat ${BIG}` };
    expect(blocked(runBash(a, "s-leak", input))).toBe(true);
    expect(blocked(runBash(b, "s-leak", input))).toBe(true); // must still block in project B
    cleanup(a);
    cleanup(b);
  });

  // Deliberate trade-off, not an oversight: session_id is NOT part of the key.
  // lib/session-id.js documents that Claude Code may deliver a different or
  // missing session_id between hook invocations (issue #10), and this path has
  // no escape hatch — keying on it could wedge the retry forever, which is the
  // failure being fixed. A confirmation therefore survives into the project's
  // next session; it still never crosses into another project.
  test("a confirmation survives a session_id change (retry must never wedge)", () => {
    const dir = project();
    const input = { command: `cat ${BIG}` };
    expect(blocked(runBash(dir, "s-one", input))).toBe(true);
    expect(runBash(dir, "s-two", input).status).toBe(0);
    cleanup(dir);
  });

  test("a confirmation survives a missing session_id entirely", () => {
    const dir = project();
    const input = { command: `cat ${BIG}` };
    expect(blocked(runBash(dir, undefined, input))).toBe(true);
    expect(runBash(dir, undefined, input).status).toBe(0);
    cleanup(dir);
  });

  test("an expired confirmation blocks again instead of auto-approving", () => {
    const dir = project();
    const input = { command: `cat ${BIG}` };
    expect(blocked(runBash(dir, "s-ttl", input))).toBe(true);
    const flag = confirmFlags(dir)[0];
    expect(flag).toBeTruthy();
    fs.writeFileSync(flag, String(Date.now() - 31 * 60 * 1000));  // older than the 30min TTL
    expect(blocked(runBash(dir, "s-ttl", input))).toBe(true);
    // …and the re-armed flag releases immediately on the next retry.
    expect(runBash(dir, "s-ttl", input).status).toBe(0);
    cleanup(dir);
  }, 30_000);

  test("an unreadable confirmation body counts as expired, not as approval", () => {
    const dir = project();
    const input = { command: `cat ${BIG}` };
    expect(blocked(runBash(dir, "s-garbage", input))).toBe(true);
    const flag = confirmFlags(dir)[0];
    expect(flag).toBeTruthy();
    fs.writeFileSync(flag, "");            // interrupted write / full disk
    expect(blocked(runBash(dir, "s-garbage", input))).toBe(true);
    cleanup(dir);
  }, 30_000);

  test("a different command is not released by an unrelated confirmation", () => {
    const dir = project();
    expect(blocked(runBash(dir, "s-x", { command: `cat ${BIG}` }))).toBe(true);
    expect(blocked(runBash(dir, "s-x", { command: `grep foo ${BIG}` }))).toBe(true);
    cleanup(dir);
  });
});

describe("pre.tokens.guard — Bash cost cap (Requirement A1)", () => {
  test("with the real BASH_MAX_OUTPUT_LENGTH default, a large-file read no longer blocks", () => {
    const dir = project();
    // No BASH_MAX_OUTPUT_LENGTH override — the hook falls back to its own
    // default (30000), giving a 7500-token cap, below this suite's
    // 20000-token threshold. The Bash tool itself could never have put the
    // file's full ~49557-token estimate into context anyway.
    const r = runBash(dir, "s-cap-default", { command: `cat ${BIG}` }, { BASH_MAX_OUTPUT_LENGTH: undefined });
    expect(r.status).toBe(0);
    cleanup(dir);
  });

  test("a small enough BASH_MAX_OUTPUT_LENGTH still allows the read through", () => {
    const dir = project();
    const r = runBash(dir, "s-cap-tiny", { command: `cat ${BIG}` }, { BASH_MAX_OUTPUT_LENGTH: "100" });
    expect(r.status).toBe(0);
    cleanup(dir);
  });

  test("a large enough BASH_MAX_OUTPUT_LENGTH restores the block", () => {
    const dir = project();
    // cap = ceil(1_000_000 * 0.25) = 250000, well above both the file's own
    // 49557 estimate and the 20000 threshold.
    const r = runBash(dir, "s-cap-big", { command: `cat ${BIG}` }, { BASH_MAX_OUTPUT_LENGTH: "1000000" });
    expect(blocked(r)).toBe(true);
    cleanup(dir);
  });

  /** Pull the "Est. cost: ~<N> tokens" figure out of the block message, locale-agnostic. */
  const estCostTokens = (stderr) => {
    const m = /Est\. cost:\s*~([\d.,]+)\s*tokens/.exec(stderr);
    return m ? Number(m[1].replace(/[.,]/g, "")) : null;
  };

  test("the displayed cost is CAPPED, not the raw file size, once the cap is narrower", () => {
    const dir = project();
    // cap = ceil(90000*0.25) = 22500, narrower than the file's own 49557
    // estimate but still above the 20000 threshold, so it still blocks.
    const r = runBash(dir, "s-cap-shown", { command: `cat ${BIG}` }, { BASH_MAX_OUTPUT_LENGTH: "90000" });
    expect(blocked(r)).toBe(true);
    expect(estCostTokens(r.stderr)).toBe(22500);
    cleanup(dir);
  });

  test("the displayed cost is the file's own (smaller) estimate when the cap is wide", () => {
    const dir = project();
    const r = runBash(dir, "s-cap-wide", { command: `cat ${BIG}` }, { BASH_MAX_OUTPUT_LENGTH: "1000000" });
    expect(blocked(r)).toBe(true);
    expect(estCostTokens(r.stderr)).toBe(49557);
    cleanup(dir);
  });
});

describe("pre.tokens.guard — guard_blocked / guard_released telemetry", () => {
  const metricsEvents = () => {
    if (!fs.existsSync(METRICS_FILE)) return [];
    return fs.readFileSync(METRICS_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  };

  test("a block records guard_blocked with tool/kind/est; the releasing retry records guard_released", () => {
    const dir = project();
    const before = metricsEvents().length;
    const input = { command: `cat ${BIG}` };
    const r1 = runBash(dir, "s-metrics", input);
    expect(blocked(r1)).toBe(true);
    const r2 = runBash(dir, "s-metrics", input);
    expect(r2.status).toBe(0);
    const evs = metricsEvents().slice(before);
    const blockedEv = evs.find((e) => e.event === "guard_blocked");
    const releasedEv = evs.find((e) => e.event === "guard_released");
    expect(blockedEv).toMatchObject({ tool: "Bash", kind: "bash-file" });
    expect(blockedEv.est).toBeGreaterThan(0);
    expect(releasedEv).toMatchObject({ tool: "Bash", kind: "bash-file" });
    cleanup(dir);
  });
});
